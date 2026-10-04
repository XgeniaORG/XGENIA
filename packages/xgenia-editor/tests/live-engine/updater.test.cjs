// Live engine (2026-10-03): the background check only ever leaves a verified engine pending.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EngineStore } = require('../../src/main/src/live-engine/engine-store');
const { checkForEngineUpdate } = require('../../src/main/src/live-engine/updater');
const { keys, fakeCdn } = require('./helpers.cjs');

const k = keys();
const CDN = 'https://cdn.example/engine';
const cdnWith = (o = {}) => fakeCdn({ signKey: k.privateKey, cdn: CDN, ...o });
const newStore = () => new EngineStore(fs.mkdtempSync(path.join(os.tmpdir(), 'xgenia-upd-')));
const run = (store, cdn, channel = 'beta', shellApi = 1) =>
  checkForEngineUpdate({ store, channel, fetchBytes: cdn.fetchBytes, publicKeyPem: k.publicKey, shellApi, cdn: CDN });

test('a new signed engine is downloaded, verified and left pending', async () => {
  const store = newStore();
  assert.deepEqual(await run(store, cdnWith()), { status: 'installed', version: 'v2' });
  const s = store.readState();
  assert.equal(s.pending, 'v2');
  assert.equal(s.accepted.version, 'v2');
  assert.equal(fs.readFileSync(path.join(store.versionDir('v2'), 'viewer/xgenia.viewer.js'), 'utf8'), 'LIVE VIEWER');
});

test('the same engine again downloads nothing', async () => {
  const store = newStore();
  await run(store, cdnWith());
  const again = cdnWith();
  assert.equal((await run(store, again)).status, 'up-to-date');
  assert.equal(again.fetched.length, 2);
});

test('a manifest signed by someone else is refused; offline is an error', async () => {
  assert.equal((await run(newStore(), cdnWith({ signKey: keys().privateKey }))).status, 'rejected');
  const offline = await checkForEngineUpdate({
    store: newStore(), channel: 'beta', publicKeyPem: k.publicKey, shellApi: 1, cdn: CDN,
    fetchBytes: async () => { throw new Error('getaddrinfo ENOTFOUND'); }
  });
  assert.equal(offline.status, 'error');
  assert.match(offline.reason, /ENOTFOUND/);
});

test('a beta manifest served on the stable path is refused', async () => {
  const beta = cdnWith({ channel: 'beta' });
  const moved = async (url) => beta.fetchBytes(url.replace('/channels/stable/', '/channels/beta/'));
  const r = await checkForEngineUpdate({ store: newStore(), channel: 'stable', fetchBytes: moved, publicKeyPem: k.publicKey, shellApi: 1, cdn: CDN });
  assert.equal(r.status, 'rejected');
  assert.match(r.reason, /manifest is for beta/);
});

test('an older manifest replayed after a newer one is refused', async () => {
  const store = newStore();
  await run(store, cdnWith({ version: 'v3', issuedAt: '2026-10-04T00:00:00.000Z' }));
  const r = await run(store, cdnWith({ version: 'v2', issuedAt: '2026-10-03T00:00:00.000Z' }));
  assert.equal(r.status, 'rejected');
  assert.match(r.reason, /replay/);
});

test('a rollback (older engine, newer issuedAt) is installed', async () => {
  const store = newStore();
  await run(store, cdnWith({ version: 'v3', issuedAt: '2026-10-04T00:00:00.000Z' }));
  assert.deepEqual(await run(store, cdnWith({ version: 'v2', issuedAt: '2026-10-05T00:00:00.000Z' })), { status: 'installed', version: 'v2' });
});

test('an engine that needs a newer app is not downloaded', async () => {
  const store = newStore();
  const cdn = cdnWith({ minShell: 2 });
  const r = await run(store, cdn);
  assert.equal(r.status, 'needs-app-update');
  assert.equal(store.readState().needsAppUpdate, 'v2');
  assert.equal(store.readState().pending, null);
  assert.equal(cdn.fetched.length, 2);
});

test('a corrupt file aborts the install; nothing pending', async () => {
  const store = newStore();
  const r = await run(store, cdnWith({ corrupt: 'deploy/xgenia.deploy.js' }));
  assert.equal(r.status, 'error');
  assert.match(r.reason, /hash mismatch/);
  assert.equal(store.readState().pending, null);
});

test('an engine already marked bad here is not fetched again', async () => {
  const store = newStore();
  store.writeState({ ...store.readState(), bad: ['v2'] });
  assert.equal((await run(store, cdnWith())).status, 'rejected');
});
