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
import { exportStakeMaths } from './stakeMathsExport';
import { stakeLimitsCheck, summariseStakeModes } from './stakeMathsFormat';
import { declaredStakeModes } from './stakeModes';
import { stakeReadiness } from './stakeReadiness';

export interface StakeJobSpec {
  kind: 'measure' | 'build';
  /** Deployed component name or slug; the only one when omitted. */
  component?: string;
  booksPerMode?: number;
  oversample?: number;
  /** Minor units; the game's default when omitted. */
  bet?: number;
  /** build: the output folder (default: "<project>-stake" next to the project). */
  folder?: string;
}

const jobs = createPublishJobRegistry({ keepFinished: 10, maxRunMs: 60 * 60_000, newId: () => `stake-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}` });

function modeSummary(r: ReturnType<typeof stakeLimitsCheck>) {
  return r.modes.map((m) => ({ mode: m.name, cost: m.cost, rtp: Number((m.rtp * 100).toFixed(3)), maxWin: m.maxWin, std: Number(m.std.toFixed(2)), featureShare: Number((m.featureShare * 100).toFixed(1)), books: m.books }));
}

export function startStakeJob(spec: StakeJobSpec | null | undefined): Record<string, any> {
  const kind = spec?.kind;
  if (kind !== 'measure' && kind !== 'build') return { error: `Unknown stake job ${JSON.stringify(kind ?? null)} — use "measure" or "build".` };
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
          booksPerMode: Math.max(1000, Math.floor(spec?.booksPerMode ?? 20_000)),
          oversample: spec?.oversample ?? 10,
          bet: spec?.bet,
          stakeModes,
          onProgress: (p) => progress(`Measuring ${p.mode} (${p.modeIndex + 1}/${p.modeCount}): ${p.books.toLocaleString()} / ${p.booksPerMode.toLocaleString()} books`)
        });
        const limits = stakeLimitsCheck(maths.modes, { maxWinMultiplier: maths.info.maxWinMultiplier, minBooks: 1 });
        return {
          component: comp.name,
          modes: modeSummary(limits),
          withinLimits: limits.ok,
          problems: limits.problems,
          summary: summariseStakeModes(maths.modes),
          next: limits.ok
            ? 'Every mode is inside Stake\'s limits on this sample. Build for upload: stake({action:"build"}).'
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
      onMathsProgress: (p) => progress(`Stake books ${p.mode} (${p.modeIndex + 1}/${p.modeCount}): ${p.books.toLocaleString()} / ${p.booksPerMode.toLocaleString()}`)
    });
    const limits = stakeLimitsCheck(built.maths.modes, { maxWinMultiplier: built.maths.info.maxWinMultiplier });
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
