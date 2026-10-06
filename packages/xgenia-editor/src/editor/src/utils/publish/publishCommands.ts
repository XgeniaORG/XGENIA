// The AI's publish commands — EditorBridge `publish.status`, `publish.checkName`,
// `publish.start` and `publish.job` — as plain functions, so the bridge only routes.
//
// Nothing here is a second publish pipeline. A game publish is publishGameToWeb,
// the routine the Publish popup runs; a maths deploy is
// deployChangedMathsComponents, built from the Maths RGS panel's own pieces; names
// are checked with the popup's rules and availability check. What this adds is
// only what a caller without a screen needs:
//
//   * answers as data, and a deadline on every plain call — the relay gives a
//     bridge command 30 s, so nothing here may hang on a slow network;
//   * the long work (minutes) as a background job: `publish.start` validates and
//     answers at once with a job id, `publish.job` reports its steps and result.
//
// The user still sees it happen: a job narrates through an editor toast, a game
// publish drives the same publish pill as the popup (PublishState, via the
// popup's toast id), and its domain lands in the popup's Deployed Domains list,
// where it can be renamed or deleted like any other.

import { ProjectModel } from '@xgenia-models/projectmodel';
import { PublishState } from '@xgenia-models/publishstate';
import { listMathsComponents, mathsComponentDisplayName, mathsComponentSlug } from '@xgenia-utils/rgs/deployMathsComponents';
import { loadMathsStatus } from '@xgenia-utils/rgs/mathsComponentStatus';
import { getActiveGame, getRgsSettings, listGames, RgsSettings, SelectedGame } from '@xgenia-utils/rgs/rgsClient';
import {
  CompleteTelemetryMapping,
  TELEMETRY_METADATA_KEY,
  TelemetryElementRef,
  TelemetryRequest
} from '@xgenia-utils/rgs/telemetryMapping';
import { resolveTelemetryMapping, storedTelemetryMapping } from '@xgenia-utils/rgs/uiNodeCandidates';

import { ToastLayer } from '../../views/ToastLayer/ToastLayer';
import { deployChangedMathsComponents, newestServerVersion } from './deployChangedMaths';
import { domainUnavailableMessage, getFullDomain, normalizeDomainName, vercelProjectName } from './deployDomain';
import { getDeviceId, persistedAccountId, readOwnedDomains, saveDeployedDomain } from './deployedDomains';
import {
  deployCredentialError,
  describeRegistration,
  describeWiring,
  loadDeployCredentials,
  publishGameToWeb,
  publishPreconditionError
} from './publishGame';
import { createPublishJobRegistry, PublishJobStart, withTimeout } from './publishJobs';
import { checkDomainAvailability, VercelSDKWrapper } from './webDeploy';

/**
 * The Publish popup's activity toast id. Reusing it is what makes an AI publish
 * drive the topbar publish pill: PublishState takes its step labels from this
 * toast (see publishstate.ts).
 */
const GAME_ACTIVITY_ID = 'deploying-to-vercel';
const MATHS_ACTIVITY_ID = 'ai-deploying-maths-components';

/** Each network read in a plain (non-job) command; several run in parallel, all well inside 30 s. */
const READ_TIMEOUT_MS = 8000;
/** The availability check in `publish.checkName`. */
const AVAILABILITY_TIMEOUT_MS = 10000;
/** The same reads inside a running job, which no editor-command timeout bounds. */
const JOB_NETWORK_TIMEOUT_MS = 30000;

// 20 min: past every step's own limit (Vercel's 2-minute poll, the build, a slow asset upload).
const jobs = createPublishJobRegistry({ keepFinished: 10, maxRunMs: 20 * 60_000 });

const messageOf = (e: any): string => String(e?.message || e || 'failed');

/** Whose Deployed Domains list this editor writes to — as the popup decides it. */
function domainOwner() {
  return { accountId: persistedAccountId(), deviceId: getDeviceId() };
}

/**
 * This editor's own earlier publish under `name`, if there is one.
 *
 * The availability check refuses every name that already has a Vercel project
 * in the team — right for a stranger's project (the team is shared by every
 * editor), wrong for the user's own earlier publish of this game, which the AI
 * has to be able to update under the same link. The Deployed Domains list is
 * what says a project is ours: a name in it is a RE-publish, not a clash.
 * (The popup still refuses it; this only widens the AI's path.)
 */
function ownDeployedDomain(name: string) {
  try {
    return readOwnedDomains(domainOwner()).find((d) => vercelProjectName(d.name) === name) || null;
  } catch {
    return null;
  }
}

function plainRef(ref: TelemetryElementRef | null) {
  return ref
    ? {
        nodeId: ref.nodeId,
        label: ref.label,
        typename: ref.typename,
        typeLabel: ref.typeLabel,
        componentName: ref.componentName,
        pickedFrom: ref.pickedFrom
      }
    : null;
}

// ─── publish.status ───────────────────────────────────────────────────────────

/** The active game as the panel stored it, plus its mode and status from XGENIA RGS when that answers. */
async function activeGameDetails(rgs: RgsSettings | null, game: SelectedGame | null): Promise<Record<string, any> | null> {
  if (!game?.id) return null;
  const stored: any = game;
  const details: Record<string, any> = {
    id: stored.id,
    slug: stored.slug,
    name: stored.name,
    ...(stored.status ? { status: stored.status } : {})
  };
  if (!rgs?.apiKey) return details;
  try {
    const games = await withTimeout(listGames(rgs.apiKey), READ_TIMEOUT_MS, 'XGENIA RGS (list-games)');
    const live = games.find((g: any) => g?.id === game.id);
    if (!live) return { ...details, note: 'This key cannot see the selected game any more — select one in the Maths RGS panel.' };
    return { ...details, name: live.name ?? details.name, slug: live.slug ?? details.slug, status: live.status, mode: live.mode };
  } catch (e) {
    return { ...details, note: `Mode/status unknown: ${messageOf(e)}` };
  }
}

/** Every Math Component, local and deployed, against the active game's newest Server Version. */
async function mathsComponentStates(rgs: RgsSettings | null, game: SelectedGame | null, project: any) {
  const locals = listMathsComponents(project).map((c: any) => ({
    name: mathsComponentDisplayName(c),
    slug: mathsComponentSlug(c),
    componentName: c.name
  }));
  const unknown = (error?: string) => ({
    components: locals.map((c) => ({ ...c, state: 'unknown' })),
    serverVersion: null as any,
    ...(error ? { error } : {})
  });
  if (!project) return unknown('No project is open.');
  if (!rgs?.apiKey || !game?.id) return unknown();

  try {
    const target = await withTimeout(newestServerVersion(rgs.apiKey, game.id), READ_TIMEOUT_MS, 'XGENIA RGS (list-edge-deployments)');
    if (!target) {
      // No Server Version yet: nothing is deployed, so everything local is new.
      return { components: locals.map((c) => ({ ...c, state: 'added' })), serverVersion: null as any };
    }
    const status = await withTimeout(
      loadMathsStatus(rgs.apiKey, target.deploymentId, project),
      READ_TIMEOUT_MS,
      'XGENIA RGS (download-edge-deployment)'
    );
    return {
      components: status.all.map((s) => ({
        name: s.displayName,
        slug: s.slug,
        componentName: s.componentName,
        state: s.kind === 'unchanged' ? 'deployed' : s.kind,
        ...(s.url ? { endpoint: s.url } : {})
      })),
      serverVersion: { deploymentId: target.deploymentId, version: target.version }
    };
  } catch (e) {
    return unknown(messageOf(e));
  }
}

async function deployTokensState(): Promise<{ ready: boolean; error?: string }> {
  try {
    const credentials = await withTimeout(loadDeployCredentials(), READ_TIMEOUT_MS, 'Loading the deploy tokens');
    const error = deployCredentialError({ ...credentials, tokensLoaded: true });
    return error ? { ready: false, error } : { ready: true };
  } catch (e) {
    return { ready: false, error: messageOf(e) };
  }
}

/**
 * What a publish would work with right now: the RGS connection and game, the
 * Math Components' deploy state, the saved telemetry mapping, whether the deploy
 * tokens are here, and what this editor has published before.
 */
export async function publishStatus() {
  const project: any = ProjectModel.instance;
  const rgs = getRgsSettings();
  const game = getActiveGame();

  const [activeGame, maths, tokens] = await Promise.all([
    activeGameDetails(rgs, game),
    mathsComponentStates(rgs, game, project),
    deployTokensState()
  ]);

  const saved = project ? storedTelemetryMapping(project) : null;
  let deployedDomains: any[] = [];
  let deployedDomainsError: string | undefined;
  try {
    deployedDomains = readOwnedDomains(domainOwner()).map((d) => ({
      name: vercelProjectName(d.name),
      domain: getFullDomain(d.name),
      url: d.url,
      deploymentId: d.id,
      deployedAt: d.deployedAt,
      updatedAt: d.updatedAt
    }));
  } catch (e) {
    deployedDomainsError = messageOf(e);
  }

  const running = jobs.running();
  return {
    connected: !!rgs?.apiKey,
    activeGame,
    mathsComponents: maths.components,
    mathsServerVersion: maths.serverVersion,
    ...(maths.error ? { mathsError: maths.error } : {}),
    savedTelemetry: saved
      ? { betInput: plainRef(saved.betInput), winOutput: plainRef(saved.winOutput), betButton: plainRef(saved.betButton) }
      : null,
    deployTokensReady: tokens.ready,
    ...(tokens.error ? { deployTokensError: tokens.error } : {}),
    deployedDomains,
    ...(deployedDomainsError ? { deployedDomainsError } : {}),
    runningJob: running ? { jobId: running.jobId, kind: running.kind, step: running.step } : null
  };
}

// ─── publish.checkName ────────────────────────────────────────────────────────

/**
 * Is this name acceptable, and is "<name>.vercel.app" free to publish under?
 * The popup's validation and availability check. `available: null` means it
 * could not tell (no deploy tokens, or no answer within 10 s) — `reason` says why.
 */
export async function checkPublishName(input: unknown) {
  const { name, error } = normalizeDomainName(input);
  if (error) return { valid: false, available: false, name, url: null as string | null, reason: error };
  const url = `https://${getFullDomain(name)}`;

  let credentials;
  try {
    credentials = await withTimeout(loadDeployCredentials(), READ_TIMEOUT_MS, 'Loading the deploy tokens');
  } catch (e) {
    return { valid: true, available: null as boolean | null, name, url, reason: messageOf(e) };
  }
  if (!credentials.vercelToken) {
    return {
      valid: true,
      available: null as boolean | null,
      name,
      url,
      reason: deployCredentialError({ ...credentials, tokensLoaded: true })
    };
  }

  try {
    const availability = await withTimeout(
      checkDomainAvailability(new VercelSDKWrapper({ bearerToken: credentials.vercelToken }), name),
      AVAILABILITY_TIMEOUT_MS,
      'The availability check'
    );
    if (availability.available) return { valid: true, available: true, name, url };
    const own = availability.reason === 'existing-project' ? ownDeployedDomain(name) : null;
    if (own) {
      return {
        valid: true,
        available: true,
        republish: true,
        name,
        url: own.url || url,
        reason: 'Published from this editor before — publishing again replaces it at the same link.'
      };
    }
    return { valid: true, available: false, name, url, reason: domainUnavailableMessage(name, availability.reason) };
  } catch (e) {
    return { valid: true, available: null as boolean | null, name, url, reason: messageOf(e) };
  }
}

// ─── publish.start / publish.job ──────────────────────────────────────────────

export interface PublishStartSpec {
  kind: 'maths' | 'game';
  /** kind 'maths': the commit message. */
  commitMessage?: string;
  /** kind 'maths': recompile and redeploy unchanged components too (deployChangedMathsComponents). */
  redeployAll?: boolean;
  /** kind 'game': the subdomain — "my-game" of my-game.vercel.app. */
  name?: string;
  /** kind 'game': each field a node id or label; omitted fields reuse the project's saved choice. */
  telemetry?: TelemetryRequest;
  /** kind 'game': whether the source repository is private. Default true, as in the popup. */
  isPrivate?: boolean;
}

/** A game publish: the popup's onDeployToVercelClicked + deployToRgsAndVercel, with the form already answered. */
async function runGameJob(
  args: {
    name: string;
    telemetry: CompleteTelemetryMapping;
    isPrivate: boolean;
    warnings: string[];
    rgs: RgsSettings;
    game: SelectedGame;
  },
  progress: (text: string) => void
) {
  const show = (step: string) => {
    progress(step);
    ToastLayer.showActivity(step, GAME_ACTIVITY_ID);
  };
  const project: any = ProjectModel.instance;

  // Remember the answer on the project, so the next publish — here or in the
  // popup — opens pre-filled, exactly as the popup does after its form.
  try {
    project?.setMetaData?.(TELEMETRY_METADATA_KEY, args.telemetry);
  } catch (e) {
    console.warn('[Deploy] Could not store the telemetry mapping on the project:', e);
  }

  PublishState.begin();
  let live = false;
  try {
    show('Loading deploy credentials...');
    // A job has no command timeout above it: every network wait here needs its own, or a slow
    // RGS / Vercel leaves the job 'running' for good and blocks the next start.
    const credentials = await withTimeout(loadDeployCredentials(), JOB_NETWORK_TIMEOUT_MS, 'Loading the deploy credentials');
    const credentialError = deployCredentialError({ ...credentials, tokensLoaded: true });
    if (credentialError) throw new Error(credentialError);

    // Before any heavy work, as the popup does.
    show('Checking domain availability...');
    const availability = await withTimeout(
      checkDomainAvailability(new VercelSDKWrapper({ bearerToken: credentials.vercelToken }), args.name),
      JOB_NETWORK_TIMEOUT_MS,
      'The availability check'
    );
    // Our own earlier publish of this name is an update, not a clash (see ownDeployedDomain).
    const republish = !availability.available && availability.reason === 'existing-project' && !!ownDeployedDomain(args.name);
    if (!availability.available && !republish) throw new Error(domainUnavailableMessage(args.name, availability.reason));

    const owner = domainOwner();
    const result = await publishGameToWeb({
      project,
      domainName: args.name,
      telemetry: args.telemetry,
      isPrivate: args.isPrivate,
      rgs: args.rgs,
      game: args.game,
      tokens: { github: credentials.githubToken, vercel: credentials.vercelToken },
      onProgress: show,
      onWarning: (message) => ToastLayer.showError(message),
      onLive: ({ liveUrl, deploymentId, wiring }) => {
        live = true;
        PublishState.succeed(liveUrl);
        ToastLayer.hideActivity(GAME_ACTIVITY_ID);
        ToastLayer.showSuccess(
          `Deployed to Vercel — ${describeWiring(wiring, args.game.name)}.\nLive URL: ${liveUrl.replace(/^https?:\/\//, '')}`
        );
        saveDeployedDomain(owner, args.name, deploymentId, liveUrl);
      }
    });

    ToastLayer.hideActivity(GAME_ACTIVITY_ID);
    const listing = describeRegistration(result.registered, result.name);
    if (result.registered.ok) ToastLayer.showSuccess(listing);
    else ToastLayer.showError(listing);

    return { ...result, republished: republish, warnings: [...args.warnings, ...result.warnings] };
  } catch (e) {
    const message = messageOf(e);
    // Once the site is serving, a later failure is not a failed publish.
    if (!live) PublishState.fail(message);
    ToastLayer.hideActivity(GAME_ACTIVITY_ID);
    ToastLayer.showError(`Deployment failed: ${message}`);
    throw e;
  }
}

/** A Math Components deploy: the panel's Deploy, without deletions. */
async function runMathsJob(commitMessage: string | undefined, progress: (text: string) => void, redeployAll = false) {
  const show = (step: string) => {
    progress(step);
    ToastLayer.showActivity(step, MATHS_ACTIVITY_ID);
  };
  try {
    show('Deploying Math Components...');
    const result = await deployChangedMathsComponents({ commitMessage, onProgress: show, redeployAll });
    ToastLayer.hideActivity(MATHS_ACTIVITY_ID);
    ToastLayer.showSuccess(`Math Components — ${result.message}`);
    if (result.warnings.length > 0) ToastLayer.showError(result.warnings.join('\n'));
    return result;
  } catch (e) {
    ToastLayer.hideActivity(MATHS_ACTIVITY_ID);
    ToastLayer.showError(`Math Components deploy failed: ${messageOf(e)}`);
    throw e;
  }
}

/**
 * Validate, then start a publish job and answer at once with its id.
 *
 * Everything that can be checked without the network is checked here, so a
 * refusal comes back immediately instead of as a failed job: kind, no job
 * already running, an open project, an RGS connection and game and, for a game,
 * the name and the telemetry mapping (a mapping that does not resolve answers
 * with the candidates to pick from). Availability, credentials and everything
 * after run in the job.
 */
export function startPublish(spec: PublishStartSpec | null | undefined): PublishJobStart & Record<string, any> {
  const kind = spec?.kind;
  if (kind !== 'maths' && kind !== 'game') {
    return { error: `Unknown publish kind ${JSON.stringify(kind ?? null)} — use "maths" or "game".` };
  }
  const busy = jobs.running();
  if (busy) return { error: 'A publish is already running', jobId: busy.jobId };
  if (kind === 'game' && PublishState.getSnapshot().phase === 'publishing') {
    return { error: 'A publish is already running (started from the Publish popup).' };
  }

  const project: any = ProjectModel.instance;
  if (!project) return { error: 'No project is open.' };
  const rgs = getRgsSettings();
  const game = getActiveGame();
  const precondition = publishPreconditionError(rgs, game);
  if (precondition) return { error: precondition };

  if (kind === 'maths') {
    return jobs.start('maths', (progress) => runMathsJob(spec.commitMessage, progress, spec.redeployAll === true));
  }

  const { name, error } = normalizeDomainName(spec.name);
  if (error) return { error };
  const resolution = resolveTelemetryMapping(project, spec.telemetry);
  if (!resolution.mapping) {
    return { error: resolution.error, unresolved: resolution.unresolved, candidates: resolution.candidates };
  }

  return jobs.start('game', (progress) =>
    runGameJob(
      {
        name,
        telemetry: resolution.mapping,
        isPrivate: spec.isPrivate !== false,
        warnings: resolution.warnings || [],
        rgs,
        game
      },
      progress
    )
  );
}

/** A job's state, steps and — once finished — result or error. No id: the running or latest job. */
export function publishJob(jobId?: string | null) {
  const job = jobs.get(jobId);
  if (job) return job;
  return {
    error: jobId
      ? `No publish job "${jobId}". Finished jobs are kept for the last 10 only, and none survive an editor reload.`
      : 'No publish job has been started in this editor session.'
  };
}
