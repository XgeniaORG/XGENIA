/**
 * (2026-10-05) The maths COMPONENT parity check — the editor runtime vs. the compiled RGS script,
 * request by request (src/api/test-maths-component-parity.ts) — inside the jest suite, so it runs
 * wherever its inputs are present: the XRGS checkout (the script runs in XRGS's real sandbox, the way
 * rgs-fn runs it) and, for the two round-player fixtures, the private repo (users' game maths). The
 * synthetic maths in the script needs only XRGS.
 *
 * Where XRGS is not checked out beside this repo the check is skipped, and says so. Point
 * XRGS_SANDBOX at <XRGS>/supabase/functions/_shared/script-sandbox.ts to run it from anywhere.
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

describe('maths component parity (editor runtime vs. compiled RGS script)', () => {
  if (!SANDBOX) {
    // eslint-disable-next-line no-console
    console.log('maths-component-parity: skipped — no XRGS checkout found (set XRGS_SANDBOX)');
  }
  run(
    'every Component Output, request by request, and no payload field reaches the maths',
    () => {
      const r = spawnSync(process.execPath, [TSX, 'src/api/test-maths-component-parity.ts', '--spins', '120'], {
        cwd: RUNTIME,
        env: { ...process.env, XRGS_SANDBOX: SANDBOX },
        encoding: 'utf8',
        timeout: 240000
      });
      const out = `${r.stdout || ''}${r.stderr || ''}`;
      if (r.status !== 0) throw new Error(`test-maths-component-parity.ts failed (exit ${r.status}):\n${out}`);
      expect(out).toMatch(/maths components play the same game in the editor and on the RGS/);
    },
    300000
  );
});
