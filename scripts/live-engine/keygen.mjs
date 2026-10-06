// Makes the live-engine signing key pair. The public key is written into the app
// (packages/xgenia-editor/src/main/src/live-engine/public-key.js); the private key goes ONLY into
// the GitHub secret ENGINE_SIGNING_KEY. Usage: node scripts/live-engine/keygen.mjs <private-key-out.pem>
import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = process.argv[2];
if (!out) {
  console.error('usage: keygen.mjs <private-key-out.pem>');
  process.exit(2);
}
if (existsSync(out)) {
  console.error(`${out} exists — refusing to overwrite a signing key`);
  process.exit(1);
}
const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});
writeFileSync(out, privateKey, { mode: 0o600 });
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const target = path.join(ROOT, 'packages/xgenia-editor/src/main/src/live-engine/public-key.js');
writeFileSync(
  target,
  `// ed25519 public key for live-engine manifests. The private half is the GitHub secret
// ENGINE_SIGNING_KEY (XgeniaORG/XGENIA). Rotating it means a new app build. (2026-10-03)
module.exports = {
  ENGINE_PUBLIC_KEY_PEM: ${JSON.stringify(publicKey)}
};
`
);
console.log(`private key -> ${out} (mode 600)\npublic key  -> ${path.relative(ROOT, target)}`);
