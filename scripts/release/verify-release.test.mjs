// node --test scripts/release/verify-release.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createRequire } from 'node:module';
import { checkRelease } from './verify-release.mjs';

const require = createRequire(import.meta.url);
const { signManifest } = require('../../packages/xgenia-editor/src/main/src/update-manifest.js');

const k = generateKeyPairSync('ed25519', {
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

const FILES = {
  'latest.yml': [['XGENIA-Setup-3.0.1.exe', 100]],
  'latest-mac.yml': [
    ['XGENIA-3.0.1-mac-x64.zip', 200],
    ['XGENIA-3.0.1-mac-arm64.zip', 300]
  ],
  'latest-linux.yml': [
    ['XGENIA-3.0.1.AppImage', 400],
    ['xgenia-editor_3.0.1_amd64.deb', 500]
  ]
};

function release({ key = k.privateKey } = {}) {
  const manifests = {};
  const assets = [];
  for (const [name, files] of Object.entries(FILES)) {
    const raw = `version: 3.0.1\nfiles:\n${files.map(([url, size]) => `  - url: ${url}\n    sha512: ${url}==\n    size: ${size}\n`).join('')}`;
    manifests[name] = { raw, sig: signManifest(raw, key) };
    assets.push({ name, size: raw.length }, { name: name + '.sig', size: 88 });
    for (const [url, size] of files) assets.push({ name: url, size });
  }
  return { manifests, assets, publicKeyPem: k.publicKey };
}

test('a complete, signed release has no problems', () => {
  assert.deepEqual(checkRelease(release()), []);
});

test('a missing manifest or signature is a problem', () => {
  const r = release();
  delete r.manifests['latest-linux.yml'];
  r.manifests['latest.yml'].sig = undefined;
  assert.deepEqual(checkRelease(r), ['latest.yml.sig is missing', 'latest-linux.yml is missing']);
});

test('a manifest signed with another key is a problem', () => {
  const r = release({ key: generateKeyPairSync('ed25519').privateKey });
  assert.equal(checkRelease(r).length, 3);
  assert.match(checkRelease(r)[0], /signature/);
});

test('a listed file that did not upload, or uploaded short, is a problem', () => {
  const r = release();
  r.assets = r.assets.filter((a) => a.name !== 'XGENIA-3.0.1-mac-arm64.zip');
  r.assets.find((a) => a.name === 'XGENIA-Setup-3.0.1.exe').size = 42;
  assert.deepEqual(checkRelease(r), [
    'XGENIA-Setup-3.0.1.exe is 42 bytes, latest.yml says 100',
    'latest-mac.yml lists XGENIA-3.0.1-mac-arm64.zip, which is not in the release'
  ]);
});
