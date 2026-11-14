/**
 * (2026-10-11) A graph's persisted variables named in_feature / awaiting_choice /
 * feature_rounds_remaining reach the TOP level of the state the compiled RGS script returns — where
 * XRGS reads "this is a free round" and "the player must choose" (src/api/test-rgs-feature-state.ts).
 * Needs an XRGS checkout beside this repo (or XRGS_SANDBOX); skipped, and says so, without one.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RUNTIME = path.resolve(__dirname, '..');
const ROOT = path.resolve(RUNTIME, '../..');
const SANDBOX = [
  process.env.XRGS_SANDBOX,
  path.resolve(ROOT, '../XRGS/supabase/functions/_shared/script-sandbox.ts'),
  path.resolve(ROOT, '../../XRGS/supabase/functions/_shared/script-sandbox.ts')
].find((p) => p && fs.existsSync(p));
const TSX = path.join(ROOT, 'node_modules/tsx/dist/cli.mjs');

const run = SANDBOX && fs.existsSync(TSX) ? test : test.skip;

describe('graph feature state reaches the RGS', () => {
  if (!SANDBOX) {
    // eslint-disable-next-line no-console
    console.log('rgs-feature-state: skipped — no XRGS checkout found (set XRGS_SANDBOX)');
  }
  run(
    'in_feature, awaiting_choice and feature_rounds_remaining are lifted and cleared',
    () => {
      const r = spawnSync(process.execPath, [TSX, 'src/api/test-rgs-feature-state.ts'], {
        cwd: RUNTIME,
        env: { ...process.env, XRGS_SANDBOX: SANDBOX },
        encoding: 'utf8',
        timeout: 120000
      });
      const out = `${r.stdout || ''}${r.stderr || ''}`;
      if (r.status !== 0) throw new Error(`test-rgs-feature-state.ts failed (exit ${r.status}):\n${out}`);
      expect(out).toMatch(/graph feature state reaches the RGS/);
    },
    180000
  );
});
