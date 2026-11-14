#!/usr/bin/env node
// Signs every latest*.yml in a release folder with UPDATE_SIGNING_KEY (ed25519) and writes <name>.sig
// next to it. The app refuses an update whose manifest has no valid signature
// (packages/xgenia-editor/src/main/src/update-manifest.js), so a release without them installs
// nowhere: refuse to run without the key rather than publish one.
//
// Usage: UPDATE_SIGNING_KEY=<pem> node scripts/release/sign-update-manifests.mjs <release dir>
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { signManifest, verifyUpdateInfo, parseManifest } = require('../../packages/xgenia-editor/src/main/src/update-manifest.js');
const { UPDATE_PUBLIC_KEY_PEM } = require('../../packages/xgenia-editor/src/main/src/update-public-key.js');

export function signUpdateManifests(dir, privateKeyPem, publicKeyPem = UPDATE_PUBLIC_KEY_PEM) {
  const names = fs.readdirSync(dir).filter((n) => /^latest.*\.yml$/.test(n));
  if (!names.length) throw new Error(`no latest*.yml in ${dir}`);
  for (const name of names) {
    const raw = fs.readFileSync(path.join(dir, name));
    const signature = signManifest(raw, privateKeyPem);
    // The key in the secret must be the one the app trusts, or every install would refuse this release.
    const { version, files } = parseManifest(raw.toString('utf8'));
    verifyUpdateInfo({ info: { version, files }, manifest: raw, signature, publicKeyPem });
    fs.writeFileSync(path.join(dir, name + '.sig'), signature + '\n');
  }
  return names;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  const key = process.env.UPDATE_SIGNING_KEY;
  if (!dir) {
    console.error('usage: sign-update-manifests.mjs <release dir>');
    process.exit(2);
  }
  if (!key) {
    console.error('UPDATE_SIGNING_KEY is missing: refusing to publish a release no install would accept');
    process.exit(1);
  }
  for (const name of signUpdateManifests(dir, key)) console.log(`signed ${name}`);
}
