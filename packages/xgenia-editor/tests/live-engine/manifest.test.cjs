// Live engine (2026-10-03): nothing the app downloads runs unless our CI signed it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { verifyManifest, signManifest, validateManifest, isSafePath } = require('../../src/main/src/live-engine/manifest');
const { keys, packFiles, makeManifest } = require('./helpers.cjs');

const k = keys();
const signed = (m, key = k.privateKey) => {
  const raw = Buffer.from(JSON.stringify(m));
  return { raw, sig: signManifest(raw, key) };
};

test('a manifest signed by our key verifies and parses', () => {
  const m = makeManifest(packFiles());
  const { raw, sig } = signed(m);
  assert.equal(verifyManifest(raw, sig, k.publicKey).version, m.version);
});

test('one changed byte, another key, or a garbage signature is refused', () => {
  const { raw, sig } = signed(makeManifest(packFiles()));
  const tampered = Buffer.from(raw);
  tampered[tampered.length - 2] ^= 1;
  assert.throws(() => verifyManifest(tampered, sig, k.publicKey), /signature does not match/);
  const other = keys();
  assert.throws(() => verifyManifest(raw, signManifest(raw, other.privateKey), k.publicKey), /signature does not match/);
  assert.throws(() => verifyManifest(raw, 'not base64 at all!!', k.publicKey), /signature does not match/);
});

test('a signed manifest that is malformed is still refused', () => {
  const { raw, sig } = signed({ ...makeManifest(packFiles()), minShell: 0 });
  assert.throws(() => verifyManifest(raw, sig, k.publicKey), /bad minShell/);
});

test('paths stay inside viewer/, deploy/, compiler/', () => {
  for (const p of ['../x', 'viewer/../../x', '/etc/passwd', 'other/x', 'viewer//x', 'viewer\\x.js', 'viewer/./x', 'viewer/x\0']) {
    assert.equal(isSafePath(p), false, p);
  }
  for (const p of ['viewer/xgenia.viewer.js', 'deploy/index.json', 'compiler/xgenia.rgs-compiler.js']) {
    assert.equal(isSafePath(p), true, p);
  }
  assert.throws(() => validateManifest(makeManifest(packFiles({ '../evil.js': 'x' }))), /unsafe path/);
});

test('every required file must be listed', () => {
  const files = packFiles();
  delete files['compiler/xgenia.rgs-compiler.js'];
  assert.throws(() => validateManifest(makeManifest(files)), /missing compiler\/xgenia\.rgs-compiler\.js/);
});

test('the app supports the minShell the engine source declares', () => {
  const { SHELL_API_VERSION } = require('../../src/main/src/live-engine/shell-api');
  const { minShell } = require('../../../xgenia-viewer-react/engine-compat.json');
  assert.ok(Number.isInteger(minShell) && minShell >= 1);
  assert.equal(
    SHELL_API_VERSION,
    minShell,
    `the engine is built for app shell ${minShell}, the app is ${SHELL_API_VERSION}: bump both in the same PR as the editor change`
  );
});
