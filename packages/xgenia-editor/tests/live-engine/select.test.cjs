// Live engine (2026-10-03): which engine a start runs, decided from disk, with a way back.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EngineStore } = require('../../src/main/src/live-engine/engine-store');
const { selectEngine, markHealthy, markBad, markCleanExit, markTrialTimedOut } = require('../../src/main/src/live-engine/select');
const { signManifest } = require('../../src/main/src/live-engine/manifest');
const { keys, packFiles, makeManifest } = require('./helpers.cjs');

const k = keys();
const APP = '/Applications/XGENIA.app/Contents/Resources/app.asar';
const newStore = () => new EngineStore(fs.mkdtempSync(path.join(os.tmpdir(), 'xgenia-select-')));
async function installed(store, version, over = {}) {
  const files = packFiles();
  const m = makeManifest(files, { version, ...over });
  const raw = Buffer.from(JSON.stringify(m));
  await store.install(raw, signManifest(raw, k.privateKey), m, async (f) => Buffer.from(files[f.path]));
  return m;
}
const pick = (store, extra = {}) =>
  selectEngine({ appPath: APP, isPackaged: true, env: {}, store, publicKeyPem: k.publicKey, shellApi: 1, ...extra });

test('nothing installed: the built-in engine, updates allowed', () => {
  const r = pick(newStore());
  assert.equal(r.source, 'builtin');
  assert.equal(r.root, path.join(APP, 'src/external'));
  assert.equal(r.allowUpdates, true);
});

test('development builds and XGENIA_ENGINE=builtin neither use nor fetch a live engine', async () => {
  const store = newStore();
  await installed(store, 'v1');
  store.writeState({ ...store.readState(), active: 'v1' });
  const dev = pick(store, { isPackaged: false });
  assert.equal(dev.source, 'builtin');
  assert.equal(dev.allowUpdates, false);
  assert.equal(pick(store, { env: { XGENIA_ENGINE: 'builtin' } }).allowUpdates, false);
  assert.equal(pick(store, { isPackaged: false, env: { XGENIA_LIVE_ENGINE: '1' } }).source, 'live');
});

test('a downloaded engine becomes active at the next start, on trial', async () => {
  const store = newStore();
  await installed(store, 'v1');
  store.writeState({ ...store.readState(), pending: 'v1' });
  const r = pick(store);
  assert.equal(r.source, 'live');
  assert.equal(r.version, 'v1');
  assert.equal(r.root, store.versionDir('v1'));
  assert.equal(r.builtinRoot, path.join(APP, 'src/external'));
  const s = store.readState();
  assert.equal(s.active, 'v1');
  assert.equal(s.trial, 'v1');
  assert.equal(s.pending, null);
});

test('a trial engine whose run neither reported healthy nor quit cleanly is dropped for the previous one', async () => {
  const store = newStore();
  await installed(store, 'v1');
  await installed(store, 'v2');
  store.writeState({ ...store.readState(), active: 'v1', pending: 'v2' });
  assert.equal(pick(store).version, 'v2'); // start 1: v2 on trial, then the app dies
  const r = pick(store); // start 2
  assert.equal(r.version, 'v1');
  assert.deepEqual(store.readState().bad, ['v2']);
});

test('a trial engine that reported healthy stays, and older versions are pruned', async () => {
  const store = newStore();
  for (const v of ['v0', 'v1', 'v2']) await installed(store, v);
  store.writeState({ ...store.readState(), active: 'v1', previous: 'v0', pending: 'v2' });
  pick(store);
  markHealthy(store, 'v2');
  markCleanExit(store);
  assert.equal(pick(store).version, 'v2');
  assert.deepEqual(fs.readdirSync(path.join(store.baseDir, 'versions')).sort(), ['v1', 'v2']);
});

test('a clean quit before the preview ever opened keeps the trial engine', async () => {
  const store = newStore();
  await installed(store, 'v1');
  store.writeState({ ...store.readState(), pending: 'v1' });
  pick(store);
  markCleanExit(store);
  assert.equal(pick(store).version, 'v1');
  assert.equal(store.readState().trial, 'v1');
});

test('markBad on the running engine sends the next start back', async () => {
  const store = newStore();
  await installed(store, 'v1');
  await installed(store, 'v2');
  store.writeState({ ...store.readState(), active: 'v1', pending: 'v2' });
  pick(store);
  markBad(store, 'v2');
  markCleanExit(store);
  assert.equal(pick(store).version, 'v1');
});

test('an engine needing a newer app, a tampered file, or a foreign signature is never picked', async () => {
  const s1 = newStore();
  await installed(s1, 'v1', { minShell: 2 });
  s1.writeState({ ...s1.readState(), active: 'v1' });
  assert.equal(pick(s1).source, 'builtin');

  const s2 = newStore();
  await installed(s2, 'v1');
  s2.writeState({ ...s2.readState(), active: 'v1' });
  fs.writeFileSync(path.join(s2.versionDir('v1'), 'compiler/xgenia.rgs-compiler.js'), 'module.exports = {}');
  assert.equal(pick(s2).source, 'builtin');

  const s3 = newStore();
  await installed(s3, 'v1');
  s3.writeState({ ...s3.readState(), active: 'v1' });
  assert.equal(pick(s3, { publicKeyPem: keys().publicKey }).source, 'builtin');
});

// ── final-review fixes (2026-10-04) ──
test('falling back from a failed trial lands on the last proven engine, not an unproven one', async () => {
  const store = newStore();
  for (const v of ['A1', 'B2', 'C3']) await installed(store, v);
  store.writeState({ ...store.readState(), active: 'A1' }); // A1 proven
  store.writeState({ ...store.readState(), pending: 'B2' });
  pick(store); // B2 on trial
  markCleanExit(store); // quit before any preview: B2 unproven
  store.writeState({ ...store.readState(), pending: 'C3' });
  pick(store); // C3 on trial, then the app dies
  assert.equal(pick(store).version, 'A1');
});

test('the run that activates an engine is its trial; later runs are not', async () => {
  const store = newStore();
  await installed(store, 'v1');
  store.writeState({ ...store.readState(), pending: 'v1' });
  assert.equal(pick(store).trial, true);
  markHealthy(store, 'v1');
  markCleanExit(store);
  assert.equal(pick(store).trial, false);
});

test('a trial that timed out is dropped at the next start even after a clean quit', async () => {
  const store = newStore();
  await installed(store, 'v1');
  await installed(store, 'v2');
  store.writeState({ ...store.readState(), active: 'v1', pending: 'v2' });
  pick(store);
  markTrialTimedOut(store, 'v2');
  markCleanExit(store);
  assert.equal(pick(store).version, 'v1');
  assert.deepEqual(store.readState().bad, ['v2']);
});

test('an engine built for an older app shell is not used by a newer app', async () => {
  const s = newStore();
  await installed(s, 'v1', { minShell: 1 });
  s.writeState({ ...s.readState(), active: 'v1' });
  assert.equal(pick(s, { shellApi: 2 }).source, 'builtin');
});
