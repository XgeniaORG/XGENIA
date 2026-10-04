// Live engine (2026-10-03): export files and the RGS compiler come from the engine this run chose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { pickEngineInfo, externalPathFor, chooseCompiler, type LiveEngineInfo } from '../../src/editor/src/utils/liveEngine';

const live: LiveEngineInfo = { root: '/ud/engine/versions/v1', builtinRoot: '/app.asar/src/external', version: 'v1', source: 'live' };
const builtinMod = { CloudFunctionConverter: function Builtin() {} };

test("engine folders come from the live engine; the cloud runtime stays the app's own", () => {
  assert.equal(externalPathFor(live, 'deploy/index.json'), path.join('/ud/engine/versions/v1', 'deploy/index.json'));
  assert.equal(externalPathFor(live, path.join('viewer', 'global.d.ts.keep')), path.join('/ud/engine/versions/v1', 'viewer', 'global.d.ts.keep'));
  assert.equal(externalPathFor(live, 'cloudruntime/manifest.json'), path.join('/app.asar/src/external', 'cloudruntime/manifest.json'));
});

test("no usable report from the main process means the app's own engine", () => {
  for (const bad of [null, undefined, {}, { root: '/x', source: 'live' }]) {
    const i = pickEngineInfo(bad, '/app.asar');
    assert.equal(i.source, 'builtin');
    assert.equal(i.root, path.join('/app.asar', 'src/external'));
  }
  assert.equal(pickEngineInfo(live, '/app.asar'), live);
});

test("the live compiler is used when it loads; otherwise the app's", () => {
  const liveMod = { CloudFunctionConverter: function Live() {} };
  const loaded: string[] = [];
  const r = chooseCompiler(live, (f) => { loaded.push(f); return liveMod; }, () => builtinMod);
  assert.equal(r.source, 'live');
  assert.equal(r.mod, liveMod);
  assert.deepEqual(loaded, [path.join('/ud/engine/versions/v1', 'compiler', 'xgenia.rgs-compiler.js')]);
  assert.equal(chooseCompiler(live, () => { throw new Error('SyntaxError'); }, () => builtinMod).source, 'builtin');
  assert.equal(chooseCompiler(live, () => ({}), () => builtinMod).source, 'builtin');
  assert.equal(chooseCompiler({ ...live, source: 'builtin' }, () => liveMod, () => builtinMod).source, 'builtin');
});
