// Live engine (2026-10-03): export files and the RGS compiler come from the engine this run chose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { pickEngineInfo, externalPathFor, chooseCompiler, engineFileProblem, type LiveEngineInfo } from '../../src/editor/src/utils/liveEngine';

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
  const copy = pickEngineInfo(live, '/app.asar');
  assert.deepEqual(copy, live);
  assert.notEqual(copy, live); // a plain copy: the main-process object is a remote proxy, every read a sync IPC
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

// ── 2026-10-04: deferred review minors ──
const stat = (size: number, mtimeMs: number) => () => ({ size, mtimeMs });
const withFiles: LiveEngineInfo = {
  ...live,
  files: { 'compiler/xgenia.rgs-compiler.js': { size: 10, mtimeMs: 1000 }, 'deploy/xgenia.deploy.js': { size: 20, mtimeMs: 2000 } }
};

test('without @electron/remote the renderer still learns the engine from the environment', () => {
  const i = pickEngineInfo(null, '/app.asar', { XGENIA_ENGINE_ROOT: '/ud/engine/versions/v1', XGENIA_ENGINE_VERSION: 'v1' });
  assert.equal(i.source, 'live');
  assert.equal(i.root, '/ud/engine/versions/v1');
  assert.equal(i.builtinRoot, path.join('/app.asar', 'src/external'));
});

test("the app's own compiler is labelled 'bundled', as its scripts are", () => {
  assert.equal(chooseCompiler({ ...live, source: 'builtin' }, () => null, () => builtinMod).version, 'bundled');
});

test('falling back from the live compiler says why', () => {
  const r = chooseCompiler(live, () => { throw new Error('SyntaxError: x'); }, () => builtinMod);
  assert.equal(r.source, 'builtin');
  assert.match(r.fallbackReason || '', /SyntaxError: x/);
});

test('a live compiler file changed since start is not loaded', () => {
  let loaded = false;
  const r = chooseCompiler(withFiles, () => { loaded = true; return { CloudFunctionConverter: function Live() {} }; }, () => builtinMod, () => {}, stat(11, 1000));
  assert.equal(loaded, false);
  assert.equal(r.source, 'builtin');
  assert.match(r.fallbackReason || '', /changed on disk/);
});

test('engine files must be listed and unchanged; other folders and the built-in engine are not checked', () => {
  assert.equal(engineFileProblem(withFiles, 'deploy/xgenia.deploy.js', stat(20, 2000)), null);
  assert.match(engineFileProblem(withFiles, 'deploy/xgenia.deploy.js', stat(20, 2001)) || '', /changed on disk/);
  assert.match(engineFileProblem(withFiles, 'deploy/planted.js', stat(1, 1)) || '', /not part of engine v1/);
  assert.equal(engineFileProblem(withFiles, 'cloudruntime/manifest.json', stat(1, 1)), null);
  assert.equal(engineFileProblem({ ...withFiles, source: 'builtin' }, 'deploy/planted.js', stat(1, 1)), null);
  assert.equal(engineFileProblem(live, 'deploy/xgenia.deploy.js', stat(1, 1)), null); // no snapshot (environment fallback)
});
