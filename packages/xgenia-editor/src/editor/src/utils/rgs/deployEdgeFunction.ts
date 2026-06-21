// Deploys one compiled logic component to the selected RGS game as an edge
// function, via the maths-deployer `deploy-edge-function` action.

import { XRGS_URL, XRGS_ANON_KEY, rgsHeaders } from './rgsClient';
import { FunctionArtifact } from './generateFunctionArtifact';

export interface DeployedFunction {
  slug: string;
  url: string;
}

export async function deployEdgeFunction(
  apiKey: string,
  gameId: string,
  artifact: FunctionArtifact
): Promise<DeployedFunction> {
  const res = await fetch(`${XRGS_URL}/maths-deployer`, {
    method: 'POST',
    headers: rgsHeaders(apiKey),
    body: JSON.stringify({
      action: 'deploy-edge-function',
      game_id: gameId,
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
