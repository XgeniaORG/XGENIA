/**
 * (2026-10-29) A Javascript2 node's code reaches the RGS — it compiled to an empty function, so a maths
 * whose engine was one deployed paying 0 every round (src/api/test-rgs-javascript2.ts).
 * Needs an XRGS checkout beside this repo (or XRGS_SANDBOX); skipped, and says so, without one.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const RUNTIME = path.resolve(__dirname, '..');
const ROOT = path.resolve(RUNTIME, '../..');
const SANDBOX = [
  process.env.XRGS_SANDBOX,
  path.resolve(ROOT, '../XRGS/supabase/functions/_shared/script-sandbox.ts'),
  path.resolve(ROOT, '../../XRGS/supabase/functions/_shared/script-sandbox.ts')
].find((p) => p && fs.existsSync(p));
const TSX = path.join(ROOT, 'node_modules/tsx/dist/cli.mjs');

const run = SANDBOX && fs.existsSync(TSX) ? test : test.skip;

describe('javascript2 nodes reach the RGS', () => {
  if (!SANDBOX) {
    // eslint-disable-next-line no-console
    console.log('rgs-javascript2: skipped — no XRGS checkout found (set XRGS_SANDBOX)');
  }
  run(
    'the node code runs, pays, keeps its state per session and leaves past state alone',
    () => {
      // A file URL: the harness import()s it, and Windows refuses a bare drive path there.
      const r = spawnSync(process.execPath, [TSX, 'src/api/test-rgs-javascript2.ts'], {
        cwd: RUNTIME,
        env: { ...process.env, XRGS_SANDBOX: pathToFileURL(SANDBOX).href },
        encoding: 'utf8',
        timeout: 120000
      });
      const out = `${r.stdout || ''}${r.stderr || ''}`;
      if (r.status !== 0) throw new Error(`test-rgs-javascript2.ts failed (exit ${r.status}):\n${out}`);
      expect(out).toMatch(/javascript2 reaches the RGS/);
    },
    180000
  );
});
