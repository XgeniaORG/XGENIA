import { useModernModel } from '@xgenia-hooks/useModel';
import React, { useEffect, useState } from 'react';
import { filesystem } from '@xgenia/platform';

import { CloudService } from '@xgenia-models/CloudServices';
import { ProjectModel } from '@xgenia-models/projectmodel';
import { createEditorCompilation } from '@xgenia-utils/compilation/compilation.editor';
import { listEdgeDeployments } from '@xgenia-utils/rgs/deployEdgeFunction';
import { getActiveGame, getRgsSettings } from '@xgenia-utils/rgs/rgsClient';
import { buildForStake } from '@xgenia-utils/stake/buildForStake';
import { summariseStakeModes } from '@xgenia-utils/stake/stakeMathsFormat';

import { Checkbox } from '@xgenia-core-ui/components/inputs/Checkbox';
import { PrimaryButton } from '@xgenia-core-ui/components/inputs/PrimaryButton';
import { Select } from '@xgenia-core-ui/components/inputs/Select';
import { TextInput } from '@xgenia-core-ui/components/inputs/TextInput';
import { PopupSection } from '@xgenia-core-ui/components/popups/PopupSection';
import { Text } from '@xgenia-core-ui/components/typography/Text';
import { TextType } from '@xgenia-core-ui/components/typography/Text/Text';

import { ToastLayer } from '../../../ToastLayer/ToastLayer';
import { NO_ENVIRONMENT_VALUE } from '../../DeployPopup.constants';
import { useEnvironmentsAsOptions } from '../../DeployPopup.hooks';
import { StakeReadinessSection } from './StakeReadinessSection';

/** A deployed Math Component the maths export can be run against. */
interface ExportableComponent {
  deploymentId: string;
  slug: string;
  name: string;
}

const DEFAULT_BOOKS_PER_MODE = 10_000;

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
 * The Stake build: frontend with the Book Connector + the maths as Stake books (utils/stake/buildForStake.ts).
 * On since 2026-11-09 — the merged Stake compiler (XRGS I-137..I-140) and the Book Connector are in place.
 */
const STAKE_MATHS_AVAILABLE = true;

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
  // Switched off 2026-11-05 while the maths export was finished.
  // On since 2026-11-09 (STAKE_MATHS_AVAILABLE): the maths and the frontend are built together (buildForStake).
  const rgs = getRgsSettings();
  const game = getActiveGame();
  const canExportMaths = STAKE_MATHS_AVAILABLE && !!rgs?.apiKey && !!game?.id;
  const [exportMaths, setExportMaths] = useState(canExportMaths);
  const [components, setComponents] = useState<ExportableComponent[]>([]);
  const [componentsError, setComponentsError] = useState('');
  const [componentKey, setComponentKey] = useState('');
  const [booksPerMode, setBooksPerMode] = useState(String(DEFAULT_BOOKS_PER_MODE));
  const [bet, setBet] = useState('');
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    if (!canExportMaths) return;
    let cancelled = false;
    listExportableComponents(rgs!.apiKey, game!.id)
      .then((list) => {
        if (cancelled) return;
        setComponents(list);
        if (list.length === 1) setComponentKey(`${list[0].deploymentId}|${list[0].slug}`);
        if (list.length === 0) {
          setComponentsError(`${game!.name || 'This game'} has no deployed Math Component with a win output port to export.`);
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
    if (!selected) {
      ToastLayer.showError('Pick the Math Component the game plays.');
      return;
    }
    setIsExporting(true);
    setSuccessMessage('');
    ToastLayer.showActivity('Building for Stake…', activityId);
    try {
      const environment = cloudService.backend.items.find((x) => x.id === environmentId);
      const result = await buildForStake({
        project: ProjectModel.instance,
        direntry,
        apiKey: rgs!.apiKey,
        game: { id: game!.id, slug: game!.slug, name: game!.name },
        component: { deploymentId: selected.deploymentId, slug: selected.slug, name: selected.name },
        booksPerMode: books,
        bet: betMinor,
        environment,
        onStep: (step) => ToastLayer.showActivity(step, activityId),
        onMathsProgress: (p) =>
          ToastLayer.showActivity(
            `Stake books — ${p.mode} (${p.modeIndex + 1}/${p.modeCount}): ${p.books.toLocaleString()} / ${p.booksPerMode.toLocaleString()}`,
            activityId
          )
      });
      ToastLayer.hideActivity(activityId);
      ToastLayer.showSuccess('Built for Stake.');
      const m = result.maths;
      setSuccessMessage(
        `Built for Stake.\n` +
          `Frontend: ${direntry} — ${selected.name} is played from the Stake books (${result.swapped} instance${result.swapped === 1 ? '' : 's'}).\n` +
          `Maths: bet ${m.bet} minor units, seed ${m.masterSeed.slice(0, 12)}…\n${summariseStakeModes(m.modes)}\n` +
          `Upload the frontend folder and ${m.publishDir} on Engine. ${m.manifestPath} holds the seed and statistics — keep it, do not upload it.\n` +
          `Check it first: npm run stake:check -- "${m.publishDir}" --game "${direntry}" --tls --expect-feature`
      );
    } catch (e: any) {
      ToastLayer.hideActivity(activityId);
      const message = e?.message || String(e);
      ToastLayer.showError(`Stake build failed: ${message}`);
      setSuccessMessage(`Stake build failed: ${message}`);
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
      if (exportMaths && canExportMaths) void buildFullStake(direntry);
      else exportFrontendOnly(direntry);
    });
    // Keep popup open so the confirmation message is visible
  }

  return (
    <>
      <StakeReadinessSection />
      <PopupSection>
        <Text hasBottomSpacing textType={TextType.DefaultContrast}>
          Build the game for Stake Engine: the frontend, with its Math Component played from Stake&apos;s books, and the
          maths as those books — one folder to upload.
        </Text>

        {successMessage && (
          <Text style={{ marginTop: '8px', fontSize: '12px', color: '#6f6', whiteSpace: 'pre-wrap' }}>{successMessage}</Text>
        )}

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

      <PopupSection>
        <Text hasBottomSpacing textType={TextType.DefaultContrast}>
          Maths — Stake Engine books, played by XGENIA RGS from the deployed component
        </Text>
        {!canExportMaths ? (
          <Text style={{ fontSize: '12px' }}>
            Connect XGENIA RGS and pick a game under Publish → XGENIA to export the game&apos;s maths (books, lookup
            tables and index.json) next to the front end.
          </Text>
        ) : (
          <>
            <Checkbox
              label={`Build with maths (${game!.name || game!.slug}): the Stake books go into <folder>/math/`}
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
                <Text style={{ fontSize: '12px' }}>
                  One mode per feature buy / special bet the component declares, plus the base game. Each book is one
                  paid round and the free rounds it bought, played exactly as /rgs-fn plays them. Payouts land on
                  Stake&apos;s 0.1× grid; the export reports every book that rounding moved.
                </Text>
              </>
            )}
          </>
        )}
      </PopupSection>
    </>
  );
}
