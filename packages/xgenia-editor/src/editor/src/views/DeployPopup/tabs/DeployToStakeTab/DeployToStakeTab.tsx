import { useModernModel } from '@xgenia-hooks/useModel';
import React, { useEffect, useState } from 'react';
import { filesystem } from '@xgenia/platform';

import { CloudService } from '@xgenia-models/CloudServices';
import { ProjectModel } from '@xgenia-models/projectmodel';
import { createEditorCompilation } from '@xgenia-utils/compilation/compilation.editor';
import { listEdgeDeployments } from '@xgenia-utils/rgs/deployEdgeFunction';
import { getActiveGame, getRgsSettings } from '@xgenia-utils/rgs/rgsClient';
import { buildForStake } from '@xgenia-utils/stake/buildForStake';
import { writeClipboardText } from '@xgenia-utils/systemClipboard';
import { diagnoseStakeExportError, type StakeExportDiagnosis } from '@xgenia-utils/stake/stakeExportDiagnosis';
import { deployChangedMathsComponents } from '@xgenia-utils/publish/deployChangedMaths';
import { stakeErrorCode, type StakeExportFailure } from '@xgenia-utils/stake/stakeMathsExport';
import { parseStakePlaySetups, summariseStakeModes } from '@xgenia-utils/stake/stakeMathsFormat';
import { STAKE_REVIEW_ITEMS, stakePanel, type CheckState } from '@xgenia-utils/stake/stakePanel';
import { lastStakeMeasure, onStakeMeasure } from '@xgenia-utils/stake/stakeMeasureStore';
import { startStakeJob, stakeJob } from '@xgenia-utils/stake/stakeCommands';
import { stakeFixRequest, stakeReadiness, type ReadinessReport } from '@xgenia-utils/stake/stakeReadiness';

import { PrimaryButton, PrimaryButtonSize, PrimaryButtonVariant } from '@xgenia-core-ui/components/inputs/PrimaryButton';
import { Select } from '@xgenia-core-ui/components/inputs/Select';
import { TextArea } from '@xgenia-core-ui/components/inputs/TextArea';
import { TextInput } from '@xgenia-core-ui/components/inputs/TextInput';
import { Text } from '@xgenia-core-ui/components/typography/Text';

import { ToastLayer } from '../../../ToastLayer/ToastLayer';
import { NO_ENVIRONMENT_VALUE } from '../../DeployPopup.constants';
import { useEnvironmentsAsOptions } from '../../DeployPopup.hooks';
import { editorBridge } from '../../../panels/ChatPanelBridge/EditorBridge';

/** A deployed Math Component the maths export can be run against. */
interface ExportableComponent {
  deploymentId: string;
  slug: string;
  name: string;
}

// Stake asks for 100,000–1,000,000 books per mode; fewer leave the package's RTP to luck on a volatile game.
const DEFAULT_BOOKS_PER_MODE = 100_000;

const PLAY_SETUPS_EXAMPLE =
  '[{ "name": "base", "trigger": "AutoBet", "inputs": { "mines": 3, "autoTiles": [0, 1, 2, 3, 4] }, "before": [{ "trigger": "Restore" }] }]';

// Play setups are per game and worth keeping between exports; a convenience, so storage failing is harmless.
const playSetupsKey = (gameId: string) => `xgenia_stake_play_setups:${gameId}`;
function loadPlaySetups(gameId: string | undefined): string {
  if (!gameId) return '';
  try {
    return localStorage.getItem(playSetupsKey(gameId)) || '';
  } catch {
    return '';
  }
}
function savePlaySetups(gameId: string | undefined, text: string) {
  if (!gameId) return;
  try {
    if (text.trim()) localStorage.setItem(playSetupsKey(gameId), text);
    else localStorage.removeItem(playSetupsKey(gameId));
  } catch {
    /* storage unavailable: the field still works for this export */
  }
}

/**
 * The components of the active game that can be exported: the newest ACTIVE row per slug —
 * the row `rgs-fn` serves — that declares a win port. A component with no win port has no
 * number to write as a book's payout, so it is left out rather than listed and refused later.
 */
export async function listExportableComponents(apiKey: string, gameId: string): Promise<ExportableComponent[]> {
  const deployments = await listEdgeDeployments(apiKey, gameId);
  const newest = new Map<string, { deploymentId: string; name: string; createdAt: string }>();
  for (const deployment of deployments) {
    for (const fn of deployment.functions || []) {
      if (fn.status !== 'active' || !fn.win_output_port) continue;
      const current = newest.get(fn.function_slug);
      if (!current || String(fn.created_at) > current.createdAt) {
        newest.set(fn.function_slug, {
          deploymentId: String(deployment.id),
          name: fn.function_name || fn.function_slug,
          createdAt: String(fn.created_at)
        });
      }
    }
  }
  return Array.from(newest.entries())
    .map(([slug, v]) => ({ slug, deploymentId: v.deploymentId, name: v.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Active components the export cannot list because no win port is recorded for them — named, so the
 * tab says "deployed, but without a win output" instead of "nothing deployed" (2026-11-05: Wheel Game
 * Test Math's 15 components were deployed and the tab said there were none).
 */
async function componentsWithoutWinPort(apiKey: string, gameId: string): Promise<string[]> {
  const missing = new Map<string, string>();
  const exportable = new Set<string>();
  for (const deployment of await listEdgeDeployments(apiKey, gameId)) {
    for (const fn of deployment.functions || []) {
      if (fn.status !== 'active') continue;
      if (fn.win_output_port) exportable.add(fn.function_slug);
      else missing.set(fn.function_slug, fn.function_name || fn.function_slug);
    }
  }
  return Array.from(missing.entries())
    .filter(([slug]) => !exportable.has(slug))
    .map(([, name]) => name)
    .sort();
}

/** A failed export, explained: what happened, how to fix it, and a request for the XGENIA AI. */
function StakeExportProblem({ diagnosis }: { diagnosis: StakeExportDiagnosis }) {
  async function copyPrompt() {
    try {
      await writeClipboardText(diagnosis.aiPrompt);
      ToastLayer.showSuccess('Copied — paste it into the XGENIA AI chat.');
    } catch (e: any) {
      ToastLayer.showError(`Could not copy: ${e?.message || e}. Select the text and copy it instead.`);
    }
  }
  return (
    <div style={{ marginTop: '8px', padding: '8px', border: '1px solid #a44', borderRadius: '4px' }}>
      <Text style={{ fontSize: '13px', color: '#f88', fontWeight: 600 }}>Maths not exported — {diagnosis.title}</Text>
      <Text style={{ fontSize: '12px', marginTop: '4px', whiteSpace: 'pre-wrap' }}>{diagnosis.whatHappened}</Text>
      <Text style={{ fontSize: '12px', marginTop: '6px', fontWeight: 600 }}>How to fix it</Text>
      {diagnosis.fix.map((step, i) => (
        <Text key={i} style={{ fontSize: '12px', whiteSpace: 'pre-wrap' }}>
          {i + 1}. {step}
        </Text>
      ))}
      {diagnosis.fixableByAi && (
        <>
          <Text style={{ fontSize: '12px', marginTop: '6px', fontWeight: 600 }}>Request for the XGENIA AI</Text>
          <TextArea value={diagnosis.aiPrompt} isResizeDisabled hasBottomSpacing />
          <PrimaryButton label="Copy for XGENIA AI" onClick={copyPrompt} />
        </>
      )}
      <Text style={{ fontSize: '11px', marginTop: '6px', color: '#999', whiteSpace: 'pre-wrap' }}>Error: {diagnosis.rawError}</Text>
    </div>
  );
}

/**
 * The Stake build: frontend with the Book Connector + the maths as Stake books (utils/stake/buildForStake.ts).
 * On since 2026-11-09 — the merged Stake compiler (XRGS SYSTEM_MAP I-169..I-172) and the Book Connector are in place.
 */
const STAKE_MATHS_AVAILABLE = true;

export interface DeployToStakeTabProps {
  /** Sign-in / choose-game, shown on the page while either is missing (the Publish window passes RgsReleaseSetup). */
  connectSlot?: React.ReactNode;
}

export function DeployToStakeTab({ connectSlot }: DeployToStakeTabProps = {}) {
  const cloudService = useModernModel(CloudService.instance);
  const environmentOptions = useEnvironmentsAsOptions(cloudService);

  const [environmentId, setEnvironmentId] = useState<string>(NO_ENVIRONMENT_VALUE);
  const [successMessage, setSuccessMessage] = useState('');

  // ── Maths export: Stake Engine books, played on XGENIA RGS ──────────────
  //
  // The front end above is static files; Stake's RGS plays the game from pre-simulated books
  // it never had. These are produced by the platform from the deployed component (see
  // utils/stake/stakeMathsExport.ts) and written into `<folder>/math/` after the front end.
  //
  // Switched off 2026-11-05 while the maths export was finished.
  // On since 2026-11-09 (STAKE_MATHS_AVAILABLE): the maths and the frontend are built together (buildForStake).
  const rgs = getRgsSettings();
  const game = getActiveGame();
  const canExportMaths = STAKE_MATHS_AVAILABLE && !!rgs?.apiKey && !!game?.id;
  const [components, setComponents] = useState<ExportableComponent[]>([]);
  const [componentsError, setComponentsError] = useState('');
  const [componentKey, setComponentKey] = useState('');
  const [booksPerMode, setBooksPerMode] = useState(String(DEFAULT_BOOKS_PER_MODE));
  const [bet, setBet] = useState('');
  const [playSetupsText, setPlaySetupsText] = useState(() => loadPlaySetups(game?.id));
  const [isExporting, setIsExporting] = useState(false);
  const [diagnosis, setDiagnosis] = useState<StakeExportDiagnosis | null>(null);
  const playSetups = parseStakePlaySetups(playSetupsText);

  useEffect(() => {
    if (!canExportMaths) return;
    let cancelled = false;
    listExportableComponents(rgs!.apiKey, game!.id)
      .then((list) => {
        if (cancelled) return;
        setComponents(list);
        if (list.length === 1) setComponentKey(`${list[0].deploymentId}|${list[0].slug}`);
        if (list.length === 0) {
          const gameName = game!.name || 'This game';
          componentsWithoutWinPort(rgs!.apiKey, game!.id)
            .then((missing) => {
              if (cancelled) return;
              setComponentsError(
                missing.length === 0
                  ? `${gameName} has no deployed Math Component yet. Deploy its maths (Maths → Deploy, or Publish), then come back.`
                  : `${gameName} has ${missing.length} deployed Math Component${missing.length === 1 ? '' : 's'} (${missing.slice(0, 4).join(', ')}` +
                      `${missing.length > 4 ? ', …' : ''}) with no win output recorded, so there is nothing to write as a round's payout. ` +
                      'They were deployed by an editor that did not recognise their bet input; deploy the maths again from this editor and they will be listed.'
              );
            })
            .catch(() => {
              if (!cancelled) setComponentsError(`${gameName} has no deployed Math Component with a win output port to export.`);
            });
        }
      })
      .catch((e: any) => {
        if (!cancelled) setComponentsError(`Could not list deployed components: ${e?.message || e}`);
      });
    return () => {
      cancelled = true;
    };
    // The key and game are read once per mount; the popup remounts when they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canExportMaths]);

  const selected = components.find((c) => `${c.deploymentId}|${c.slug}` === componentKey) || null;

  /** Whole Stake build: frontend with the Book Connector, and the maths as books (buildForStake.ts). */
  async function buildFullStake(direntry: string) {
    const activityId = 'building-for-stake';
    const books = Math.floor(Number(booksPerMode));
    if (!(books > 0)) {
      ToastLayer.showError('Books per mode must be a positive number.');
      return;
    }
    const betMinor = bet.trim() ? Math.floor(Number(bet)) : undefined;
    if (bet.trim() && !(betMinor! > 0)) {
      ToastLayer.showError('Bet must be a positive whole number of minor units (cents).');
      return;
    }
    setDiagnosis(null);
    if (playSetups.error) {
      ToastLayer.showError(playSetups.error);
      setSuccessMessage('Frontend exported.');
      setDiagnosis(diagnoseStakeExportError(playSetups.error, { gameName: game?.name, componentName: selected?.name }));
      return;
    }
    if (!selected) {
      ToastLayer.showError('Pick the Math Component the game plays.');
      return;
    }
    setIsExporting(true);
    setSuccessMessage('');
    const say = (message: string) => ToastLayer.showActivity(message, activityId);
    say('Building for Stake…');
    const notes: string[] = [];

    // (2026-11-05) The export plays what is DEPLOYED, so the project's maths is deployed first if it
    // changed — as Publish does before every publish (deployChangedMaths). Exporting a copy older than
    // the graph on screen would certify maths the author has already changed.
    let justDeployed = false;
    try {
      const synced = await deployChangedMathsComponents({ onProgress: say });
      justDeployed = synced.deployed.some((d) => d.slug === selected.slug);
      if (synced.deployed.length > 0) {
        notes.push(`Deployed first, because they changed since the last deploy: ${synced.deployed.map((d) => d.name).join(', ')}.`);
      }
    } catch (e: any) {
      notes.push(`The project's maths could not be deployed first (${e?.message || e}); the copy already on XGENIA RGS was exported.`);
    }

    // The newest active copy of the chosen component — re-read every time: the list was read when this
    // tab opened, and a deploy since then (above, or Deploy → XGENIA RGS) left it on the old copy
    // (2026-11-03, MinesMaths: redeployed, still exported the pre-fix compile).
    let target = selected;
    const newestCopy = async () => {
      try {
        const fresh = await listExportableComponents(rgs!.apiKey, game!.id);
        const newest = fresh.find((c) => c.slug === selected.slug);
        if (newest) {
          target = newest;
          setComponents(fresh);
          setComponentKey(`${newest.deploymentId}|${newest.slug}`);
        }
      } catch {
        /* the RGS could not be listed: the copy picked when the tab opened is still a real one */
      }
    };
    await newestCopy();

    const environment = cloudService.backend.items.find((x) => x.id === environmentId);
    const run = () =>
      buildForStake({
        project: ProjectModel.instance,
        direntry,
        apiKey: rgs!.apiKey,
        game: { id: game!.id, slug: game!.slug, name: game!.name },
        component: { deploymentId: target.deploymentId, slug: target.slug, name: target.name },
        booksPerMode: books,
        bet: betMinor,
        playSetups: playSetups.setups,
        environment,
        onStep: say,
        onMathsProgress: (p) =>
          say(
            p.phase === 'setup'
              ? `Playing ${target.name} to find the paid round of ${p.mode} (${p.modeIndex + 1}/${p.modeCount})` +
                  (p.books ? ` — ${p.books.toLocaleString()} requests tried` : '…')
              : `Stake books — ${p.mode} (${p.modeIndex + 1}/${p.modeCount}): ` +
                  `${p.books.toLocaleString()} / ${p.booksPerMode.toLocaleString()} rounds played`
          )
      });

    try {
      let result: Awaited<ReturnType<typeof buildForStake>>;
      try {
        result = await run();
      } catch (e) {
        // Rebuild the deployed copy from the open project with THIS compiler and go again — once — when
        // the copy may be the compiler's fault rather than the maths':
        //   stale_compile — built before the signal fix (the RGS reads it off the script): never the maths;
        //   no_round      — nothing it answers to is a paid round, from a copy this export did not just
        //                   build. A graph that has not changed is never redeployed by "what changed", so a
        //                   copy an older compiler broke (KenoMaths 2026-10-29: Spin answered nothing) would
        //                   otherwise be reported to the author as their maths.
        // A copy built a moment ago by this compiler that still finds no round IS the maths: it is explained
        // below, with the request for the XGENIA AI. A component this project does not contain stays as is.
        const code = stakeErrorCode(e);
        if (code !== 'stale_compile' && !(code === 'no_round' && !justDeployed)) throw e;
        say(`Rebuilding ${target.name} with this editor's compiler…`);
        try {
          await deployChangedMathsComponents({ onProgress: say, redeployAll: true });
        } catch {
          throw e;
        }
        // Into the newest Server Version, replacing the row in place — the copy may keep its id.
        await newestCopy();
        notes.push(
          code === 'stale_compile'
            ? `${target.name} was rebuilt with this editor's compiler and redeployed: the copy on XGENIA RGS was built by an older one.`
            : `${target.name} was rebuilt with this editor's compiler and redeployed before exporting: the copy on XGENIA RGS did not play.`
        );
        result = await run();
      }
      ToastLayer.hideActivity(activityId);
      ToastLayer.showSuccess('Built for Stake.');
      const m = result.maths;
      setSuccessMessage(
        `Built for Stake.\n` +
          `Frontend: ${direntry} — ${target.name} is played from the Stake books (${result.swapped} instance${result.swapped === 1 ? '' : 's'}).\n` +
          `Maths: bet ${m.bet} minor units, seed ${m.masterSeed.slice(0, 12)}…\n` +
          Object.entries(m.autoSetups)
            .map(([mode, a]) => `${mode} played as: ${a.label} (found by playing the game; recorded in the manifest)\n`)
            .join('') +
          `${summariseStakeModes(m.modes)}\n` +
          [...notes, ...m.notes].map((n) => `Note: ${n}\n`).join('') +
          `Upload the frontend folder and ${m.publishDir} on Engine. ${m.manifestPath} holds the seed and statistics — keep it, do not upload it.\n` +
          `Check it first: npm run stake:check -- "${m.publishDir}" --game "${direntry}" --tls --expect-feature`
      );
    } catch (e: any) {
      ToastLayer.hideActivity(activityId);
      const info = (e as StakeExportFailure)?.stakeInfo;
      const d = diagnoseStakeExportError(e, {
        gameName: game?.name,
        componentName: info?.functionName || target.name,
        winOutputPort: info?.winOutputPort,
        betInputPort: info?.betInputPort,
        bet: betMinor ?? info?.defaultBet,
        playSetups: playSetups.setups
      });
      ToastLayer.showError(`Stake build failed: ${d.title}`);
      setSuccessMessage(notes.map((n) => `Note: ${n}`).join('\n'));
      setDiagnosis(d);
    } finally {
      setIsExporting(false);
    }
  }

  /** Frontend only, as before: its Math Component still runs in the browser — for looks, never for submission. */
  function exportFrontendOnly(direntry: string) {
    const activityId = 'deploying-project-to-stake';
    const compilation = createEditorCompilation(ProjectModel.instance)
      .addProjectBuildScripts()
      .addBuildScript({
        async onPreBuild() {
          ToastLayer.showActivity('Exporting for Stake...', activityId);
          setSuccessMessage('');
        },
        async onPostBuild({ status }) {
          ToastLayer.hideActivity(activityId);
          if (status === 'success') {
            ToastLayer.showSuccess('Frontend exported.');
            setSuccessMessage('Frontend exported without maths: its outcomes are decided in the browser. Not for submitting to Stake.');
          } else {
            ToastLayer.showError('Stake export failed.');
          }
        }
      });
    const environment = cloudService.backend.items.find((x) => x.id === environmentId);
    compilation.deployToFolder(direntry, { environment, runtimeType: 'stake' });
  }

  function onPickFolderClicked() {
    filesystem.openDialog({ allowCreateDirectory: true }).then((direntry) => {
      if (canExportMaths) void buildFullStake(direntry);
      else exportFrontendOnly(direntry);
    });
    // Keep popup open so the confirmation message is visible
  }

  function onFrontendOnlyClicked() {
    filesystem.openDialog({ allowCreateDirectory: true }).then((direntry) => exportFrontendOnly(direntry));
  }

  // ── The page: what state the game is in, three checks, one button (utils/stake/stakePanel.ts) ──
  const [report, setReport] = useState<ReadinessReport | null>(null);
  const [reportFailed, setReportFailed] = useState(false);
  const [sentToAi, setSentToAi] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [openIssue, setOpenIssue] = useState<number | null>(null);
  const checkReadiness = () => {
    try {
      setReport(stakeReadiness((ProjectModel.instance as any)?.toJSON?.()));
      setReportFailed(false);
    } catch (e) {
      console.warn('[Stake] readiness check failed', e);
      setReport(null);
      setReportFailed(true);
    }
    setSentToAi(false);
  };
  useEffect(checkReadiness, []);

  // The payout check: the last measurement of the component the build plays (stakeMeasureStore — written by this
  // button and by the AI's `stake measure` alike), and a Measure button that runs the same job.
  const [, rerender] = useState(0);
  useEffect(() => onStakeMeasure(() => rerender((n) => n + 1)), []);
  const [measuring, setMeasuring] = useState<string | null>(null);
  const [measureError, setMeasureError] = useState('');
  const last = lastStakeMeasure(game?.id, selected?.slug);
  async function measure() {
    if (!selected) return;
    setMeasureError('');
    const started = startStakeJob({ kind: 'measure', component: selected.slug, booksPerMode: Math.floor(Number(booksPerMode)) || DEFAULT_BOOKS_PER_MODE } as any);
    if (!started || started.error) {
      setMeasureError(started?.error || 'The measurement did not start.');
      return;
    }
    setMeasuring('Starting…');
    for (;;) {
      await new Promise((r) => setTimeout(r, 2000));
      const j: any = stakeJob(started.jobId);
      if (!j || j.error || j.state === 'failed') {
        setMeasureError(j?.error || 'The measurement stopped.');
        break;
      }
      if (j.state === 'done') break;
      setMeasuring(j.step || 'Measuring…');
    }
    setMeasuring(null);
  }

  const panel = stakePanel({
    connected: !!rgs?.apiKey,
    gameName: game?.id ? game.name || game.slug || 'This game' : null,
    components: !canExportMaths ? [] : components.length || componentsError ? components : null,
    componentsError,
    issues: reportFailed ? null : report ? report.issues : [],
    measure: measuring
      ? 'running'
      : last && selected
        ? { current: last.deploymentId === selected.deploymentId, ok: last.ok, modes: last.modes, problems: last.problems }
        : null
  });
  // The build waits only on the payout: offer the AI the measurement's problems as the main action.
  const payoutBlocked =
    !measuring && !!last && !!selected && last.deploymentId === selected.deploymentId && !last.ok && panel.checks.slice(0, 3).every((c) => c.state !== 'todo' && c.state !== 'busy');
  const askAiAboutPayout = () => {
    if (!last) return;
    const text =
      `Stake's measure of ${selected?.name || 'the maths'} found:\n` +
      last.problems.filter((p) => p.level === 'error').map((p, n) => `${n + 1}. [${p.code}] ${p.message}`).join('\n') +
      `\nFix them with the stake tool (for RTP_UNCERTAIN, measure more closely before changing the maths), then measure again.`;
    editorBridge.pushEvent('stake-ask-ai', { text, issues: last.problems.length });
    openChatPanel();
    setSentToAi(true);
  };
  const actionable = (report?.issues || []).some((i) => i.level !== 'info');
  const askAi = () => {
    if (!report) return;
    const text = stakeFixRequest(report);
    if (!text) return;
    editorBridge.pushEvent('stake-ask-ai', { text, issues: report.issues.length });
    openChatPanel();
    setSentToAi(true);
  };

  return (
    <div data-testid="stake-page">
      <div style={HEADLINE}>
        <span style={{ ...DOT, backgroundColor: TONE[panel.tone] }} />
        {panel.headline}
      </div>
      <div style={SUBTITLE}>One folder you upload to Stake Engine: the game, playing its maths from Stake&rsquo;s books.</div>

      {connectSlot}

      <div style={CARD}>
        {panel.checks.map((c, n) => (
          <div key={c.key} style={{ ...ROW, borderTop: n ? HAIRLINE : 'none' }}>
            <CheckMark state={c.state} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={ROW_TITLE}>{c.title}</div>
              <div style={{ ...ROW_DETAIL, whiteSpace: 'pre-wrap' }}>{c.key === 'rtp' && measuring ? measuring : c.detail}</div>
              {c.key === 'rules' && panel.issues.length > 0 && (
                <div style={{ marginTop: '6px' }}>
                  {panel.issues.map((i, k) => (
                    <div key={k} style={ISSUE} role="button" onClick={() => setOpenIssue(openIssue === k ? null : k)}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ ...SMALL_DOT, backgroundColor: LEVEL_COLOUR[i.level] }} />
                        <span style={{ flex: 1, color: '#e6e6e6' }}>{i.title}</span>
                        <span style={{ color: '#777' }}>{openIssue === k ? '⌃' : '⌄'}</span>
                      </div>
                      {openIssue === k && (
                        <div style={{ margin: '4px 0 2px 12px', color: '#aaa' }}>
                          <div>{i.message}</div>
                          {i.fix && <div style={{ marginTop: '4px', color: '#cfcfcf' }}>{i.fix}</div>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* More than one deployed Math Component: which one the game plays is the one choice the build needs. */}
      {components.length > 1 && (
        <Select
          label="Maths the game plays"
          options={components.map((c) => ({ label: c.name, value: `${c.deploymentId}|${c.slug}` }))}
          value={componentKey}
          placeholder="Choose the Math Component"
          onChange={(value: string) => setComponentKey(value)}
          hasBottomSpacing
        />
      )}
      {/* One main action: measure the payout until it is in Stake's band, then build. */}
      {panel.primary === 'measure' ? (
        <PrimaryButton label="Measure payout" onClick={() => void measure()} isDisabled={!!measuring || !selected} isGrowing />
      ) : !payoutBlocked ? (
        <PrimaryButton
          label={isExporting ? 'Building…' : measuring ? 'Measuring…' : 'Build for Stake…'}
          onClick={onPickFolderClicked}
          isDisabled={isExporting || !panel.canBuild || (canExportMaths && !selected)}
          isGrowing
        />
      ) : (
        <PrimaryButton label={sentToAi ? 'Sent to the AI' : 'Fix the payout with AI'} onClick={askAiAboutPayout} isDisabled={sentToAi} isGrowing />
      )}
      {measureError && <div style={{ ...ROW_DETAIL, color: '#ff8a8a', marginTop: '6px' }}>{measureError}</div>}
      <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
        {last && !measuring && panel.primary !== 'measure' && (
          <PrimaryButton label="Measure again" variant={PrimaryButtonVariant.Ghost} size={PrimaryButtonSize.Small} onClick={() => void measure()} isGrowing />
        )}
        {actionable && (
          <PrimaryButton label={sentToAi ? 'Sent to the AI' : 'Fix with AI'} variant={PrimaryButtonVariant.Muted} size={PrimaryButtonSize.Small} onClick={askAi} isDisabled={sentToAi} isGrowing />
        )}
        <PrimaryButton label="Check again" variant={PrimaryButtonVariant.Ghost} size={PrimaryButtonSize.Small} onClick={checkReadiness} isGrowing={!actionable} />
      </div>

      {successMessage && <div style={RESULT}>{successMessage}</div>}
      {diagnosis && <StakeExportProblem diagnosis={diagnosis} />}

      {/* What Stake's reviewers try by hand: nothing here can check them, so they are a list to go through. */}
      <div style={{ ...CARD, marginTop: '16px', padding: '10px 12px' }}>
        <div style={ROW_TITLE}>Before you submit</div>
        <div style={{ ...ROW_DETAIL, marginBottom: '6px' }}>Stake&rsquo;s reviewers try these by hand. Check them in Stake&rsquo;s preview.</div>
        {STAKE_REVIEW_ITEMS.map((item) => (
          <div key={item} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#d6d6d6', padding: '3px 0' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', border: '1.5px solid #777', flex: 'none' }} />
            {item}
          </div>
        ))}
      </div>

      <div style={{ ...DISCLOSURE, marginTop: '16px' }} role="button" onClick={() => setShowOptions(!showOptions)}>
        <span style={{ display: 'inline-block', width: '12px' }}>{showOptions ? '▾' : '▸'}</span>Options
      </div>
      {showOptions && (
        <div style={{ paddingTop: '8px' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <div style={{ flex: 1 }}>
              <TextInput label="Books per mode" value={booksPerMode} onChange={(e) => setBooksPerMode(e.target.value)} placeholder={String(DEFAULT_BOOKS_PER_MODE)} hasBottomSpacing />
            </div>
            <div style={{ flex: 1 }}>
              <TextInput label="Bet (minor units)" value={bet} onChange={(e) => setBet(e.target.value)} placeholder="Minimum" hasBottomSpacing />
            </div>
          </div>
          <TextArea
            label="Play setups (JSON, optional)"
            value={playSetupsText}
            placeholder={PLAY_SETUPS_EXAMPLE}
            onChange={(e) => {
              setPlaySetupsText(e.target.value);
              savePlaySetups(game?.id, e.target.value);
            }}
            hasBottomSpacing
          />
          {playSetups.error && <div style={{ ...ROW_DETAIL, color: '#ff8a8a' }}>{playSetups.error}</div>}
          <div style={ROW_DETAIL}>
            Left blank, the build plays the game in every mode and finds each mode&rsquo;s paid round itself. Fill it in
            only to choose a round yourself; &ldquo;before&rdquo; steps run unpaid at the start of every book.
          </div>
          <div role="button" style={{ ...LINK, marginTop: '12px' }} onClick={onFrontendOnlyClicked}>
            Export the frontend only (its maths runs in the browser — for a look, not for Stake)
          </div>
        </div>
      )}
    </div>
  );
}

/** A check's mark: done, needs you, worth a look, or still checking. */
function CheckMark({ state }: { state: CheckState }) {
  const look = {
    ok: { bg: '#2f5c3f', fg: '#7be0a0', ch: '✓' },
    todo: { bg: '#5c2f2f', fg: '#ff9a9a', ch: '!' },
    warn: { bg: '#5c4a24', fg: '#f5c26b', ch: '!' },
    busy: { bg: '#3a3a3a', fg: '#aaa', ch: '…' }
  }[state];
  return <span style={{ ...MARK, backgroundColor: look.bg, color: look.fg }}>{look.ch}</span>;
}

function openChatPanel() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SidebarModel } = require('@xgenia-models/sidebar');
    const items = SidebarModel.instance.getItems() || [];
    const chat = items.find((i: any) => i.id === 'ChatPanel' || i.id === 'chat-panel');
    if (chat && SidebarModel.instance.getCurrent()?.id !== chat.id) SidebarModel.instance.switch(chat.id);
  } catch (e) {
    console.warn('[Stake] could not open the chat panel', e);
  }
}

const TONE = { ok: '#67DE92', warn: '#f5c26b', todo: '#ff8a8a' } as const;
const LEVEL_COLOUR = { error: '#ff8a8a', warn: '#f5c26b', info: '#9fb3c8' } as const;
const HAIRLINE = '1px solid #474747';
const HEADLINE: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '15px', fontWeight: 600, color: '#f2f2f2', lineHeight: 1.3 };
const SUBTITLE: React.CSSProperties = { fontSize: '12px', color: '#9a9a9a', margin: '4px 0 14px', lineHeight: 1.4 };
const DOT: React.CSSProperties = { width: '8px', height: '8px', borderRadius: '50%', flex: 'none' };
const SMALL_DOT: React.CSSProperties = { width: '6px', height: '6px', borderRadius: '50%', flex: 'none' };
const CARD: React.CSSProperties = { backgroundColor: '#383838', borderRadius: '10px', padding: '2px 12px', marginBottom: '14px' };
const ROW: React.CSSProperties = { display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '10px 0' };
const ROW_TITLE: React.CSSProperties = { fontSize: '13px', color: '#eee', lineHeight: 1.35 };
const ROW_DETAIL: React.CSSProperties = { fontSize: '11px', color: '#999', marginTop: '2px', lineHeight: 1.4 };
const MARK: React.CSSProperties = { width: '18px', height: '18px', borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700, flex: 'none', marginTop: '1px' };
const ISSUE: React.CSSProperties = { fontSize: '12px', padding: '4px 0', cursor: 'pointer', lineHeight: 1.4 };
const RESULT: React.CSSProperties = { marginTop: '12px', padding: '10px 12px', borderRadius: '8px', backgroundColor: '#2c3a31', border: '1px solid #3f6b4f', fontSize: '12px', color: '#cfe9d8', whiteSpace: 'pre-wrap', wordBreak: 'break-word' };
const DISCLOSURE: React.CSSProperties = { fontSize: '12px', color: '#bbb', cursor: 'pointer', userSelect: 'none' };
const LINK: React.CSSProperties = { fontSize: '11px', color: '#67DE92', cursor: 'pointer' };
