// Math Components → Deploy, for a caller without the Maths RGS panel (the AI's
// `publish.start` with kind 'maths').
//
// Same building blocks as the panel's Deploy (MathsPanel
// handleDeployMathsComponents): compare the project against what is deployed
// (loadMathsStatus), deploy only what changed (deployMathsComponents with
// onlySlugs), then record the commit (commitFilesForDeploy + createComponentCommit).
//
// Two deliberate differences:
//   * The target is the active game's NEWEST Server Version — the panel's own
//     default — because there is no row for the AI to click. A game with no
//     version yet gets one, named after the project, as "＋ New version" would.
//   * It NEVER deletes. A component removed from the project stays live on RGS
//     and is reported in `notDeleted`: taking an endpoint offline can break a
//     game already in the wild, so that stays a human action in the panel.

import { ProjectModel } from '@xgenia-models/projectmodel';
import { EventDispatcher } from '@xgenia-shared/utils/EventDispatcher';
import { commitFilesForDeploy, createComponentCommit } from '@xgenia-utils/rgs/componentCommits';
import { listEdgeDeployments } from '@xgenia-utils/rgs/deployEdgeFunction';
import {
  createEmptyServerVersion,
  deployMathsComponents,
  listMathsComponents
} from '@xgenia-utils/rgs/deployMathsComponents';
import { loadMathsStatus, MathsComponentStatus } from '@xgenia-utils/rgs/mathsComponentStatus';
import { MATHS_DEPLOYED_ELSEWHERE } from '@xgenia-utils/rgs/mathsDeployState';
import { fetchOperatorInfo, getActiveGame, getRgsSettings } from '@xgenia-utils/rgs/rgsClient';

import { publishPreconditionError } from './publishGame';

/** A Server Version, as far as a deploy needs one. */
export interface ServerVersionRef {
  deploymentId: string;
  version: number;
  name?: string;
}

/**
 * The game's newest Server Version, or null when it has none — the one the
 * Maths RGS panel's Deploy targets until the user clicks another row.
 */
export async function newestServerVersion(apiKey: string, gameId: string): Promise<ServerVersionRef | null> {
  const deployments = await listEdgeDeployments(apiKey, gameId);
  // maths-deployer already answers newest first; sorting again keeps that a
  // fact about this function rather than about the server.
  const newest = deployments.slice().sort((a: any, b: any) => (Number(b?.version) || 0) - (Number(a?.version) || 0))[0];
  return newest?.id ? { deploymentId: newest.id, version: Number(newest.version) || 0, name: newest.name } : null;
}

/** A component named the way the panel lists it, with its endpoint when it has one. */
export interface MathsComponentRef {
  /** "Adder / Add with 5" — the path below the Math Components sheet. */
  name: string;
  slug: string;
  endpoint?: string;
}

export interface DeployedMathsComponent extends MathsComponentRef {
  /** Full component name, e.g. "/#__maths__/Adder/Add with 5". */
  componentName: string;
  change: 'added' | 'modified';
  endpoint: string;
  /** False when the script deployed but its authored project.json did not upload. */
  projectUploaded: boolean;
  projectError?: string;
  betInputPort: string | null;
  winOutputPort: string | null;
}

export interface ChangedMathsDeployResult {
  game: { id: string; slug: string; name?: string };
  /** The Server Version deployed into; null when the project has no Math Components at all. */
  serverVersion: { deploymentId: string; version: number; created: boolean } | null;
  deployed: DeployedMathsComponent[];
  unchanged: MathsComponentRef[];
  /** Removed from the project but still live on RGS — deleting is left to the user. */
  notDeleted: MathsComponentRef[];
  /** Null when nothing was deployed, so there was nothing to record. */
  commit: { recorded: boolean; commitId?: string; message?: string; error?: string } | null;
  warnings: string[];
  /** One sentence for a toast or a reply. */
  message: string;
}

const NOT_DELETED_NOTE =
  'removed from the project but still live on XGENIA RGS — deleting a deployed component is left to you: ' +
  'Maths RGS panel → Math Components → Deploy applies removals.';

function refOf(status: MathsComponentStatus): MathsComponentRef {
  return { name: status.displayName, slug: status.slug, ...(status.url ? { endpoint: status.url } : {}) };
}

/**
 * Deploy the open project's ADDED and MODIFIED Math Components into the active
 * game's newest Server Version, and record the commit.
 *
 * Nothing to deploy — everything already matches, or the project has no Math
 * Components at all (its maths then runs in the page) — is an answer, not an
 * error: `deployed` comes back empty and `message` says why.
 *
 * Throws with a plain-language message when deploying fails (not connected, no
 * game, a component that will not compile, an RGS error).
 * A commit that cannot be recorded does NOT fail it — the components are live by
 * then — and comes back as `commit.recorded: false` plus a warning.
 */
export async function deployChangedMathsComponents(
  opts: { commitMessage?: string; onProgress?: (step: string) => void } = {}
): Promise<ChangedMathsDeployResult> {
  const progress = (step: string) => opts.onProgress?.(step);
  const rgs = getRgsSettings();
  const game = getActiveGame();
  const precondition = publishPreconditionError(rgs, game);
  if (precondition) throw new Error(precondition);

  const project: any = ProjectModel.instance;
  if (!project) throw new Error('No project is open.');
  if (listMathsComponents(project).length === 0) {
    return {
      game: { id: game.id, slug: game.slug, name: game.name },
      serverVersion: null,
      deployed: [],
      unchanged: [],
      notDeleted: [],
      commit: null,
      warnings: [],
      message: 'Nothing to deploy — this project has no Math Components.'
    };
  }

  progress('Reading what is deployed…');
  let target = await newestServerVersion(rgs.apiKey, game.id);
  let created = false;
  if (!target) {
    progress('Creating a server version…');
    // Named after the open project, same as the panel's "＋ New version", so
    // the version is recognisable in the RGS studio's Versions tab.
    const fresh = await createEmptyServerVersion(rgs.apiKey, game.id, project.name || game.name || 'Server Version');
    target = { deploymentId: fresh.deploymentId, version: fresh.version };
    created = true;
  }

  const status = await loadMathsStatus(rgs.apiKey, target.deploymentId, project);
  const toDeploy = status.changed.filter((c) => c.kind === 'added' || c.kind === 'modified');
  const notDeleted = status.changed.filter((c) => c.kind === 'deleted').map(refOf);
  const unchanged = status.all.filter((c) => c.kind === 'unchanged').map(refOf);
  const warnings: string[] = [];
  if (notDeleted.length > 0) {
    warnings.push(`${notDeleted.map((c) => c.name).join(', ')}: ${NOT_DELETED_NOTE}`);
  }

  const base = {
    game: { id: game.id, slug: game.slug, name: game.name },
    serverVersion: { deploymentId: target.deploymentId, version: target.version, created },
    unchanged,
    notDeleted
  };

  if (toDeploy.length === 0) {
    if (created) EventDispatcher.instance.emit(MATHS_DEPLOYED_ELSEWHERE, { gameId: game.id, deploymentId: target.deploymentId });
    return {
      ...base,
      deployed: [],
      commit: null,
      warnings,
      message: 'Nothing to deploy — every component matches what is already deployed.'
    };
  }

  const results = await deployMathsComponents(project, {
    apiKey: rgs.apiKey,
    gameId: game.id,
    deploymentId: target.deploymentId,
    version: target.version,
    onlySlugs: new Set(toDeploy.map((c) => c.slug)),
    onProgress: progress
  });

  // Record what just happened. AFTER the deploy, never before: a commit written
  // up front would claim a deploy that might still fail. Never with deletions —
  // this path makes none.
  const kindBySlug = new Map(toDeploy.map((c) => [c.slug, c.kind]));
  const names = results.map((r) => r.functionName);
  const commitMessage =
    (opts.commitMessage && String(opts.commitMessage).trim()) ||
    `Deploy ${names.join(', ')}`.slice(0, 200);
  let commit: ChangedMathsDeployResult['commit'];
  try {
    progress('Recording commit…');
    // The panel credits the connected operator; so does this, when it can say who that is.
    const author = await fetchOperatorInfo(rgs.apiKey)
      .then((info) => info?.name || undefined)
      .catch((): undefined => undefined);
    const recorded = await createComponentCommit(
      rgs.apiKey,
      game.id,
      target.deploymentId,
      commitMessage,
      commitFilesForDeploy(results, status),
      author
    );
    commit = { recorded: true, commitId: recorded.commitId, message: commitMessage };
  } catch (e: any) {
    const error = e?.message || 'the commit could not be recorded';
    console.error('[MathsComponents] commit failed:', e);
    commit = { recorded: false, message: commitMessage, error };
    warnings.push(`The components are live, but ${error} — only the history entry is missing.`);
  }

  // Said out loud for the same reasons the panel says them: a live backend with
  // no readable graph stored, one that sees a stake of 0 until its bet/win
  // mapping is set, and nodes that do nothing on the server.
  results.forEach((r) => {
    if (!r.projectUploaded) warnings.push(`${r.functionName}: project.json upload failed: ${r.projectError || 'unknown error'}`);
    if (r.betWinWarning) warnings.push(r.betWinWarning);
    if (r.unsupportedNodeWarning) warnings.push(r.unsupportedNodeWarning);
  });

  // The Maths RGS panel re-reads versions, what is deployed and the commits.
  EventDispatcher.instance.emit(MATHS_DEPLOYED_ELSEWHERE, { gameId: game.id, deploymentId: target.deploymentId });

  return {
    ...base,
    deployed: results.map((r) => ({
      name: r.functionName,
      componentName: r.componentName,
      slug: r.slug,
      endpoint: r.url,
      change: kindBySlug.get(r.slug) === 'added' ? 'added' : 'modified',
      projectUploaded: r.projectUploaded,
      ...(r.projectError ? { projectError: r.projectError } : {}),
      betInputPort: r.betInputPort,
      winOutputPort: r.winOutputPort
    })),
    commit,
    warnings,
    message:
      `v${target.version}: ${results.length} component${results.length === 1 ? '' : 's'} deployed ` +
      `(${names.join(', ')})` +
      (commit?.recorded ? ' and committed.' : '.')
  };
}
