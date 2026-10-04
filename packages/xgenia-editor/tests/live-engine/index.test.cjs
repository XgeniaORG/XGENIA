// Live engine (2026-10-03): main-process wiring — decided from disk at once, health-checked, and a
// download during a session changes nothing until the next start.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const EventEmitter = require('events');
const { setupLiveEngine, channelFor } = require('../../src/main/src/live-engine');
const { EngineStore } = require('../../src/main/src/live-engine/engine-store');
const { signManifest } = require('../../src/main/src/live-engine/manifest');
const { keys, packFiles, makeManifest, fakeCdn } = require('./helpers.cjs');

const k = keys();
const quiet = { log() {}, warn() {} };
const never = () => new Promise(() => {});
function fakeApp({ isPackaged = true } = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'xgenia-ud-'));
  const app = new EventEmitter();
  Object.assign(app, { isPackaged, getPath: () => userData, getAppPath: () => '/app.asar' });
  return app;
}
async function withPending(app, version) {
  const store = new EngineStore(path.join(app.getPath('userData'), 'engine'));
  const files = packFiles();
  const m = makeManifest(files, { version });
  const raw = Buffer.from(JSON.stringify(m));
  await store.install(raw, signManifest(raw, k.privateKey), m, async (f) => Buffer.from(files[f.path]));
  store.writeState({ ...store.readState(), pending: version });
  return store;
}
const setup = (app, extra = {}) =>
  setupLiveEngine({ app, ipcMain: new EventEmitter(), env: {}, log: quiet, publicKeyPem: k.publicKey, fetch: never, timings: { checkAfterMs: 1e9 }, ...extra });

test('setup decides from disk and returns at once, even when the network never answers', async () => {
  const app = fakeApp();
  await withPending(app, 'v1');
  const env = {};
  const r = setup(app, { env, timings: { checkAfterMs: 0 } });
  assert.equal(r.info.source, 'live');
  assert.equal(env.XGENIA_ENGINE_ROOT, r.store.versionDir('v1'));
  assert.equal(env.XGENIA_ENGINE_VERSION, 'v1');
  assert.equal(global.xgeniaLiveEngine.version, 'v1');
  r.stop();
});

test('the preview reporting in on this engine ends its trial; a report from another build does not', async () => {
  const app = fakeApp();
  await withPending(app, 'v1');
  const ipcMain = new EventEmitter();
  const r = setup(app, { ipcMain });
  app.emit('xgenia:viewer-bundle-served');
  ipcMain.emit('live-engine:viewer-ok', {}, 'local');
  assert.equal(r.store.readState().trial, 'v1');
  ipcMain.emit('live-engine:viewer-ok', {}, 'v1');
  assert.equal(r.store.readState().trial, null);
  r.stop();
});

test('a preview that never reports in marks the engine bad', async () => {
  const app = fakeApp();
  await withPending(app, 'v1');
  const r = setup(app, { timings: { checkAfterMs: 1e9, healthTimeoutMs: 20 } });
  app.emit('xgenia:viewer-bundle-served');
  await new Promise((res) => setTimeout(res, 80));
  assert.deepEqual(r.store.readState().bad, ['v1']);
  r.stop();
});

test('quitting records a clean exit', async () => {
  const app = fakeApp();
  await withPending(app, 'v1');
  const r = setup(app);
  assert.equal(r.store.readState().cleanExit, false);
  app.emit('will-quit');
  assert.equal(r.store.readState().cleanExit, true);
  r.stop();
});

test('an update installed mid-session changes nothing until restart', async () => {
  const app = fakeApp();
  await withPending(app, 'v1');
  const env = {};
  const cdn = fakeCdn({ version: 'v2', channel: 'stable', signKey: k.privateKey, cdn: 'https://pcrghrjikkcmelflwiys.supabase.co/storage/v1/object/public/engine' });
  const r = setup(app, { env, fetch: cdn.fetchBytes, timings: { checkAfterMs: 0 } });
  for (let i = 0; i < 50 && r.store.readState().pending !== 'v2'; i++) await new Promise((res) => setTimeout(res, 20));
  assert.equal(r.store.readState().pending, 'v2');
  assert.equal(env.XGENIA_ENGINE_VERSION, 'v1');
  assert.equal(global.xgeniaLiveEngine.version, 'v1');
  r.stop();
});

test('a development build never schedules a download', async () => {
  const app = fakeApp({ isPackaged: false });
  let calls = 0;
  const r = setup(app, { fetch: async () => { calls++; throw new Error('x'); }, timings: { checkAfterMs: 0 } });
  await new Promise((res) => setTimeout(res, 30));
  assert.equal(r.info.source, 'builtin');
  assert.equal(calls, 0);
  r.stop();
});

test('channel: env, then settings.json, then stable', () => {
  const store = new EngineStore(fs.mkdtempSync(path.join(os.tmpdir(), 'xgenia-ch-')));
  assert.equal(channelFor({}, store), 'stable');
  fs.writeFileSync(path.join(store.baseDir, 'settings.json'), JSON.stringify({ channel: 'beta' }));
  assert.equal(channelFor({}, store), 'beta');
  assert.equal(channelFor({ XGENIA_ENGINE_CHANNEL: 'stable' }, store), 'stable');
  assert.equal(channelFor({ XGENIA_ENGINE_CHANNEL: 'nonsense' }, store), 'beta');
});
