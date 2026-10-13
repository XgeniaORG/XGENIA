// Signed update manifests (2026-10-06): an update is downloaded only if what electron-updater found
// is exactly what CI signed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('crypto');
const {
  manifestName,
  parseManifest,
  signManifest,
  verifyUpdateInfo,
  releaseAssetUrl
} = require('../../src/main/src/update-manifest');
const { UPDATE_PUBLIC_KEY_PEM } = require('../../src/main/src/update-public-key');

const keys = () =>
  generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

// The shape electron-builder writes, and collect-release-assets.mjs merges for macOS.
const MANIFEST = `version: 3.0.1-beta.9.nightly.202610070215
files:
  - url: XGENIA-3.0.1-beta.9.nightly.202610070215-mac-x64.zip
    sha512: zipx64==
    size: 111
  - url: XGENIA-3.0.1-beta.9.nightly.202610070215-mac-arm64.zip
    sha512: 'ziparm64=='
    size: 222
path: XGENIA-3.0.1-beta.9.nightly.202610070215-mac-x64.zip
sha512: zipx64==
releaseDate: '2026-10-07T02:15:00.000Z'
`;

// What electron-updater hands to 'update-available' (GitHub provider adds the tag).
const INFO = {
  tag: 'v3.0.1-beta.9.nightly.202610070215',
  version: '3.0.1-beta.9.nightly.202610070215',
  files: [
    { url: 'XGENIA-3.0.1-beta.9.nightly.202610070215-mac-x64.zip', sha512: 'zipx64==', size: 111 },
    { url: 'XGENIA-3.0.1-beta.9.nightly.202610070215-mac-arm64.zip', sha512: 'ziparm64==', size: 222 }
  ]
};

test('parses the version and every file, unquoting values', () => {
  const m = parseManifest(MANIFEST);
  assert.equal(m.version, '3.0.1-beta.9.nightly.202610070215');
  assert.equal(m.files.length, 2);
  assert.equal(m.files[1].sha512, 'ziparm64==');
  assert.equal(m.files[0].size, '111');
});

test('an update matching the signed manifest passes', () => {
  const k = keys();
  const signature = signManifest(MANIFEST, k.privateKey);
  assert.doesNotThrow(() => verifyUpdateInfo({ info: INFO, manifest: MANIFEST, signature, publicKeyPem: k.publicKey }));
});

test('no signature, a wrong key, or an edited manifest is refused', () => {
  const k = keys();
  const signature = signManifest(MANIFEST, k.privateKey);
  assert.throws(() => verifyUpdateInfo({ info: INFO, manifest: MANIFEST, signature: '', publicKeyPem: k.publicKey }), /signature/);
  assert.throws(() => verifyUpdateInfo({ info: INFO, manifest: MANIFEST, signature, publicKeyPem: keys().publicKey }), /signature/);
  const edited = MANIFEST.replace('zipx64==', 'evil==');
  assert.throws(() => verifyUpdateInfo({ info: INFO, manifest: edited, signature, publicKeyPem: k.publicKey }), /signature/);
});

test('a file electron-updater would download that CI did not sign is refused', () => {
  const k = keys();
  const signature = signManifest(MANIFEST, k.privateKey);
  const swapped = { ...INFO, files: [{ ...INFO.files[0], sha512: 'evil==' }] };
  assert.throws(() => verifyUpdateInfo({ info: swapped, manifest: MANIFEST, signature, publicKeyPem: k.publicKey }), /sha512/);
  const extra = { ...INFO, files: [...INFO.files, { url: 'other.zip', sha512: 'x==' }] };
  assert.throws(() => verifyUpdateInfo({ info: extra, manifest: MANIFEST, signature, publicKeyPem: k.publicKey }), /not in the signed/);
  const older = { ...INFO, version: '3.0.1-beta.9.nightly.202610010000' };
  assert.throws(() => verifyUpdateInfo({ info: older, manifest: MANIFEST, signature, publicKeyPem: k.publicKey }), /version/);
});

test('each platform reads its own manifest, from the release tag', () => {
  assert.equal(manifestName('win32'), 'latest.yml');
  assert.equal(manifestName('darwin'), 'latest-mac.yml');
  assert.equal(manifestName('linux'), 'latest-linux.yml');
  assert.equal(
    releaseAssetUrl('XgeniaORG/XGENIA', 'v3.0.1', 'latest-mac.yml.sig'),
    'https://github.com/XgeniaORG/XGENIA/releases/download/v3.0.1/latest-mac.yml.sig'
  );
});

test('the app ships an ed25519 public key', () => {
  assert.match(UPDATE_PUBLIC_KEY_PEM, /^-----BEGIN PUBLIC KEY-----\n/);
});
