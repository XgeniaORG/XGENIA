// Live engine (2026-10-03): what CI uploads is exactly what the app will accept.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { generateKeyPairSync } from 'node:crypto';
import { createRequire } from 'node:module';
import { buildManifest, writePack, listPackFiles } from './pack.mjs';

const require = createRequire(import.meta.url);
const { verifyManifest } = require('../../packages/xgenia-editor/src/main/src/live-engine/manifest.js');
const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

function filesDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xgenia-pack-'));
  const files = {
    'viewer/index.html': '<html>', 'viewer/xgenia.viewer.js': 'V', 'viewer/xgenia.683.js': 'C',
    'deploy/index.json': '[]', 'deploy/xgenia.deploy.js': 'D', 'deploy/xgenia.deploy.js.map': 'MAP',
    'compiler/xgenia.rgs-compiler.js': 'X', 'stray.txt': 'no'
  };
  for (const [p, b] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    fs.writeFileSync(path.join(dir, p), b);
  }
  return dir;
}

test('source maps and files outside viewer/deploy/compiler are left out', () => {
  assert.deepEqual(listPackFiles(filesDir()), [
    'compiler/xgenia.rgs-compiler.js', 'deploy/index.json', 'deploy/xgenia.deploy.js',
    'viewer/index.html', 'viewer/xgenia.683.js', 'viewer/xgenia.viewer.js'
  ]);
});

test('the pack verifies with the public key and every .gz unpacks to its listed bytes', () => {
  const dir = filesDir();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'xgenia-out-'));
  const m = buildManifest({ filesDir: dir, version: 'v7', channel: 'beta', minShell: 1, sources: {} });
  writePack({ filesDir: dir, outDir: out, manifest: m, privateKeyPem: privateKey });
  for (const where of ['v7', 'channels/beta']) {
    const got = verifyManifest(fs.readFileSync(path.join(out, where, 'manifest.json')), fs.readFileSync(path.join(out, where, 'manifest.sig'), 'utf8'), publicKey);
    assert.equal(got.version, 'v7');
    assert.ok(got.filesBase.endsWith('/engine/v7/files/'));
  }
  assert.equal(zlib.gunzipSync(fs.readFileSync(path.join(out, 'v7/files/viewer/xgenia.viewer.js.gz'))).toString(), 'V');
});

test('a build missing the compiler cannot be packed', () => {
  const dir = filesDir();
  fs.rmSync(path.join(dir, 'compiler'), { recursive: true });
  assert.throws(() => buildManifest({ filesDir: dir, version: 'v7', channel: 'beta', minShell: 1, sources: {} }), /missing compiler/);
});
