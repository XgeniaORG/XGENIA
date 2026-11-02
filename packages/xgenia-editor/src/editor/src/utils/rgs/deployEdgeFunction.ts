// Deploys one compiled logic component to the selected RGS game as an edge
// function, via the maths-deployer `deploy-edge-function` action. Each Publish
// first opens a versioned deployment (createEdgeDeployment) and deploys its
// components into it, so the game keeps full deploy history.

import { XRGS_URL, XRGS_ANON_KEY, rgsHeaders } from './rgsClient';
import { FunctionArtifact } from './generateFunctionArtifact';

/** A rewrite the platform applied to the script as it was stored. */
export interface DeployRewrite {
  from: string;
  to: string;
  count: number;
  reason: string;
}

/** Whether the platform could see the outcome move with the server's RNG. */
export interface DeployRngVerdict {
  verdict: 'responsive' | 'not_responsive' | 'inconclusive';
  reason: string;
}

export interface DeployedFunction {
  slug: string;
  url: string;
  /** Both absent when the RGS backend predates them. */
  rewrites?: DeployRewrite[];
  rng?: DeployRngVerdict;
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
          'Try again later; if it keeps happening, contact XGENIA support.'
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
      // Said to a game studio, not to the platform's engineers: redeploying a
      // server function is not something a studio can do or should be told to.
      throw new Error(
        'XGENIA RGS cannot take this deploy yet (the server is older than this editor). ' +
          'Try again later; if it keeps happening, contact XGENIA support.'
      );
    }
    throw new Error(serverError || `RGS deploy failed (HTTP ${res.status})`);
  }
  if (!data || !data.url) {
    throw new Error('RGS deploy did not return a function URL');
  }

  // What the platform did to the script on the way in, and what it can see
  // about where the outcome comes from. Both keys are new; an RGS deployed
  // before they existed simply omits them and nothing here changes.
  if (Array.isArray(data.rewrites) && data.rewrites.length > 0) {
    for (const rw of data.rewrites) {
      console.warn(
        `[RGS] ${artifact.slug}: rewrote ${rw.from} -> ${rw.to} (x${rw.count}) on upload — ${rw.reason}`
      );
    }
  }
  if (data.rng && data.rng.verdict === 'not_responsive') {
    // Not thrown. Plenty of components legitimately have no randomness —
    // calculators, paytable readers, replay pop-ups all deploy through here.
    // The refusal belongs where the stake is known, which is the round path on
    // real money; here it is a heads-up while the author is still looking.
    console.warn(`[RGS] ${artifact.slug}: ${data.rng.reason}`);
  }

  return {
    slug: data.slug || artifact.slug,
    url: data.url,
    rewrites: data.rewrites,
    rng: data.rng,
  };
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

// ─── Server Versions: list, read & delete ────────────────────────
// Publish deploys into a game's newest Server Version, the Maths panel's
// Deployed tab reads it, and deleting a published domain deletes the version
// it recorded. All go through maths-deployer (service role) because XGENIA
// holds only the anon key + X-Operator-Key and cannot write the RLS-protected
// game_function_deployments tables directly.

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
 * Every Server Version of a game, NEWEST FIRST (maths-deployer orders by version
 * descending), each with its component functions' API docs but not their scripts.
 */
export async function listEdgeDeployments(apiKey: string, gameId: string): Promise<any[]> {
  const res = await fetch(`${XRGS_URL}/maths-deployer`, {
    method: 'POST',
    headers: rgsHeaders(apiKey),
    body: JSON.stringify({ action: 'list-edge-deployments', game_id: gameId })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data && data.error) || `Could not read deployed components (HTTP ${res.status})`);
  }
  return data.deployments || [];
}

/**
 * Fetches one Server Version's component edge functions, including their
 * scripts and stored graphs — what readDeployedComponents compares against.
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
          'Try again later; if it keeps happening, contact XGENIA support.'
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
          'Try again later; if it keeps happening, contact XGENIA support.'
      );
    }
    throw new Error(serverError || `RGS delete failed (HTTP ${res.status})`);
  }
  return { version: data.version };
}
