// Deploys one compiled logic component to the selected RGS game as an edge
// function, via the maths-deployer `deploy-edge-function` action. Each Publish
// first opens a versioned deployment (createEdgeDeployment) and deploys its
// components into it, so the game keeps full deploy history.

import { XRGS_URL, XRGS_ANON_KEY, rgsHeaders } from './rgsClient';
import { FunctionArtifact } from './generateFunctionArtifact';

export interface DeployedFunction {
  slug: string;
  url: string;
}

/**
 * Creates one versioned "deployed edge functions" entry for the game. Call
 * once per Publish, then deploy each component into it via deployEdgeFunction.
 * Returns the new deployment's id (version auto-increments server-side).
 */
export async function createEdgeDeployment(
  apiKey: string,
  gameId: string,
  name: string
): Promise<{ deploymentId: string; version: number }> {
  const res = await fetch(`${XRGS_URL}/maths-deployer`, {
    method: 'POST',
    headers: rgsHeaders(apiKey),
    body: JSON.stringify({
      action: 'create-edge-deployment',
      game_id: gameId,
      name
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const serverError = (data && data.error) || '';
    // A stale RGS backend rejects this with "Invalid action. Use: …".
    if (res.status === 400 && /invalid action/i.test(serverError) && !serverError.includes('create-edge-deployment')) {
      throw new Error(
        'XGENIA RGS backend is out of date — it does not support edge-function deployments yet. ' +
          'Redeploy the `maths-deployer` function (and apply the game_function_deployments migration) to the RGS project, then try again.'
      );
    }
    throw new Error(serverError || `RGS deployment create failed (HTTP ${res.status})`);
  }
  if (!data || !data.deployment_id) {
    throw new Error('RGS did not return a deployment id');
  }
  return { deploymentId: data.deployment_id, version: data.version };
}

export async function deployEdgeFunction(
  apiKey: string,
  gameId: string,
  deploymentId: string,
  artifact: FunctionArtifact
): Promise<DeployedFunction> {
  const res = await fetch(`${XRGS_URL}/maths-deployer`, {
    method: 'POST',
    headers: rgsHeaders(apiKey),
    body: JSON.stringify({
      action: 'deploy-edge-function',
      game_id: gameId,
      deployment_id: deploymentId,
      function_slug: artifact.slug,
      function_name: artifact.functionName,
      script: artifact.script,
      payload_example: artifact.payloadExample,
      response_example: artifact.responseExample,
      // Omitted entirely when the caller didn't choose a mapping — the RGS
      // handler only writes the columns it receives, so a script-only redeploy
      // keeps the bet/win ports the original publish stored.
      ...(artifact.betInputPort !== undefined ? { bet_input_port: artifact.betInputPort } : {}),
      ...(artifact.winOutputPort !== undefined ? { win_output_port: artifact.winOutputPort } : {}),
      functions_base: XRGS_URL,
      // Public anon key, embedded in the function URL so the deployed frontend
      // (Aggregator node) can call it through the gateway without extra headers.
      functions_anon_key: XRGS_ANON_KEY
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const serverError = (data && data.error) || '';
    // A stale RGS backend — one deployed before the `deploy-edge-function`
    // action existed — rejects this request with "Invalid action. Use: …".
    // Surface an actionable message instead of dumping the raw action list.
    if (res.status === 400 && /invalid action/i.test(serverError) && !serverError.includes('deploy-edge-function')) {
      throw new Error(
        'XGENIA RGS backend is out of date — it does not support edge-function deploys yet. ' +
          'Redeploy the `maths-deployer` function (and apply the game_edge_functions migration) to the RGS project, then try again.'
      );
    }
    throw new Error(serverError || `RGS deploy failed (HTTP ${res.status})`);
  }
  if (!data || !data.url) {
    throw new Error('RGS deploy did not return a function URL');
  }
  return { slug: data.slug || artifact.slug, url: data.url };
}

/**
 * Overwrites one already-deployed component's script in place, keeping it in
 * the same deployment (Server Version) under the same slug.
 *
 * This reuses the ordinary `deploy-edge-function` action rather than adding a
 * new one: that handler upserts on the `game_edge_functions`
 * (deployment_id, function_slug) unique constraint, so re-sending an existing
 * pair replaces that row's script instead of inserting a second copy.
 *
 * The component's `payload_example` / `response_example` are re-sent unchanged
 * — they describe the graph's ports, which hand-editing the script body does
 * not alter, and the handler would otherwise reset them to `{}`.
 *
 * NOTE: the public `rgs-fn` dispatcher serves the NEWEST active row for a
 * (game, slug) across all versions. Overwriting the latest version therefore
 * goes live immediately; overwriting an older version updates the stored script
 * but does not change what players hit. Callers should say which case applies.
 */
export async function redeployEdgeFunctionScript(
  apiKey: string,
  gameId: string,
  deploymentId: string,
  fn: {
    function_slug: string;
    function_name: string;
    payload_example?: Record<string, any>;
    response_example?: Record<string, any>;
  },
  script: string
): Promise<DeployedFunction> {
  return deployEdgeFunction(apiKey, gameId, deploymentId, {
    slug: fn.function_slug,
    functionName: fn.function_name,
    script,
    payloadExample: fn.payload_example ?? {},
    responseExample: fn.response_example ?? {}
  });
}

// ─── Server Versions: download & delete ──────────────────────────
// Per-version actions for the Maths RGS panel's "Server Versions" list,
// mirroring the RGS studio Versions tab. Both go through maths-deployer
// (service role) because XGENIA holds only the anon key + X-Operator-Key and
// cannot write the RLS-protected game_function_deployments tables directly.

export interface EdgeDeploymentBundle {
  slug: string;
  version: number;
  name: string;
  functions: Array<{
    function_slug: string;
    function_name: string;
    function_url: string;
    script: string;
    payload_example: Record<string, any>;
    response_example: Record<string, any>;
    /**
     * The bet/win mapping stored at deploy time. Null on a component deployed
     * before the mapping existed, or one whose ports name neither.
     */
    bet_input_port?: string | null;
    win_output_port?: string | null;
    /**
     * The component's authored node graph, project.json-shaped — what the Math
     * Components deploy uploads after the script. Null for components produced by
     * the whole-project Compile path, which has no authored counterpart to store.
     */
    project_json?: Record<string, any> | null;
  }>;
}

/**
 * Fetches one Server Version's component edge functions (including their
 * scripts) so the caller can build a downloadable JSON bundle — the same
 * bundle the RGS studio Versions tab downloads.
 */
export async function downloadEdgeDeployment(
  apiKey: string,
  deploymentId: string
): Promise<EdgeDeploymentBundle> {
  const res = await fetch(`${XRGS_URL}/maths-deployer`, {
    method: 'POST',
    headers: rgsHeaders(apiKey),
    body: JSON.stringify({ action: 'download-edge-deployment', deployment_id: deploymentId })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const serverError = (data && data.error) || '';
    if (res.status === 400 && /invalid action/i.test(serverError) && !serverError.includes('download-edge-deployment')) {
      throw new Error(
        'XGENIA RGS backend is out of date — it does not support downloading versions yet. ' +
          'Redeploy the `maths-deployer` function to the RGS project, then try again.'
      );
    }
    throw new Error(serverError || `RGS download failed (HTTP ${res.status})`);
  }
  return data as EdgeDeploymentBundle;
}

/**
 * Renames one Server Version (deployment). `name` is the label shown in the
 * Server Versions list and nothing else: the version number stays, its
 * components keep their slugs and function URLs, and rgs-fn never reads this
 * table — so renaming cannot affect a deployed frontend. Scoped to gameId so a
 * mismatched deployment id can't rename another game's version.
 */
export async function renameEdgeDeployment(
  apiKey: string,
  deploymentId: string,
  name: string,
  gameId?: string
): Promise<{ name: string; version: number }> {
  const res = await fetch(`${XRGS_URL}/maths-deployer`, {
    method: 'POST',
    headers: rgsHeaders(apiKey),
    body: JSON.stringify({
      action: 'rename-edge-deployment',
      deployment_id: deploymentId,
      name,
      game_id: gameId
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const serverError = (data && data.error) || '';
    if (res.status === 400 && /invalid action/i.test(serverError) && !serverError.includes('rename-edge-deployment')) {
      throw new Error(
        'XGENIA RGS backend is out of date — it does not support renaming versions yet. ' +
          'Redeploy the `maths-deployer` function to the RGS project, then try again.'
      );
    }
    throw new Error(serverError || `RGS rename failed (HTTP ${res.status})`);
  }
  return { name: data.name, version: data.version };
}

/**
 * Fetches ONE component edge function (including its script) out of a Server
 * Version, for the Components list's per-component Download action.
 *
 * Reuses `download-edge-deployment` rather than adding a per-function action:
 * that handler already returns the version's functions with their scripts, and
 * a version holds a handful of components, so filtering client-side costs
 * nothing and keeps the backend surface smaller.
 */
export async function downloadEdgeFunction(
  apiKey: string,
  deploymentId: string,
  functionSlug: string
): Promise<{ version: number; slug: string; fn: EdgeDeploymentBundle['functions'][number] }> {
  const bundle = await downloadEdgeDeployment(apiKey, deploymentId);
  const fn = (bundle.functions || []).find(f => f.function_slug === functionSlug);
  if (!fn) {
    throw new Error(`Component "${functionSlug}" is not part of v${bundle.version} any more`);
  }
  return { version: bundle.version, slug: bundle.slug, fn };
}

/**
 * Renames one component edge function (display name only — its slug and URL,
 * which the deployed frontend calls, stay the same). Scoped to gameId so a
 * mismatched function id can't rename another game's component.
 */
export async function renameEdgeFunction(
  apiKey: string,
  functionId: string,
  functionName: string,
  gameId?: string
): Promise<{ functionName: string }> {
  const res = await fetch(`${XRGS_URL}/maths-deployer`, {
    method: 'POST',
    headers: rgsHeaders(apiKey),
    body: JSON.stringify({
      action: 'rename-edge-function',
      function_id: functionId,
      function_name: functionName,
      game_id: gameId
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const serverError = (data && data.error) || '';
    if (res.status === 400 && /invalid action/i.test(serverError) && !serverError.includes('rename-edge-function')) {
      throw new Error(
        'XGENIA RGS backend is out of date — it does not support renaming components yet. ' +
          'Redeploy the `maths-deployer` function to the RGS project, then try again.'
      );
    }
    throw new Error(serverError || `RGS rename failed (HTTP ${res.status})`);
  }
  return { functionName: data.function_name };
}

/**
 * Deletes one component edge function, leaving the rest of its Server Version
 * intact. Scoped to gameId so a mismatched function id can't delete another
 * game's component.
 *
 * Callers must warn first when the component is the live copy (see
 * isLiveComponent in MathsPanel): rgs-fn serves the newest ACTIVE row for a
 * (game, slug), so deleting it promotes an older version's copy — or takes the
 * endpoint offline when there is none.
 */
export async function deleteEdgeFunction(
  apiKey: string,
  functionId: string,
  gameId?: string
): Promise<{ functionSlug: string }> {
  const res = await fetch(`${XRGS_URL}/maths-deployer`, {
    method: 'POST',
    headers: rgsHeaders(apiKey),
    body: JSON.stringify({
      action: 'delete-edge-function',
      function_id: functionId,
      game_id: gameId
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const serverError = (data && data.error) || '';
    if (res.status === 400 && /invalid action/i.test(serverError) && !serverError.includes('delete-edge-function')) {
      throw new Error(
        'XGENIA RGS backend is out of date — it does not support deleting single components yet. ' +
          'Redeploy the `maths-deployer` function to the RGS project, then try again.'
      );
    }
    throw new Error(serverError || `RGS delete failed (HTTP ${res.status})`);
  }
  return { functionSlug: data.function_slug };
}

/**
 * Takes one Math Component off the platform entirely — every row it has, in every
 * Server Version of this game.
 *
 * Distinct from `deleteEdgeFunction`, which deletes ONE row by id. That is not
 * enough to stop a component answering: `rgs-fn` serves the newest ACTIVE row for
 * a (game, slug) across all versions, so deleting the selected version's copy just
 * promotes an older one and the endpoint keeps serving older code. This is what
 * "the component is gone" actually requires.
 *
 * Irreversible on the platform, so the caller must record a commit carrying the
 * component's last-known script and project_json FIRST — after this, the commit
 * history is the only place it exists.
 *
 * A component that was already gone is not an error: `deleted: 0` comes back and
 * the caller can report it as already removed rather than failing the deploy.
 */
export async function deleteComponentEverywhere(
  apiKey: string,
  gameId: string,
  functionSlug: string
): Promise<{ deleted: number; functionName: string | null }> {
  const res = await fetch(`${XRGS_URL}/maths-deployer`, {
    method: 'POST',
    headers: rgsHeaders(apiKey),
    body: JSON.stringify({
      action: 'delete-component',
      game_id: gameId,
      function_slug: functionSlug
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const serverError = (data && data.error) || '';
    if (res.status === 400 && /invalid action/i.test(serverError) && !serverError.includes('delete-component')) {
      throw new Error(
        'XGENIA RGS backend is out of date — it cannot remove a component from every version yet. ' +
          'Redeploy the `maths-deployer` function to the RGS project, then try again.'
      );
    }
    throw new Error(serverError || `RGS component delete failed (HTTP ${res.status})`);
  }
  return { deleted: data.deleted ?? 0, functionName: data.function_name ?? null };
}

/**
 * Deletes one Server Version (deployment). Its component edge functions are
 * removed by the DB's ON DELETE CASCADE. Optionally scoped to gameId so a
 * mismatched deployment id can't delete another game's version.
 */
export async function deleteEdgeDeployment(
  apiKey: string,
  deploymentId: string,
  gameId?: string
): Promise<{ version: number }> {
  const res = await fetch(`${XRGS_URL}/maths-deployer`, {
    method: 'POST',
    headers: rgsHeaders(apiKey),
    body: JSON.stringify({ action: 'delete-edge-deployment', deployment_id: deploymentId, game_id: gameId })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const serverError = (data && data.error) || '';
    if (res.status === 400 && /invalid action/i.test(serverError) && !serverError.includes('delete-edge-deployment')) {
      throw new Error(
        'XGENIA RGS backend is out of date — it does not support deleting versions yet. ' +
          'Redeploy the `maths-deployer` function to the RGS project, then try again.'
      );
    }
    throw new Error(serverError || `RGS delete failed (HTTP ${res.status})`);
  }
  return { version: data.version };
}
