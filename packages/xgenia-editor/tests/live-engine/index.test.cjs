// Live engine (2026-10-03): main-process wiring — decided from disk at once, health-checked, and a
// download during a session changes nothing until the next start.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const EventEmitter = require('events');
const { setupLiveEngine, channelFor, fetchBytes, pickFetch } = require('../../src/main/src/live-engine');
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
  app.emit('xgenia:preview-requested');
  ipcMain.emit('live-engine:viewer-ok', {}, 'local');
  assert.equal(r.store.readState().trial, 'v1');
  ipcMain.emit('live-engine:viewer-ok', {}, 'v1');
  assert.equal(r.store.readState().trial, null);
  r.stop();
});

test('a trial engine whose preview never reports in is dropped at the next start, even after a clean quit', async () => {
  const app = fakeApp();
  await withPending(app, 'v1');
  const r = setup(app, { timings: { checkAfterMs: 1e9, healthTimeoutMs: 20 } });
  app.emit('xgenia:preview-requested');
  await new Promise((res) => setTimeout(res, 80));
  assert.equal(r.store.readState().trialTimedOut, 'v1');
  app.emit('will-quit');
  r.stop();
  const next = setup(app);
  assert.equal(next.info.source, 'builtin');
  assert.deepEqual(next.store.readState().bad, ['v1']);
  next.stop();
});

test('a late report after the timeout still keeps the engine', async () => {
  const app = fakeApp();
  await withPending(app, 'v1');
  const ipcMain = new EventEmitter();
  const r = setup(app, { ipcMain, timings: { checkAfterMs: 1e9, healthTimeoutMs: 20 } });
  app.emit('xgenia:preview-requested');
  await new Promise((res) => setTimeout(res, 80));
  ipcMain.emit('live-engine:viewer-ok', {}, 'v1');
  r.stop();
  const next = setup(app);
  assert.equal(next.info.version, 'v1');
  assert.deepEqual(next.store.readState().bad, []);
  next.stop();
});

test('a proven engine is never put on trial again', async () => {
  const app = fakeApp();
  await withPending(app, 'v1');
  const ipcMain = new EventEmitter();
  const r = setup(app, { ipcMain });
  app.emit('xgenia:preview-requested');
  ipcMain.emit('live-engine:viewer-ok', {}, 'v1');
  app.emit('will-quit');
  r.stop();
  const next = setup(app, { timings: { checkAfterMs: 1e9, healthTimeoutMs: 20 } });
  app.emit('xgenia:preview-requested');
  await new Promise((res) => setTimeout(res, 80));
  assert.deepEqual(next.store.readState().bad, []);
  assert.equal(next.store.readState().trialTimedOut, null);
  next.stop();
});

test('state.json records what this start chose and the last update check', async () => {
  const app = fakeApp();
  await withPending(app, 'v1');
  const cdn = fakeCdn({ version: 'v2', channel: 'stable', signKey: k.privateKey, cdn: 'https://pcrghrjikkcmelflwiys.supabase.co/storage/v1/object/public/engine' });
  const r = setup(app, { fetch: cdn.fetchBytes, timings: { checkAfterMs: 0 } });
  assert.equal(r.store.readState().lastStart.version, 'v1');
  for (let i = 0; i < 50 && !r.store.readState().lastCheck; i++) await new Promise((res) => setTimeout(res, 20));
  assert.equal(r.store.readState().lastCheck.status, 'installed');
  r.stop();
});

test('downloads stop at their byte cap, with or without a content-length', async () => {
  const http = require('http');
  const server = http.createServer((req, res) => {
    if (req.url === '/sized') { res.setHeader('content-length', 5000); res.end(Buffer.alloc(5000)); return; }
    res.write(Buffer.alloc(3000)); res.write(Buffer.alloc(3000)); res.end();
  });
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await assert.rejects(async () => fetchBytes(base + '/sized', 1000), /exceeds 1000 bytes/);
    await assert.rejects(async () => fetchBytes(base + '/chunked', 1000), /exceeds 1000 bytes/);
    assert.equal((await fetchBytes(base + '/sized', 10000)).length, 5000);
  } finally {
    server.close();
    server.closeAllConnections();
  }
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

// ── 2026-10-04: deferred review minors ──
test('a failed check is retried soon, not 6 hours later', async () => {
  const app = fakeApp();
  await withPending(app, 'v1');
  const cdn = fakeCdn({ version: 'v2', channel: 'stable', signKey: k.privateKey, cdn: 'https://pcrghrjikkcmelflwiys.supabase.co/storage/v1/object/public/engine' });
  let calls = 0;
  const flaky = async (url, max) => { if (calls++ === 0) throw new Error('signature fetched mid-publish'); return cdn.fetchBytes(url, max); };
  const r = setup(app, { fetch: flaky, timings: { checkAfterMs: 0, retryAfterMs: 30 } });
  for (let i = 0; i < 50 && r.store.readState().pending !== 'v2'; i++) await new Promise((res) => setTimeout(res, 20));
  assert.equal(r.store.readState().pending, 'v2');
  r.stop();
});

test("downloads go through Electron's network stack when there is one (system proxy, OS certificates)", () => {
  const netFetch = function () {};
  const net = { fetch: netFetch };
  const picked = pickFetch({ net }, globalThis.fetch);
  assert.notEqual(picked, globalThis.fetch);
  assert.equal(pickFetch('/path/to/electron/binary', globalThis.fetch), globalThis.fetch);
  assert.equal(pickFetch(undefined, globalThis.fetch), globalThis.fetch);
});
