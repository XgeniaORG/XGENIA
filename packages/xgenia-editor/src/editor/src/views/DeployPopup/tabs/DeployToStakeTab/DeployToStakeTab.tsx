import { useModernModel } from '@xgenia-hooks/useModel';
import React, { useEffect, useState } from 'react';
import { filesystem } from '@xgenia/platform';

import { CloudService } from '@xgenia-models/CloudServices';
import { ProjectModel } from '@xgenia-models/projectmodel';
import { createEditorCompilation } from '@xgenia-utils/compilation/compilation.editor';
import { listEdgeDeployments } from '@xgenia-utils/rgs/deployEdgeFunction';
import { getActiveGame, getRgsSettings } from '@xgenia-utils/rgs/rgsClient';
import { exportStakeMaths } from '@xgenia-utils/stake/stakeMathsExport';
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
  const rgs = getRgsSettings();
  const game = getActiveGame();
  const canExportMaths = !!rgs?.apiKey && !!game?.id;
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
    if (!selected) {
      ToastLayer.showError('Pick the Math Component to export.');
      setSuccessMessage('Frontend exported. Maths not exported: pick the Math Component to export.');
      return;
    }

    setIsExporting(true);
    ToastLayer.showActivity('Exporting maths for Stake…', activityId);
    try {
      const result = await exportStakeMaths({
        apiKey: rgs!.apiKey,
        game: game ? { id: game.id, slug: game.slug, name: game.name } : null,
        deploymentId: selected.deploymentId,
        functionSlug: selected.slug,
        outputDir: direntry,
        booksPerMode: books,
        bet: betMinor,
        onProgress: (p) => {
          ToastLayer.showActivity(
            `Exporting maths for Stake — ${p.mode} (${p.modeIndex + 1}/${p.modeCount}): ` +
              `${p.books.toLocaleString()} / ${p.booksPerMode.toLocaleString()} books`,
            activityId
          );
        }
      });
      ToastLayer.hideActivity(activityId);
      ToastLayer.showSuccess(`Stake maths exported to ${result.publishDir}`);
      setSuccessMessage(
        `Stake export successful!\n` +
          `Maths: ${selected.name}, bet ${result.bet} minor units, seed ${result.masterSeed.slice(0, 12)}…\n` +
          `${summariseStakeModes(result.modes)}\n` +
          `Upload ${result.publishDir} as the game's math. ${result.manifestPath} holds the seed and statistics — keep it, do not upload it.`
      );
    } catch (e: any) {
      ToastLayer.hideActivity(activityId);
      const message = e?.message || String(e);
      ToastLayer.showError(`Stake maths export failed: ${message}`);
      setSuccessMessage(`Frontend exported. Maths export failed: ${message}`);
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
          Deploy a static frontend files to Stake.com (Pro Nodes)
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
          Maths — Stake Engine books, played on XGENIA RGS
        </Text>
        {!canExportMaths ? (
          <Text style={{ fontSize: '12px' }}>
            Connect XGENIA RGS and select a game in the Maths RGS panel to export the game&apos;s maths (books, lookup
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
