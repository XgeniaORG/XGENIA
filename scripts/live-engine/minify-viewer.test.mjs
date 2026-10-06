// Live engine (2026-10-04): the optional viewer minify keeps what the engine reads at runtime.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { minifyFile } from './minify-viewer.mjs';

test('comments go, function and class names and strings stay, and the file shrinks', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xgenia-min-')), 'xgenia.viewer.js');
  const src = `// a readable comment about pro-node internals
function PixiReelController(longParameterName) { /* block comment */ return longParameterName + 1; }
class CascadeTheReels { describe() { return 'Cascade The Reels'; } }
module.exports = { PixiReelController, CascadeTheReels, version: '20261004.1200-aaaaaaaa-bbbbbbbb' };
`;
  fs.writeFileSync(file, src);
  const r = await minifyFile(file);
  const out = fs.readFileSync(file, 'utf8');
  assert.ok(r.after < r.before);
  assert.doesNotMatch(out, /readable comment|block comment/);
  assert.match(out, /function PixiReelController/);
  assert.match(out, /class CascadeTheReels/);
  assert.match(out, /Cascade The Reels/);
  assert.match(out, /20261004\\.1200-aaaaaaaa-bbbbbbbb|20261004.1200-aaaaaaaa-bbbbbbbb/);
});
