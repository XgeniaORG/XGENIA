/**
 * Stake jobs the AI runs (bridge `stake.start` / `stake.job`, 2026-11-09).
 *
 * WHY. The AI could read Stake readiness but not act past it: it could not export, could not tell whether each
 * mode's RTP sat inside Stake's 96.0–96.7% band, and could not check Stake's other limits — the developer did all
 * of that by hand, after the AI said "done". Two jobs close the loop:
 *
 *   measure — the maths only, as Stake books (20,000 per mode, oversampled 10×) into a scratch folder, then
 *             Stake's limits on what came out (stakeLimitsCheck): RTP per mode and its spread, costs, max win and
 *             its odds, base volatility, buys that really open their feature. Minutes, so the AI can tune the
 *             maths, deploy it, and measure again until every mode is in band.
 *   build   — the whole game for upload (buildForStake.ts: frontend on the Book Connector + books, 100,000 per
 *             mode by default) into a folder next to the project, then the same limits and readiness again.
 *
 * Both refuse to start while stake readiness has errors (the AI fixes those first), and run as jobs like
 * Publish's (publishJobs.ts): the bridge answers each command within its 30 s limit and the AI polls.
 */
import * as os from 'os';
import { filesystem } from '@xgenia/platform';

import { ProjectModel } from '@xgenia-models/projectmodel';
import { createPublishJobRegistry } from '@xgenia-utils/publish/publishJobs';
import { publishPreconditionError } from '@xgenia-utils/publish/publishGame';
import { getActiveGame, getRgsSettings } from '@xgenia-utils/rgs/rgsClient';
import { listExportableComponents } from '../../views/DeployPopup/tabs/DeployToStakeTab/DeployToStakeTab';

import { buildForStake } from './buildForStake';
import { exportStakeMaths, fetchStakeExportModes, findStakeAutoSetup, postMathsDeployer } from './stakeMathsExport';
import { interpolateDial, rankVariations, type VariationPair } from './stakeVariationsFormat';
import { stakeLimitsCheck, summariseStakeModes } from './stakeMathsFormat';
import { declaredStakeModes } from './stakeModes';
import { rememberStakeMeasure } from './stakeMeasureStore';
import { stakeReadiness } from './stakeReadiness';

export interface StakeJobSpec {
  kind: 'measure' | 'build' | 'variations';
  /** variations: settings of the maths' inputs to compare, e.g. [{ label: 'x2', inputs: { freeSpinMult: 2 } }]. */
  variations?: { label?: string; inputs: Record<string, unknown> }[];
  /** variations: rounds per setting and mode (default 100,000). */
  rounds?: number;
  /** variations: only these Stake modes (default all). */
  modes?: string[];
  /** Deployed component name or slug; the only one when omitted. */
  component?: string;
  booksPerMode?: number;
  oversample?: number;
  /** Minor units; the game's default when omitted. */
  bet?: number;
  /** build: the output folder (default: "<project>-stake" next to the project). */
  folder?: string;
}

/** Books per mode for a measure: 100,000 is Stake's own minimum, and 20,000 left ±3 points of luck on a volatile game. */
export const STAKE_MEASURE_BOOKS = 100_000;

const jobs = createPublishJobRegistry({ keepFinished: 10, maxRunMs: 60 * 60_000, newId: () => `stake-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}` });

function modeSummary(r: ReturnType<typeof stakeLimitsCheck>) {
  return r.modes.map((m) => ({ mode: m.name, cost: m.cost, rtp: Number((m.rtp * 100).toFixed(3)), maxWin: m.maxWin, std: Number(m.std.toFixed(2)), featureShare: Number((m.featureShare * 100).toFixed(1)), books: m.books }));
}

export function startStakeJob(spec: StakeJobSpec | null | undefined): Record<string, any> {
  const kind = spec?.kind;
  if (kind !== 'measure' && kind !== 'build' && kind !== 'variations') return { error: `Unknown stake job ${JSON.stringify(kind ?? null)} — use "measure", "variations" or "build".` };
  if (kind === 'variations' && !(Array.isArray(spec?.variations) && spec!.variations!.length)) return { error: 'variations needs a list of settings: [{ label?, inputs: { <input>: <value> } }] (an empty inputs object is the current defaults).' };
  const busy = jobs.running();
  if (busy) return { error: 'A Stake job is already running', jobId: busy.jobId };
  const project: any = ProjectModel.instance;
  if (!project) return { error: 'No project is open.' };
  const rgs = getRgsSettings();
  const game = getActiveGame();
  const pre = publishPreconditionError(rgs, game);
  if (pre) return { error: pre };

  const readiness = stakeReadiness(project.toJSON?.());
  if (!readiness.ready) {
    return { error: 'Stake readiness has errors: fix them first (stake readiness lists them).', issues: readiness.issues.filter((i) => i.level === 'error').map((i) => ({ code: i.code, do: i.ai })) };
  }

  return jobs.start((kind === 'measure' ? 'maths' : 'game') as any, async (progress) => {
    const list = await listExportableComponents(rgs!.apiKey, game!.id);
    const want = spec?.component ? String(spec.component).toLowerCase() : null;
    const comp = want ? list.find((c) => c.slug.toLowerCase() === want || c.name.toLowerCase() === want || c.name.toLowerCase().endsWith('/' + want)) : list.length === 1 ? list[0] : null;
    if (!comp) {
      throw new Error(list.length === 0 ? `${game!.name || 'This game'} has no deployed Math Component with a win output: deploy the maths first (rgs publish or the Maths panel).` : `Say which component: ${list.map((c) => c.name).join(', ')}`);
    }
    const stakeModes = declaredStakeModes(project.toJSON?.());

    if (kind === 'variations') return runVariations(rgs!.apiKey, comp, spec!, stakeModes, progress);

    if (kind === 'measure') {
      const dir = filesystem.join(os.tmpdir(), `xgenia-stake-measure-${Date.now()}`);
      await filesystem.makeDirectory(dir);
      try {
        const maths = await exportStakeMaths({
          apiKey: rgs!.apiKey,
          game: { id: game!.id, slug: game!.slug, name: game!.name },
          deploymentId: comp.deploymentId,
          functionSlug: comp.slug,
          outputDir: dir,
          booksPerMode: Math.max(1000, Math.floor(spec?.booksPerMode ?? STAKE_MEASURE_BOOKS)),
          oversample: spec?.oversample ?? 10,
          bet: spec?.bet,
          stakeModes,
          onProgress: (p) =>
            progress(
              (p as any).phase === 'setup'
                ? `Finding ${p.mode}'s paid round (${p.books} tried)`
                : `Measuring ${p.mode} (${p.modeIndex + 1}/${p.modeCount}): ${p.books.toLocaleString()} / ${p.booksPerMode.toLocaleString()} rounds`
            )
        });
        const limits = stakeLimitsCheck(maths.modes, { maxWinMultiplier: maths.info.maxWinMultiplier, minBooks: 1, purpose: 'measure' });
        rememberStakeMeasure(game!.id, comp, limits);
        return {
          component: comp.name,
          modes: modeSummary(limits),
          withinLimits: limits.ok,
          problems: limits.problems,
          summary: summariseStakeModes(maths.modes),
          next: limits.ok
            ? 'Every mode is inside Stake\'s limits on this sample. Build for upload: stake({action:"build"}).'
            : limits.problems.some((p) => p.code === 'RTP_UNCERTAIN')
              ? 'The RTP is not known closely enough to change the maths: follow RTP_UNCERTAIN\'s fix first. Fix any other problem as its fix says.'
              : 'Change the maths as each problem\'s fix says, deploy the maths again (rgs publish maths), then measure again.'
        };
      } finally {
        try {
          filesystem.removeDirRecursive(dir);
        } catch {
          /* scratch */
        }
      }
    }

    const projectDir: string = project._retainedProjectDirectory || os.tmpdir();
    const folder = spec?.folder || filesystem.join(filesystem.dirname(projectDir), `${project.name || 'game'}-stake`);
    await filesystem.makeDirectory(folder);
    const built = await buildForStake({
      project,
      direntry: folder,
      apiKey: rgs!.apiKey,
      game: { id: game!.id, slug: game!.slug, name: game!.name },
      component: comp,
      booksPerMode: Math.floor(spec?.booksPerMode ?? 100_000),
      bet: spec?.bet,
      oversample: spec?.oversample,
      onStep: progress,
      onMathsProgress: (p) =>
        progress(
          (p as any).phase === 'setup'
            ? `Finding ${p.mode}'s paid round (${p.books} tried)`
            : `Stake books ${p.mode} (${p.modeIndex + 1}/${p.modeCount}): ${p.books.toLocaleString()} / ${p.booksPerMode.toLocaleString()} rounds`
        )
    });
    const limits = stakeLimitsCheck(built.maths.modes, { maxWinMultiplier: built.maths.info.maxWinMultiplier });
    // The built package is the most exact measurement there is: the Stake page shows it too.
    rememberStakeMeasure(game!.id, comp, limits);
    return {
      component: comp.name,
      folder,
      uploadMaths: built.maths.publishDir,
      uploadFrontend: folder,
      reviewChecklist: filesystem.join(built.maths.dir, 'stake-review-checklist.md'),
      modes: modeSummary(limits),
      withinLimits: limits.ok,
      problems: limits.problems,
      summary: summariseStakeModes(built.maths.modes),
      check: `npm run stake:check -- "${built.maths.publishDir}" --game "${folder}" --tls --expect-feature`,
      next: limits.ok
        ? 'Ready to upload: the frontend folder and the math/publish_files folder on Engine, with the review checklist. Test it first with a session from Engine (stake harness: engine).'
        : 'Not ready: fix each problem, deploy the maths again, measure, then build again.'
    };
  });
}

export function stakeJob(jobId?: string | null) {
  return jobs.get(jobId) || { error: jobId ? `No Stake job "${jobId}" (finished jobs are kept for the last 10, and none survive an editor reload).` : 'No Stake job has been started in this editor session.' };
}

const VARIATIONS_OUT_OF_DATE =
  'XGENIA RGS cannot compare settings yet (stake-variations). Until the platform update ships, compare by changing the input, deploying, and running stake measure.';

/**
 * Compare settings of the maths' inputs on the same books, every Stake mode (XRGS stake-variations, SYSTEM_MAP
 * I-173), and rank them against Stake's band. One deploy, many settings, a minute or two — instead of a deploy
 * and an export per guess.
 */
async function runVariations(
  apiKey: string,
  comp: { deploymentId: string; slug: string; name: string },
  spec: StakeJobSpec,
  stakeModes: ReturnType<typeof declaredStakeModes>,
  progress: (text: string) => void
) {
  const info = await fetchStakeExportModes(apiKey, comp.deploymentId, comp.slug, stakeModes);
  const bet = Math.floor(spec.bet && spec.bet > 0 ? spec.bet : info.defaultBet);
  const modes = spec.modes && spec.modes.length ? info.modes.filter((m) => spec.modes!.includes(m.name)) : info.modes;
  if (!modes.length) throw new Error(`No such modes; this game has: ${info.modes.map((m) => m.name).join(', ')}`);
  // Each mode's paid round, as the export plays it (a buy is often not the base spin).
  const roundRequests: Record<string, unknown> = {};
  for (const m of modes) {
    progress(`Finding ${m.name}'s paid round…`);
    const found = await findStakeAutoSetup(apiKey, comp.deploymentId, comp.slug, bet, m.name, undefined, undefined, { stakeModes });
    if (found) roundRequests[m.name] = found.roundRequest;
  }
  const rounds = Math.max(1000, Math.min(500_000, Math.floor(spec.rounds ?? 100_000)));
  const variations = spec.variations!.map((v, i) => ({ label: v.label || `setting ${i + 1}`, inputs: v.inputs || {} }));
  let state: any[] | undefined;
  let masterSeed: string | undefined;
  let last: any;
  for (let call = 0; call < 2000; call++) {
    last = await postMathsDeployer(
      apiKey,
      {
        action: 'stake-variations', deployment_id: comp.deploymentId, function_slug: comp.slug, bet, rounds,
        variations, modes: modes.map((m) => m.name), round_requests: roundRequests,
        ...(stakeModes.length ? { stake_modes: stakeModes } : {}),
        ...(masterSeed ? { master_seed: masterSeed } : {}),
        ...(state ? { state } : {})
      },
      VARIATIONS_OUT_OF_DATE
    );
    masterSeed = last.master_seed;
    state = last.state;
    const done = (state || []).reduce((a: number, p: any) => a + Math.min(rounds, Number(p.next_id) || 0), 0);
    progress(`Comparing ${variations.length} setting${variations.length === 1 ? '' : 's'} × ${modes.length} mode${modes.length === 1 ? '' : 's'}: ${Math.round((100 * done) / (rounds * (state || []).length || 1))}%`);
    if (last.complete) break;
  }
  if (!last?.complete) throw new Error('The comparison did not finish.');
  const pairs: VariationPair[] = (state || []).map((p: any) => ({ variation: p.variation, label: p.label, mode: p.mode, stats: p.stats }));
  const costs = Object.fromEntries(info.modes.map((m) => [m.name, m.cost]));
  const { ranked, best } = rankVariations(variations, pairs, costs);
  // One numeric dial across the settings: where it should land, per mode.
  const keys = [...new Set(variations.flatMap((v) => Object.keys(v.inputs)))];
  const numeric = keys.length === 1 && variations.every((v) => typeof v.inputs[keys[0]] === 'number');
  const suggestion = numeric
    ? Object.fromEntries(modes.map((m) => [m.name, interpolateDial(ranked.map((r) => ({ value: Number(r.inputs[keys[0]]), rtp: r.modes.find((x) => x.mode === m.name)?.rtp ?? NaN })))]))
    : null;
  return {
    component: comp.name,
    rounds,
    seed: masterSeed,
    settings: ranked.map((r) => ({ label: r.label, inputs: r.inputs, inBand: r.inBand, worstMissPoints: Number((r.worstMiss * 100).toFixed(3)), modes: r.modes.map((m) => ({ mode: m.mode, rtp: Number((m.rtp * 100).toFixed(3)), hitRate: Number((m.hitRate * 100).toFixed(2)), maxWin: m.maxWin })), problems: r.problems })),
    best: best ? { label: best.label, inputs: best.inputs, inBand: best.inBand } : null,
    ...(suggestion ? { dial: keys[0], valueForTarget: suggestion } : {}),
    next: best?.inBand
      ? `"${best.label}" puts every mode in Stake's band on these books. Set those inputs as the defaults in the Math Component, deploy the maths, then confirm with stake measure.`
      : suggestion
        ? `No setting is in band yet. Try values around ${JSON.stringify(suggestion)} for ${keys[0]} and compare again.`
        : 'No setting is in band yet. Narrow or widen the settings and compare again.'
  };
}
