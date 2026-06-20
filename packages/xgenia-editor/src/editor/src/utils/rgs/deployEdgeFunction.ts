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
    throw new Error((data && data.error) || `RGS deploy failed (HTTP ${res.status})`);
  }
  if (!data || !data.url) {
    throw new Error('RGS deploy did not return a function URL');
  }
  return { slug: data.slug || artifact.slug, url: data.url };
}
