// Live engine (2026-10-03): a downloaded engine is either complete and hash-checked, or absent.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EngineStore } = require('../../src/main/src/live-engine/engine-store');
const { signManifest } = require('../../src/main/src/live-engine/manifest');
const { keys, packFiles, makeManifest } = require('./helpers.cjs');

const k = keys();
function setup(files = packFiles(), over = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xgenia-engine-'));
  const m = makeManifest(files, over);
  const raw = Buffer.from(JSON.stringify(m));
  return { store: new EngineStore(dir), dir, m, raw, sig: signManifest(raw, k.privateKey), files };
}
const fetchFrom = (files) => async (f) => Buffer.from(files[f.path]);

test('install writes every file and the signed manifest, which reads back verified', async () => {
  const s = setup();
  await s.store.install(s.raw, s.sig, s.m, fetchFrom(s.files));
  assert.equal(fs.readFileSync(path.join(s.store.versionDir(s.m.version), 'viewer/xgenia.viewer.js'), 'utf8'), 'LIVE VIEWER');
  assert.equal(s.store.readInstalledManifest(s.m.version, k.publicKey).version, s.m.version);
  assert.equal(s.store.isComplete(s.m), true);
});

test('installing a version already complete downloads nothing', async () => {
  const s = setup();
  await s.store.install(s.raw, s.sig, s.m, fetchFrom(s.files));
  let calls = 0;
  await s.store.install(s.raw, s.sig, s.m, async (f) => { calls++; return Buffer.from(s.files[f.path]); });
  assert.equal(calls, 0);
});

test('a file whose bytes do not match aborts the install and leaves no version', async () => {
  const s = setup();
  await assert.rejects(
    s.store.install(s.raw, s.sig, s.m, async (f) => Buffer.from(f.path === 'deploy/xgenia.deploy.js' ? 'TAMPERED' : s.files[f.path])),
    /hash mismatch for deploy\/xgenia\.deploy\.js/
  );
  assert.equal(fs.existsSync(s.store.versionDir(s.m.version)), false);
});

test('a download that dies half way never becomes a version', async () => {
  const s = setup();
  let n = 0;
  await assert.rejects(
    s.store.install(s.raw, s.sig, s.m, async (f) => {
      if (++n === 3) throw new Error('network gone');
      return Buffer.from(s.files[f.path]);
    }),
    /network gone/
  );
  assert.equal(fs.existsSync(s.store.versionDir(s.m.version)), false);
});

test('a file changed on disk after install makes the version incomplete', async () => {
  const s = setup();
  await s.store.install(s.raw, s.sig, s.m, fetchFrom(s.files));
  fs.writeFileSync(path.join(s.store.versionDir(s.m.version), 'viewer/xgenia.viewer.js'), 'EDITED');
  assert.equal(s.store.isComplete(s.m), false);
});

test('an installed manifest checked against another key reads as absent', async () => {
  const s = setup();
  await s.store.install(s.raw, s.sig, s.m, fetchFrom(s.files));
  assert.equal(s.store.readInstalledManifest(s.m.version, keys().publicKey), null);
});

test('state round-trips; a missing or corrupt state file reads as empty', () => {
  const s = setup();
  assert.deepEqual(s.store.readState().bad, []);
  assert.equal(s.store.readState().cleanExit, true);
  s.store.writeState({ ...s.store.readState(), active: 'v1', bad: ['v0'] });
  assert.equal(s.store.readState().active, 'v1');
  fs.writeFileSync(s.store.statePath(), '{not json');
  assert.equal(s.store.readState().active, null);
});

test('prune keeps only the named versions', () => {
  const s = setup();
  for (const v of ['a1', 'b2', 'c3', '.partial-d4']) fs.mkdirSync(s.store.versionDir(v), { recursive: true });
  s.store.prune(['b2']);
  assert.deepEqual(fs.readdirSync(path.join(s.dir, 'versions')), ['b2']);
});

// ── 2026-10-04: deferred review minors ──
test('prune never removes a download in progress', async () => {
  const s = setup();
  let release;
  const gate = new Promise((r) => (release = r));
  let n = 0;
  const installing = s.store.install(s.raw, s.sig, s.m, async (f) => {
    if (++n === 2) await gate;
    return Buffer.from(s.files[f.path]);
  });
  await new Promise((r) => setImmediate(r));
  s.store.prune([]);
  release();
  await installing;
  assert.equal(s.store.isComplete(s.m), true);
});
