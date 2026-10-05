// Publish → Deploy (XGENIA tab), as a plain function.
//
// This is the routine that used to live inside XgeniaDeployTab as
// deployToRgsAndVercel: copy the project, point every deployed Math Component
// instance at its live XGENIA RGS endpoint, stamp the game and the telemetry
// mapping onto the copy, build it, push it to GitHub, have Vercel serve it, and
// list it on XGENIA RGS → Deployed Games. It moved out of the component so the
// AI (EditorBridge `publish.start`) runs THE SAME pipeline the Publish popup
// runs, not a second copy of it.
//
// It shows no UI. Every toast the popup used to raise mid-flight is a callback
// instead — onProgress for the activity line, onWarning for the heads-up
// findings, onLive for the moment the site is serving — so the popup keeps its
// exact messages and a caller without a screen gets the same facts as data.

import * as os from 'os';
import { filesystem, platform } from '@xgenia/platform';

import { createEditorCompilation } from '@xgenia-utils/compilation/compilation.editor';
import { duplicateCurrentProject, saveProject } from '@xgenia-utils/compile/duplicateProject';
import { LocalProjectsModel } from '@xgenia-utils/LocalProjectsModel';
import {
  mathsEndpointsForGame,
  repointMathsAggregators,
  swapDeployedMathsInstances,
  undeployedMathsInstances
} from '@xgenia-utils/rgs/deployMathsComponents';
import { loadSharedDeployTokens } from '@xgenia-utils/rgs/deployTokens';
import { registerDeployedGame } from '@xgenia-utils/rgs/deployedGames';
import { getActiveGame, getRgsSettings, RgsSettings, SelectedGame } from '@xgenia-utils/rgs/rgsClient';
import {
  CompleteTelemetryMapping,
  TELEMETRY_METADATA_KEY,
  toServerTelemetry
} from '@xgenia-utils/rgs/telemetryMapping';
import { ConnectionStore } from '@xgenia-services/ConnectionStore';

import { DOMAIN_NAME_REQUIRED, getFullDomain } from './deployDomain';
import { collectProjectFiles, deployToVercel, uploadToGitHub, VercelSDKWrapper } from './webDeploy';

// ─── Preconditions ────────────────────────────────────────────────────────────

/**
 * Why this project cannot be published to XGENIA RGS right now, or '' when it can.
 *
 * Which RGS game a frontend belongs to is NOT a publish-time choice: the Math
 * Components it calls were deployed into one specific game from the Maths RGS
 * panel, so that panel's selected game IS the answer. A second, independent
 * choice could only ever contradict it — publishing against game B while every
 * endpoint in the build belongs to game A.
 */
export function publishPreconditionError(rgs: RgsSettings | null, game: SelectedGame | null): string {
  if (!rgs?.apiKey) return 'Not connected to XGENIA RGS. Connect in the Maths RGS panel first.';
  if (!game?.id) return 'No game selected. Select one in the Maths RGS panel first.';
  return '';
}

/** The deploy tokens, and why they are missing when they are. */
export interface DeployCredentials {
  vercelToken: string | null;
  githubToken: string | null;
  /** loadSharedDeployTokens' reason, '' when the shared tokens loaded. */
  tokenError: string;
}

/**
 * Load the deploy tokens exactly as the Publish popup does when it opens:
 * initialise ConnectionStore, make sure the shared tokens from XGENIA RGS are
 * installed on `window.__XGENIA_DEFAULT_TOKENS__` (idempotent on success; a
 * failure is retried on the next call, since the usual cause is an operator key
 * the user can connect without restarting the editor), then read both tokens.
 */
export async function loadDeployCredentials(): Promise<DeployCredentials> {
  const store = ConnectionStore.getInstance();
  await store.initialize();
  const shared = await loadSharedDeployTokens();
  const vercelToken = await store.getToken('vercel');
  const githubToken = await store.getToken('github');
  return { vercelToken, githubToken, tokenError: shared.ok ? '' : shared.message };
}

/**
 * Are the deploy credentials actually here?
 *
 * Without the Vercel token every Vercel call throws "Cannot read properties of
 * null (reading 'projects')" at the user, naming nothing they can act on.
 * Publishing fails just as opaquely on the GitHub side, as GENERIC_DEPLOY_ERROR
 * ("Project compilation error") thrown out of uploadToGitHub, which is not a
 * compilation error and never was.
 *
 * Both really mean one thing: the shared tokens did not load. Say that, with
 * the reason loadSharedDeployTokens gave.
 *
 * @returns an error message, or '' when the credentials are present.
 */
export function deployCredentialError(state: DeployCredentials & { tokensLoaded: boolean }): string {
  if (!state.tokensLoaded) return 'Still loading deploy credentials — try again in a moment.';
  if (state.vercelToken && state.githubToken) return '';
  if (state.tokenError) return state.tokenError;
  const missing = [!state.vercelToken && 'Vercel', !state.githubToken && 'GitHub'].filter(Boolean).join(' and ');
  return `No ${missing} deploy token is available, so this cannot run.`;
}

// ─── Helpers moved with the routine ───────────────────────────────────────────

/**
 * The project.json of what was deployed, as sent to XGENIA RGS → Deployed Games.
 *
 * Taken from the published COPY rather than the open project, because the copy
 * is what actually went live: it carries the Aggregator swaps, the `rgsgame`
 * stamp and the telemetry mapping. Its `name` is the copy's "__<name>__"
 * scratch name, which is an artefact of publishing and not what anyone should
 * see on the platform, so the source project's name is written back over it.
 */
export function deployedProjectJson(copy: any, name: string): Record<string, unknown> {
  const json = copy.toJSON();
  return { ...json, name };
}

/** The editor's version string, or undefined where the platform layer can't say. */
export function editorVersion(): string | undefined {
  try {
    const version = platform.getVersion();
    return version ? String(version) : undefined;
  } catch (e) {
    return undefined;
  }
}

// Remove the "__<name>__" copy that publishing made: drop it from the projects
// list AND delete its files from disk, so repeated deploys don't pile up
// __<name>__-1, __<name>__-2, … next to the original project.
export function cleanupCompiledCopy(compiledDir: string) {
  if (!compiledDir) return;
  try {
    const entry = LocalProjectsModel.instance
      .getProjects()
      .find((p) => p.retainedProjectDirectory === compiledDir);
    if (entry) LocalProjectsModel.instance.removeProject(entry.id);
  } catch (e) {
    console.warn('Failed to unregister compiled project copy:', e);
  }
  try {
    filesystem.removeDirRecursive(compiledDir);
  } catch (e) {
    console.warn('Failed to delete compiled project copy from disk:', e);
  }
}

// ─── The routine ──────────────────────────────────────────────────────────────

/** How the published build reaches its backend. */
export interface PublishWiring {
  /** Math Component instances swapped for an Aggregator on their live endpoint. */
  swapped: number;
  /** Aggregators already in the graph, re-aimed at their component's current endpoint. */
  repointed: number;
  /** Components whose swapped Aggregator has nothing wired to a trigger — it can never call. */
  untriggered: string[];
  /** Components the UI uses that are not deployed — their maths runs in the player's browser. */
  undeployed: string[];
}

/**
 * "2 Math Component calls wired, 1 repointed at its current endpoint to Keno" —
 * how a publish's wiring is described in its success message.
 *
 * Two ways a call reaches RGS in this build: an instance the publish swapped for
 * an Aggregator, and an Aggregator the user dropped from Maths Components →
 * Deployed, which was already one and only needed its endpoint confirmed. Both
 * are worth reporting — a publish that repointed something silently changed
 * which code the game runs.
 */
export function describeWiring(wiring: Pick<PublishWiring, 'swapped' | 'repointed'>, gameName?: string): string {
  const { swapped, repointed } = wiring;
  const wiredParts = [
    swapped > 0 ? `${swapped} Math Component call${swapped === 1 ? '' : 's'} wired` : '',
    repointed > 0 ? `${repointed} repointed at ${repointed === 1 ? 'its' : 'their'} current endpoint` : ''
  ].filter(Boolean);
  return wiredParts.length > 0
    ? `${wiredParts.join(', ')} to ${gameName || 'XGENIA RGS'}`
    : 'no Math Component calls to wire';
}

/** The Deployed Games listing outcome, as the popup words it. */
export function describeRegistration(
  registered: { ok: boolean; publishNumber?: number; message?: string },
  name: string
): string {
  return registered.ok
    ? `Listed on XGENIA RGS → Deployed Games as "${name}" (publish #${registered.publishNumber ?? 1}).`
    : `The game is live, but XGENIA RGS could not list it under Deployed Games: ${registered.message}`;
}

/** Last path segment of a component name — "/#__maths__/Slot/Reels" → "Reels". */
function leafNames(names: string[]): string {
  return names.map((n) => n.split('/').filter(Boolean).pop()).join(', ');
}

/** The moment the site is serving — before it is listed on XGENIA RGS. */
export interface PublishGameLive {
  /** The URL Vercel actually bound (resolveLiveUrl — never a guessed one). */
  liveUrl: string;
  /** The hostname that was asked for, e.g. "my-game.vercel.app". */
  domain: string;
  deploymentId: string;
  /** "owner/repo" the build was pushed to. */
  githubRepo: string;
  wiring: PublishWiring;
}

export interface PublishGameOptions {
  /** The project to publish. It is COPIED on disk; the copy is what gets rewritten and built. */
  project: any;
  /** The Vercel project name — "my-game" of my-game.vercel.app. Validated by the caller. */
  domainName: string;
  telemetry: CompleteTelemetryMapping;
  /** Whether the source repository is private. Defaults to true, as the popup does. */
  isPrivate?: boolean;
  /** Read via rgsClient when omitted. */
  rgs?: RgsSettings | null;
  /** Read via rgsClient (the Maths RGS panel's selection) when omitted. */
  game?: SelectedGame | null;
  /** The deploy tokens; loaded the way the popup loads them when omitted. */
  tokens?: { github: string | null; vercel: string | null };
  /** One line per step — the popup shows these as its activity toast. */
  onProgress?: (step: string) => void;
  /** A heads-up finding, as soon as it is found. Also returned in `warnings`. */
  onWarning?: (message: string) => void;
  /** The site is live. Awaited, and called BEFORE the Deployed Games listing. */
  onLive?: (live: PublishGameLive) => void | Promise<void>;
}

export interface PublishGameResult {
  liveUrl: string;
  domain: string;
  deploymentId: string;
  githubRepo: string;
  /** XGENIA RGS → Deployed Games. A failure here is NOT a failed publish — the site is live. */
  registered: { ok: boolean; publishNumber?: number; message?: string };
  wiring: PublishWiring;
  warnings: string[];
  /** The RGS game the frontend calls. */
  game: { id: string; slug: string; name?: string };
  /** The name it was listed under: the open project's name. */
  name: string;
  /** The mapping that went live — `nodeId` is `data-xgenia-node-id` in the deployed page. */
  telemetry: CompleteTelemetryMapping;
}

/**
 * Publish to XGENIA RGS + Vercel.
 *
 * NO COMPILATION. The backend/frontend split is not decided here any more — it
 * was decided when the user put a component in "Math Components" and pressed
 * Deploy, which compiled it (nested layers inlined) and made it a real backend
 * component of a Server Version. So publishing has one job on the RGS side:
 * point the frontend at those live endpoints. Nothing is extracted, no Server
 * Version is opened, no component is deployed, and no post-compile setup card
 * interrupts it.
 *
 * What this replaced (in git history, if it is ever wanted back): compileProject
 * → extract each visual component's logic into /#__cloud__/__Component_N__ →
 * name it and map its bet/win ports in ComponentSetupDialog →
 * createEdgeDeployment + deployEdgeFunction → repoint each Aggregator at the URL
 * that came back.
 *
 * Throws with a plain-language message on anything that stops the site going
 * live (not connected, no game selected, no deploy tokens, nothing built,
 * GitHub/Vercel failures). The Deployed Games listing comes after the site is
 * live and never throws — see `registered`.
 */
export async function publishGameToWeb(opts: PublishGameOptions): Promise<PublishGameResult> {
  const rgs = opts.rgs === undefined ? getRgsSettings() : opts.rgs;
  const game = opts.game === undefined ? getActiveGame() : opts.game;
  const precondition = publishPreconditionError(rgs, game);
  if (precondition) throw new Error(precondition);

  const domainName = String(opts.domainName || '').trim();
  if (!domainName) throw new Error(DOMAIN_NAME_REQUIRED);
  if (!opts.project) throw new Error('No project is open.');

  let tokens = opts.tokens;
  if (!tokens) {
    const loaded = await loadDeployCredentials();
    tokens = { github: loaded.githubToken, vercel: loaded.vercelToken };
    const credentialError = deployCredentialError({ ...loaded, tokensLoaded: true });
    if (credentialError) throw new Error(credentialError);
  }
  if (!tokens.vercel) {
    throw new Error(deployCredentialError({ tokensLoaded: true, vercelToken: null, githubToken: tokens.github, tokenError: '' }));
  }
  const vercel = new VercelSDKWrapper({ bearerToken: tokens.vercel });

  const progress = (step: string) => opts.onProgress?.(step);
  const warnings: string[] = [];
  const warn = (message: string) => {
    warnings.push(message);
    opts.onWarning?.(message);
  };

  // 1. Copy the project on disk. Publishing rewrites node graphs below, and
  //    that must never touch the project the user has open.
  progress('Preparing project...');
  const sourceName = String(opts.project?.name || domainName);
  const { copy, destDir: publishDir } = await duplicateCurrentProject(opts.project);

  try {
    // 2. Point every instance of a DEPLOYED Math Component at its live
    //    `/rgs-fn/<game>/<slug>` endpoint, by swapping the instance for an
    //    Aggregator node — the existing frontend→backend caller, whose payload
    //    and response shape is exactly the deployed script's contract.
    progress('Wiring Math Components to XGENIA RGS...');
    const endpoints = await mathsEndpointsForGame(rgs.apiKey, game.id, copy);
    const { swapped, untriggered } = swapDeployedMathsInstances(copy, endpoints);

    // Aggregators the user placed themselves, by dragging a component out of
    // Maths Components → Deployed, carry the endpoint they had at drag time.
    // Renaming or refiling the component since then moved its slug, and the
    // stale URL still resolves — to the OLD code. Re-aim them at the current one.
    // Reported in the success message rather than logged: this build strips every
    // console.* call (TerserPlugin drop_console), so a log here would say nothing
    // to anyone.
    const repointed = repointMathsAggregators(copy, endpoints);

    // An Aggregator only POSTs when one of its `do-` inputs pulses. An instance
    // whose trigger port is unwired therefore ships as a node that can never
    // call its backend — the endpoint is live and correct, and the published UI
    // simply never reaches it. Silent in the browser, so say it here.
    if (untriggered.length > 0) {
      console.warn('[Deploy] Math Component instances with no trigger wired:', untriggered);
      warn(
        `Heads up: nothing is wired to the trigger input of ${leafNames(untriggered)}, so the published game ` +
          `will never call ${untriggered.length === 1 ? 'it' : 'them'}. Connect a signal ` +
          `(a button's Click, for example) to ${untriggered.length === 1 ? 'its' : 'their'} ` +
          `Do port and publish again.`
      );
    }

    // A Math Component that the UI uses but nobody deployed is now shipped
    // as-is and RUNS IN THE BROWSER — there is no compile pass left to extract
    // it. That is a real thing to know about a published game, so say it
    // plainly instead of quietly building it.
    const undeployed = undeployedMathsInstances(copy, endpoints);
    if (undeployed.length > 0) {
      console.warn('[Deploy] Math Components used by the UI but not deployed:', undeployed);
      warn(
        `Heads up: ${leafNames(undeployed)} ${undeployed.length === 1 ? 'is' : 'are'} not deployed to ` +
          `${game.name || 'this game'}, so ${undeployed.length === 1 ? 'its' : 'their'} maths will run in the ` +
          `player's browser. Deploy ${undeployed.length === 1 ? 'it' : 'them'} from Maths RGS → Math Components.`
      );
    }

    // 3. Stamp the game onto the copy, so the deployed frontend knows which RGS
    //    game it IS. Aggregator calls get this for free — their function URL
    //    carries the game slug — but the cashier nodes (Deposit Balance,
    //    Withdraw Balance) call player-scoped RPCs that see only a player and an
    //    amount, so without this their rows land on the platform's Transactions
    //    page with no game at all. Read back at runtime by resolveRgsGame in
    //    rgs-config.js. Stamped on the COPY, so the user's own project is left
    //    untouched and switching games never leaves a stale id behind.
    copy.setMetaData('rgsgame', { id: game.id, name: game.name, slug: game.slug });
    // The bet / win / bet-button mapping. On the copy for the same reason as
    // `rgsgame`: the deployed build should carry its own answer. Callers keep
    // the user's project's copy of it themselves (so the next publish is
    // pre-filled) — that is a choice about the open project, not about this build.
    copy.setMetaData(TELEMETRY_METADATA_KEY, opts.telemetry);

    await saveProject(copy, publishDir);

    // 4. Build and Vercel-deploy the COPY.
    const tempDir = filesystem.join(os.tmpdir(), `xgenia-deploy-${Date.now()}`);
    await filesystem.makeDirectory(tempDir);
    try {
      progress('Building UI bundle...');
      // Skip the built-in Supabase/Parse cloud-function pass: this build has no
      // cloud environment, and its backend is on RGS, so that pass would only
      // error with "No cloud service to deploy cloud functions to".
      const compilation = createEditorCompilation(copy, { skipBuiltinCloudFunctionDeploy: true }).addProjectBuildScripts();
      await compilation.deployToFolder(tempDir, { environment: undefined });

      const files = await collectProjectFiles(tempDir);
      if (files.length === 0) throw new Error('No files were generated during deployment');

      // GitHub upload — the progress line deliberately says nothing about GitHub.
      progress('Preparing project for deployment...');
      const repositoryName = `${domainName}-${Date.now()}`;
      const { repoOwner, repoName: actualRepoName } = await uploadToGitHub(
        tokens.github,
        files,
        repositoryName,
        opts.isPrivate !== false
      );

      progress('Deploying to Vercel...');
      const { deploymentId, aliasUrl } = await deployToVercel(vercel, repoOwner, actualRepoName, domainName);

      const githubRepo = `${repoOwner}/${actualRepoName}`;
      const domain = getFullDomain(domainName);
      const wiring: PublishWiring = { swapped, repointed, untriggered, undeployed };
      await opts.onLive?.({ liveUrl: aliasUrl, domain, deploymentId, githubRepo, wiring });

      // 5. List it on XGENIA RGS → Deployed Games: the whole project.json that
      //    went live, the telemetry mapping, and where it is reachable. Vercel
      //    is serving the site by now, so this records something that exists;
      //    a failure here is reported and is never a failed publish.
      progress('Listing the game on XGENIA RGS...');
      const registered = await registerDeployedGame(rgs.apiKey, {
        name: sourceName,
        slug: domainName,
        domain,
        liveUrl: aliasUrl,
        vercelDeploymentId: deploymentId,
        githubRepo,
        game: { id: game.id, slug: game.slug, name: game.name },
        telemetry: toServerTelemetry(opts.telemetry),
        projectJson: deployedProjectJson(copy, sourceName),
        editorVersion: editorVersion()
      });
      if (!registered.ok) {
        console.warn('[Deploy] Deployed Games registration failed:', registered.message);
      }

      try { filesystem.removeDirRecursive(tempDir); } catch (e) { /* ignore */ }

      return {
        liveUrl: aliasUrl,
        domain,
        deploymentId,
        githubRepo,
        registered: registered.ok
          ? { ok: true, publishNumber: registered.publishNumber }
          : { ok: false, message: registered.message },
        wiring,
        warnings,
        game: { id: game.id, slug: game.slug, name: game.name },
        name: sourceName,
        telemetry: opts.telemetry
      };
    } catch (err) {
      try { filesystem.removeDirRecursive(tempDir); } catch (e) { /* ignore */ }
      throw err;
    }
  } finally {
    // Success or failure, don't leave a __<name>__ copy behind.
    cleanupCompiledCopy(publishDir);
  }
}
