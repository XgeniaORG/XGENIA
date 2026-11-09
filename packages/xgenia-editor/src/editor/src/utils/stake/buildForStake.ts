/**
 * Build a game for Stake Engine: the frontend with its Math Component played from the Stake book, and the
 * maths as Stake books — one folder, ready to upload (2026-11-09).
 *
 * WHY. "Deploy to Stake" used to write the frontend as it was: the Math Component stayed in the bundle and
 * decided outcomes in the player's browser, unrelated to anything Stake paid, and the maths export was off.
 * This mirrors Publish (utils/publish/publishGame.ts), which already swaps every Math Component instance for an
 * Aggregator that calls the RGS — on a COPY of the project, never the open one. For Stake the Aggregator gets
 * transport "stake" (utils/stake/stakeConnector.ts): the runtime's Stake Book Session plays one /wallet/play
 * per bet and answers every following round from that book (xgenia-runtime stake-book-session.js).
 *
 *   1. ask the platform what the component is (ports, modes) — with the modes the Bet Mode node declares;
 *   2. copy the project; swap the Math Component for the connector, configured from (1) and the export bet;
 *   3. refuse if any Math Component instance is left (its maths would run in the browser);
 *   4. build the copy into <folder> as a Stake frontend;
 *   5. export the books into <folder>/math (stakeMathsExport.ts);
 *   6. remove the copy.
 *
 * The connector's settings are worked out by stakeConnectorConfigFor (stakeConnector.ts, pure, tested in
 * tests/deploy/stakeConnectorWiring.test.ts). The rest needs the editor and is exercised from the Stake tab.
 */
import { filesystem } from '@xgenia/platform';

import { createEditorCompilation } from '@xgenia-utils/compilation/compilation.editor';
import { duplicateCurrentProject, saveProject } from '@xgenia-utils/compile/duplicateProject';
import { dropUnusedMathsComponents } from '@xgenia-utils/publish/mathsStaysOnRgs';
import { cleanupCompiledCopy } from '@xgenia-utils/publish/publishGame';
import { swapDeployedMathsInstances } from '@xgenia-utils/rgs/deployMathsComponents';

import { leftoverMathsInstances, stakeConnectorConfigFor, stakeMathsEndpoints, type StakeConnectorConfig } from './stakeConnector';
import { exportStakeMaths, fetchStakeExportModes, type StakeExportResult } from './stakeMathsExport';
import { declaredStakeModes, stakeModeInput } from './stakeModes';

export interface BuildForStakeOptions {
  project: any;
  /** The export folder. */
  direntry: string;
  apiKey: string;
  game: { id: string; slug?: string; name?: string };
  /** The deployed component the game plays (Stake tab's pick). */
  component: { deploymentId: string; slug: string; name: string };
  booksPerMode: number;
  /** Minor units; the platform's default for the game when omitted. */
  bet?: number;
  oversample?: number;
  environment?: any;
  onStep?: (step: string) => void;
  onMathsProgress?: Parameters<typeof exportStakeMaths>[0]['onProgress'];
}

export interface BuildForStakeResult {
  maths: StakeExportResult;
  connector: StakeConnectorConfig;
  swapped: number;
}

/** The Math Component (by name) whose deployed slug is `slug`. */
function mathsComponentForSlug(project: any, slug: string, fallbackName: string): string | null {
  const names: string[] = (project?.components || []).map((c: any) => c?.name).filter((n: any) => typeof n === 'string' && n.startsWith('/#__maths__/'));
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return names.find((n) => norm(n.split('/').pop() || '') === norm(slug)) || names.find((n) => n === fallbackName) || (names.length === 1 ? names[0] : null);
}

export async function buildForStake(o: BuildForStakeOptions): Promise<BuildForStakeResult> {
  const step = (s: string) => o.onStep?.(s);
  const projectJson = o.project?.toJSON?.();
  const modes = declaredStakeModes(projectJson);
  const modeInput = stakeModeInput(projectJson);

  step('Reading the Math Component from XGENIA RGS…');
  const info = await fetchStakeExportModes(o.apiKey, o.component.deploymentId, o.component.slug, modes);
  const exportBet = Math.floor(o.bet && o.bet > 0 ? o.bet : info.defaultBet);
  const connector = stakeConnectorConfigFor({ betInputPort: info.betInputPort, winOutputPort: info.winOutputPort, exportBet, modes, modeInput });

  step('Preparing a copy of the project…');
  const { copy, destDir } = await duplicateCurrentProject(o.project);
  let swapped = 0;
  try {
    const componentName = mathsComponentForSlug(copy, o.component.slug, o.component.name);
    if (!componentName) throw new Error(`Could not tell which Math Component of this project is "${o.component.name}". Open Maths and deploy it again.`);
    const endpoints = stakeMathsEndpoints(copy, (name) => (name === componentName ? connector : null));
    swapped = swapDeployedMathsInstances(copy, endpoints).swapped;
    const left = leftoverMathsInstances(copy.toJSON?.() ?? copy);
    if (left.length) {
      throw new Error(`${left.join(', ')} would run in the player's browser on Stake: only ${componentName} is played from the Stake books. Use one Math Component for the game's rounds.`);
    }
    if (swapped === 0) throw new Error(`No screen uses ${componentName}, so the Stake build would never play a round.`);
    dropUnusedMathsComponents(copy);
    await saveProject(copy, destDir);

    step('Building the Stake frontend…');
    const compilation = createEditorCompilation(copy, { skipBuiltinCloudFunctionDeploy: true }).addProjectBuildScripts();
    await compilation.deployToFolder(o.direntry, { environment: o.environment, runtimeType: 'stake' });

    step('Exporting the maths as Stake books…');
    const maths = await exportStakeMaths({
      apiKey: o.apiKey,
      game: o.game,
      deploymentId: o.component.deploymentId,
      functionSlug: o.component.slug,
      outputDir: o.direntry,
      booksPerMode: o.booksPerMode,
      bet: exportBet,
      oversample: o.oversample,
      stakeModes: modes,
      onProgress: o.onMathsProgress
    });
    // The connector settings travel with the export, for support and for the Stake harness.
    await filesystem.writeFileOverride(
      filesystem.join(maths.dir, 'xgenia-stake-connector.json'),
      JSON.stringify({ component: componentName, connector, swapped }, null, 2)
    );
    return { maths, connector, swapped };
  } finally {
    cleanupCompiledCopy(destDir);
  }
}
