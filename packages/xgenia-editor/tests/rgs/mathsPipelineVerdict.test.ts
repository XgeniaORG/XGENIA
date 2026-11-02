import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runMathsTest, stressVerdictProblem } from '../../src/editor/src/utils/rgs/mathsPipeline';

test('a stress test is a pass only when its verdict says so', () => {
  assert.equal(stressVerdictProblem({ verdict: 'PASSED' }), null);
  assert.equal(stressVerdictProblem({}), null); // older server: no verdict to read
  assert.match(String(stressVerdictProblem({ verdict: 'INCONCLUSIVE' })), /inconclusive/);
  assert.match(
    String(stressVerdictProblem({ verdict: 'FAILED', tests: { rtp: { passed: false }, max_win: { passed: true }, chi: { passed: false, skipped: true } } })),
    /^Stress test failed \(rtp\)/
  );
});

test('runMathsTest no longer reports a FAILED gauntlet as tested', async () => {
  const answers: Record<string, any> = {
    upload: { maths_config_id: 'mc1', version: 7 },
    activate: { ok: true },
    'stress-test': { verdict: 'FAILED', tests: { rtp: { passed: false } } }
  };
  const r = await runMathsTest({
    callAction: async (body: any) => answers[body.action],
    gameId: 'g',
    script: 'x',
    numSpins: 10000
  } as any);
  assert.equal(r.ok, false);
  assert.match(String(r.error), /Stress test failed \(rtp\)/);
});
