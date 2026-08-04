/**
 * The RGS maths lifecycle, split at the `testing` boundary.
 *
 * Extracted from MathsPanel.handleUploadTestDeploy, which ran all five steps
 * straight through to `deploy` — so the one human button pushed maths LIVE with
 * no stop, while the AI path (rgs_auto_test) already defaulted to
 * auto_deploy:false and stopped after the stress test. The human path was the
 * dangerous one. This brings the two into line and makes the boundary a thing a
 * test can hold.
 *
 * Imports nothing, on purpose: no editor models, no React, no fetch. The caller
 * injects `callAction`, which is what lets the Vitest suite in
 * private/xgenia-ai-app import this by relative path and drive it with a fake
 * server. Keep it that way — an import from '@xgenia-models/*' here would make
 * the boundary untestable again.
 */

export type RgsAction = (payload: Record<string, any>) => Promise<any>;

export interface MathsTestParams {
  callAction: RgsAction;
  gameId: string;
  script: string;
  configData: any;
  declaredRtp: string;
  numSpins: number;
  onStep?: (label: string) => void;
}

export interface MathsTestResult {
  ok: boolean;
  error?: string;
  mathsConfigId?: string;
  version?: number;
  stress?: any;
}

/**
 * An RGS action reports failure as a truthy `error` on an HTTP 200 body, so a
 * thrown exception is not the failure signal — an unchecked `error` field is.
 */
function failure(step: string, data: any): string | null {
  if (data && data.error) return `${step} failed: ${data.error}`;
  return null;
}

/**
 * upload → activate → stress-test, then STOP.
 *
 * Deliberately does not call `approve` or `deploy`. Promotion is
 * promoteMathsToLive, reached only by a separate user action.
 */
export async function runMathsTest(p: MathsTestParams): Promise<MathsTestResult> {
  const { callAction, onStep } = p;

  onStep?.('Uploading maths…');
  const uploaded = await callAction({
    action: 'upload',
    game_id: p.gameId,
    maths_mode: 'script',
    script: p.script,
    config_data: p.configData,
    declared_rtp: p.declaredRtp
  });
  const uploadErr = failure('Upload', uploaded);
  if (uploadErr) return { ok: false, error: uploadErr };

  const mathsConfigId = uploaded && uploaded.maths_config_id;
  const version = uploaded && uploaded.version;
  // A 200 with no id is not success. Continuing would send `undefined` as the
  // maths_config_id for the rest of the run and report whatever came back.
  if (!mathsConfigId) {
    return { ok: false, error: 'Upload returned no maths_config_id — nothing to test.' };
  }

  onStep?.('Activating for testing…');
  const activated = await callAction({ action: 'activate', maths_config_id: mathsConfigId });
  const activateErr = failure('Activate', activated);
  if (activateErr) return { ok: false, error: activateErr, mathsConfigId, version };

  onStep?.(`Running stress test (${Math.round(p.numSpins / 1000)}k spins)…`);
  const stress = await callAction({
    action: 'stress-test',
    maths_config_id: mathsConfigId,
    num_spins: p.numSpins
  });
  const stressErr = failure('Stress test', stress);
  if (stressErr) return { ok: false, error: stressErr, mathsConfigId, version };

  return { ok: true, mathsConfigId, version, stress };
}

/**
 * approve → deploy. Only meaningful for a config that has passed a stress test;
 * the server rejects `approve` on an untested config, so this is the UI half of
 * that rule rather than the rule itself.
 */
export async function promoteMathsToLive(
  callAction: RgsAction,
  mathsConfigId: string,
  onStep?: (label: string) => void
): Promise<{ ok: boolean; error?: string }> {
  onStep?.('Approving…');
  const approved = await callAction({ action: 'approve', maths_config_id: mathsConfigId });
  const approveErr = failure('Approve', approved);
  if (approveErr) return { ok: false, error: approveErr };

  onStep?.('Deploying to live…');
  const deployed = await callAction({ action: 'deploy', maths_config_id: mathsConfigId });
  const deployErr = failure('Deploy', deployed);
  if (deployErr) return { ok: false, error: deployErr };

  return { ok: true };
}
