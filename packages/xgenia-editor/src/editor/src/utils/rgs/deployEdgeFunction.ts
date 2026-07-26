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
    payload_example: unknown;
    response_example: unknown;
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
