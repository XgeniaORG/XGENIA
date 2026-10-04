// After a publish: download the channel's engine exactly as an app would (real bucket, the app's
// public key), select it, and confirm its viewer bundle carries the version. Uses a temp userData.
// Usage: node scripts/live-engine/e2e-check.mjs [channel=beta]
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LE = path.join(ROOT, 'packages/xgenia-editor/src/main/src/live-engine');
const { EngineStore } = require(path.join(LE, 'engine-store.js'));
const { checkForEngineUpdate } = require(path.join(LE, 'updater.js'));
const { selectEngine } = require(path.join(LE, 'select.js'));
const { ENGINE_PUBLIC_KEY_PEM } = require(path.join(LE, 'public-key.js'));
const { SHELL_API_VERSION } = require(path.join(LE, 'shell-api.js'));

const channel = process.argv[2] || 'beta';
const store = new EngineStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xgenia-e2e-')), 'engine'));
const fetchBytes = async (url) => {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return Buffer.from(await r.arrayBuffer());
};
const t0 = Date.now();
const r = await checkForEngineUpdate({ store, channel, fetchBytes, publicKeyPem: ENGINE_PUBLIC_KEY_PEM, shellApi: SHELL_API_VERSION });
console.log('update check:', JSON.stringify(r), `${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (r.status !== 'installed') process.exit(1);
const info = selectEngine({ appPath: '/nonexistent-app', isPackaged: true, env: {}, store, publicKeyPem: ENGINE_PUBLIC_KEY_PEM, shellApi: SHELL_API_VERSION });
console.log('selected:', info.source, info.version);
const viewer = fs.readFileSync(path.join(info.root, 'viewer/xgenia.viewer.js'), 'utf8');
if (info.source !== 'live' || !viewer.includes(info.version)) process.exit(1);
console.log('e2e ok');
