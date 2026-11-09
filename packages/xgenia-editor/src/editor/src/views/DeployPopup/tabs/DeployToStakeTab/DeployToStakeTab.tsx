import { useModernModel } from '@xgenia-hooks/useModel';
import React, { useEffect, useState } from 'react';
import { filesystem } from '@xgenia/platform';

import { CloudService } from '@xgenia-models/CloudServices';
import { ProjectModel } from '@xgenia-models/projectmodel';
import { createEditorCompilation } from '@xgenia-utils/compilation/compilation.editor';
import { listEdgeDeployments } from '@xgenia-utils/rgs/deployEdgeFunction';
import { getActiveGame, getRgsSettings } from '@xgenia-utils/rgs/rgsClient';
import { writeClipboardText } from '@xgenia-utils/systemClipboard';
import { diagnoseStakeExportError, type StakeExportDiagnosis } from '@xgenia-utils/stake/stakeExportDiagnosis';
import { deployChangedMathsComponents } from '@xgenia-utils/publish/deployChangedMaths';
import { exportStakeMaths, stakeErrorCode, type StakeExportFailure } from '@xgenia-utils/stake/stakeMathsExport';
import { parseStakePlaySetups, summariseStakeModes } from '@xgenia-utils/stake/stakeMathsFormat';

import { Checkbox } from '@xgenia-core-ui/components/inputs/Checkbox';
import { PrimaryButton } from '@xgenia-core-ui/components/inputs/PrimaryButton';
import { Select } from '@xgenia-core-ui/components/inputs/Select';
import { TextArea } from '@xgenia-core-ui/components/inputs/TextArea';
import { TextInput } from '@xgenia-core-ui/components/inputs/TextInput';
import { PopupSection } from '@xgenia-core-ui/components/popups/PopupSection';
import { Text } from '@xgenia-core-ui/components/typography/Text';
import { TextType } from '@xgenia-core-ui/components/typography/Text/Text';

import { ToastLayer } from '../../../ToastLayer/ToastLayer';
import { NO_ENVIRONMENT_VALUE } from '../../DeployPopup.constants';
import { useEnvironmentsAsOptions } from '../../DeployPopup.hooks';

/** A deployed Math Component the maths export can be run against. */
interface ExportableComponent {
  deploymentId: string;
  slug: string;
  name: string;
}

const DEFAULT_BOOKS_PER_MODE = 10_000;

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

/** The Stake maths export (books, lookup tables, index.json). Off until it is ready: frontend only for now. */
const STAKE_MATHS_AVAILABLE = false;

export function DeployToStakeTab() {
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
  // Switched off for now (2026-11-05): only the frontend export ships; the maths export is
  // "coming soon". Set STAKE_MATHS_AVAILABLE to true to show the maths section below.
  const rgs = getRgsSettings();
  const game = getActiveGame();
  const canExportMaths = STAKE_MATHS_AVAILABLE && !!rgs?.apiKey && !!game?.id;
  const [exportMaths, setExportMaths] = useState(canExportMaths);
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

  /**
   * The maths half of the export. Runs AFTER the front end has been written, into
   * `<folder>/math/`, so a failure here leaves a complete front-end export and a message
   * rather than half of each.
   */
  async function exportMathsTo(direntry: string) {
    const activityId = 'exporting-stake-maths';
    const books = Math.floor(Number(booksPerMode));
    if (!(books > 0)) {
      ToastLayer.showError('Books per mode must be a positive number.');
      setSuccessMessage('Frontend exported. Maths not exported: books per mode must be a positive number.');
      return;
    }
    const betMinor = bet.trim() ? Math.floor(Number(bet)) : undefined;
    if (bet.trim() && !(betMinor! > 0)) {
      ToastLayer.showError('Bet must be a positive whole number of minor units (cents).');
      setSuccessMessage('Frontend exported. Maths not exported: the bet must be a positive whole number of minor units.');
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
      ToastLayer.showError('Pick the Math Component to export.');
      setSuccessMessage('Frontend exported. Maths not exported: pick the Math Component to export.');
      return;
    }

    setIsExporting(true);
    const say = (message: string) => ToastLayer.showActivity(message, activityId);
    say('Exporting maths for Stake…');
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

    const run = () =>
      exportStakeMaths({
        apiKey: rgs!.apiKey,
        game: game ? { id: game.id, slug: game.slug, name: game.name } : null,
        deploymentId: target.deploymentId,
        functionSlug: target.slug,
        outputDir: direntry,
        booksPerMode: books,
        bet: betMinor,
        playSetups: playSetups.setups,
        onProgress: (p) =>
          say(
            p.phase === 'setup'
              ? `Playing ${target.name} to find the paid round of ${p.mode} (${p.modeIndex + 1}/${p.modeCount})` +
                  (p.books ? ` — ${p.books.toLocaleString()} requests tried` : '…')
              : `Exporting maths for Stake — ${p.mode} (${p.modeIndex + 1}/${p.modeCount}): ` +
                  `${p.books.toLocaleString()} / ${p.booksPerMode.toLocaleString()} rounds played`
          )
      });

    try {
      let result: Awaited<ReturnType<typeof exportStakeMaths>>;
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
      ToastLayer.showSuccess(`Stake maths exported to ${result.publishDir}`);
      setSuccessMessage(
        `Stake export successful!\n` +
          `Maths: ${target.name}, bet ${result.bet} minor units, seed ${result.masterSeed.slice(0, 12)}…\n` +
          Object.entries(result.autoSetups)
            .map(([mode, a]) => `${mode} played as: ${a.label} (found by playing the game; recorded in the manifest)\n`)
            .join('') +
          `${summariseStakeModes(result.modes)}\n` +
          [...notes, ...result.notes].map((n) => `Note: ${n}\n`).join('') +
          `Upload ${result.publishDir} as the game's math. ${result.manifestPath} holds the seed and statistics — keep it, do not upload it.`
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
      ToastLayer.showError(`Stake maths export failed: ${d.title}`);
      setSuccessMessage(['Frontend exported.', ...notes.map((n) => `Note: ${n}`)].join('\n'));
      setDiagnosis(d);
    } finally {
      setIsExporting(false);
    }
  }

  function onPickFolderClicked() {
    const activityId = 'deploying-project-to-stake';

    filesystem
      .openDialog({
        allowCreateDirectory: true
      })
      .then((direntry) => {
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
                ToastLayer.showSuccess('Stake export successful!');
                setSuccessMessage('Stake export successful!');
                if (exportMaths && canExportMaths) {
                  await exportMathsTo(direntry);
                }
              } else {
                ToastLayer.showError('Stake export failed.');
              }
            }
          });

        const environment = cloudService.backend.items.find((x) => x.id === environmentId);

        // NOTE: Fire-n-forget
        compilation.deployToFolder(direntry, {
          environment,
          runtimeType: 'stake'
        });
      });

    // Keep popup open so the confirmation message is visible
  }

  return (
    <>
      <PopupSection>
        <Text hasBottomSpacing textType={TextType.DefaultContrast}>
          Export your game&apos;s frontend as static files for Stake.com (Pro Nodes).
        </Text>
        {!STAKE_MATHS_AVAILABLE && (
          <Text style={{ fontSize: '12px', color: '#f5c26b', marginBottom: '10px', lineHeight: '1.45' }}>
            Only the frontend can be exported for now. Exporting the maths for Stake Engine is coming soon.
          </Text>
        )}

        {successMessage && (
          <Text style={{ marginTop: '8px', fontSize: '12px', color: '#6f6', whiteSpace: 'pre-wrap' }}>{successMessage}</Text>
        )}
        {diagnosis && <StakeExportProblem diagnosis={diagnosis} />}

        {/* {Boolean(cloudService.backend.items?.length) && (
          <Select
            options={environmentOptions}
            onChange={(value: string) => setEnvironmentId(value)}
            placeholder="No cloud services"
            value={environmentId}
            label="Connected cloud services"
            hasBottomSpacing
          />
        )} */}

        <PrimaryButton label="Pick folder" onClick={onPickFolderClicked} isDisabled={isExporting} />
      </PopupSection>

      {/* Stake maths export: coming soon. Gated rather than commented out, so it keeps compiling. */}
      {STAKE_MATHS_AVAILABLE && (
      <PopupSection>
        <Text hasBottomSpacing textType={TextType.DefaultContrast}>
          Maths — Stake Engine books, played on XGENIA RGS
        </Text>
        {!canExportMaths ? (
          <Text style={{ fontSize: '12px' }}>
            Connect XGENIA RGS and pick a game under Publish → XGENIA to export the game&apos;s maths (books, lookup
            tables and index.json) next to the front end.
          </Text>
        ) : (
          <>
            <Checkbox
              label={`Export maths for ${game!.name || game!.slug} into <folder>/math/`}
              isChecked={exportMaths}
              onChange={(e) => setExportMaths(e.target.checked)}
              hasBottomSpacing
            />
            {exportMaths && (
              <>
                {componentsError && <Text style={{ fontSize: '12px', color: '#f88' }}>{componentsError}</Text>}
                {components.length > 0 && (
                  <Select
                    label="Math Component"
                    options={components.map((c) => ({ label: c.name, value: `${c.deploymentId}|${c.slug}` }))}
                    value={componentKey}
                    placeholder="Pick the deployed component the game plays"
                    onChange={(value: string) => setComponentKey(value)}
                    hasBottomSpacing
                  />
                )}
                <TextInput
                  label="Books per bet mode"
                  value={booksPerMode}
                  onChange={(e) => setBooksPerMode(e.target.value)}
                  placeholder={String(DEFAULT_BOOKS_PER_MODE)}
                  hasBottomSpacing
                />
                <TextInput
                  label="Bet (minor units; blank = the game's minimum bet)"
                  value={bet}
                  onChange={(e) => setBet(e.target.value)}
                  placeholder="100"
                  hasBottomSpacing
                />
                <TextArea
                  label="Play setups (optional, JSON — leave blank and the export finds each mode's paid round itself)"
                  value={playSetupsText}
                  placeholder={PLAY_SETUPS_EXAMPLE}
                  onChange={(e) => {
                    setPlaySetupsText(e.target.value);
                    savePlaySetups(game?.id, e.target.value);
                  }}
                  hasBottomSpacing
                />
                {playSetups.error && <Text style={{ fontSize: '12px', color: '#f88' }}>{playSetups.error}</Text>}
                <Text style={{ fontSize: '12px' }}>
                  One mode per feature buy / special bet the component declares, plus the base game. Each book is one
                  paid round and the free rounds it bought, played exactly as /rgs-fn plays them. Payouts land on
                  Stake&apos;s 0.1× grid; the export reports every book that rounding moved.
                </Text>
                <Text style={{ fontSize: '12px', marginTop: '6px' }}>
                  Play setups: left blank, the export first plays the game in every mode — base, each feature buy,
                  each special bet, at its own price — and finds the request that is one whole paid round there:
                  which trigger, which inputs, which seeding steps. A Mines-style game (bet, reveal, cash out) exports
                  without one. Fill it in only to choose a round yourself: its trigger and fixed inputs. Each setup is its own 1× mode and
                  replaces the base game; call one &quot;base&quot;. &quot;before&quot; steps run unpaid at the start of
                  every book — a provably-fair maths mints its seed there, or every book replays the same board.
                </Text>
              </>
            )}
          </>
        )}
      </PopupSection>
      )}
    </>
  );
}
