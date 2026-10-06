// node --test scripts/release/sign-update-manifests.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { createRequire } from 'node:module';
import { signUpdateManifests } from './sign-update-manifests.mjs';

const require = createRequire(import.meta.url);
const { verifyUpdateInfo, parseManifest } = require('../../packages/xgenia-editor/src/main/src/update-manifest.js');

const keys = () =>
  generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

const manifest = (file) => `version: 3.0.1
files:
  - url: ${file}
    sha512: abc==
    size: 1
path: ${file}
sha512: abc==
`;

function releaseDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sign-manifests-'));
  fs.writeFileSync(path.join(dir, 'latest.yml'), manifest('XGENIA-Setup-3.0.1.exe'));
  fs.writeFileSync(path.join(dir, 'latest-mac.yml'), manifest('XGENIA-3.0.1-mac-x64.zip'));
  fs.writeFileSync(path.join(dir, 'latest-linux.yml'), manifest('XGENIA-3.0.1.AppImage'));
  fs.writeFileSync(path.join(dir, 'XGENIA-Setup-3.0.1.exe'), 'x');
  return dir;
}

test('every latest*.yml gets a .sig the app accepts', () => {
  const k = keys();
  const dir = releaseDir();
  assert.deepEqual(signUpdateManifests(dir, k.privateKey, k.publicKey).sort(), ['latest-linux.yml', 'latest-mac.yml', 'latest.yml']);
  for (const name of ['latest.yml', 'latest-mac.yml', 'latest-linux.yml']) {
    const raw = fs.readFileSync(path.join(dir, name));
    const signature = fs.readFileSync(path.join(dir, name + '.sig'), 'utf8');
    const { version, files } = parseManifest(raw.toString('utf8'));
    assert.doesNotThrow(() => verifyUpdateInfo({ info: { version, files }, manifest: raw, signature, publicKeyPem: k.publicKey }));
  }
});

test('a key that is not the one the app trusts is refused before anything is written', () => {
  const dir = releaseDir();
  assert.throws(() => signUpdateManifests(dir, keys().privateKey, keys().publicKey), /signature/);
  assert.ok(!fs.existsSync(path.join(dir, 'latest.yml.sig')));
});

test('a folder with no manifests is refused', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sign-manifests-empty-'));
  assert.throws(() => signUpdateManifests(dir, keys().privateKey), /no latest/);
});
