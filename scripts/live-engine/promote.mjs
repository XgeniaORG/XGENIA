// Point the stable channel at a version already published (default: the current beta), re-signed
// with a new issuedAt. Apps refuse a manifest older than the last one they accepted, so a rollback
// is "promote an older version". Usage: ENGINE_SIGNING_KEY=… SUPABASE_ENGINE_SERVICE_KEY=… \
//   node scripts/live-engine/promote.mjs [version]
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { verifyManifest, validateManifest, signManifest } = require(path.join(ROOT, 'packages/xgenia-editor/src/main/src/live-engine/manifest.js'));
const { ENGINE_PUBLIC_KEY_PEM } = require(path.join(ROOT, 'packages/xgenia-editor/src/main/src/live-engine/public-key.js'));

const SUPABASE_URL = 'https://pcrghrjikkcmelflwiys.supabase.co';
const PUBLIC = `${SUPABASE_URL}/storage/v1/object/public/engine`;
const signingKey = process.env.ENGINE_SIGNING_KEY;
const serviceKey = process.env.SUPABASE_ENGINE_SERVICE_KEY;
if (!signingKey || !serviceKey) {
  console.error('ENGINE_SIGNING_KEY and SUPABASE_ENGINE_SERVICE_KEY must be set');
  process.exit(1);
}
const version = process.argv[2];
const from = version ? `${PUBLIC}/${version}` : `${PUBLIC}/channels/beta`;

const get = async (url) => {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return Buffer.from(await r.arrayBuffer());
};
const m = verifyManifest(await get(`${from}/manifest.json`), (await get(`${from}/manifest.sig`)).toString('utf8'), ENGINE_PUBLIC_KEY_PEM);
const stable = validateManifest({ ...m, channel: 'stable', issuedAt: new Date().toISOString() });
const raw = Buffer.from(JSON.stringify(stable, null, 2));
const sig = signManifest(raw, signingKey);
for (const [name, body, type] of [['manifest.json', raw, 'application/json'], ['manifest.sig', Buffer.from(sig), 'text/plain']]) {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/engine/channels/stable/${name}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'content-type': type, 'cache-control': 'max-age=60', 'x-upsert': 'true' },
    body
  });
  if (!r.ok) throw new Error(`upload ${name}: ${r.status} ${await r.text()}`);
}
console.log(`stable -> ${stable.version} (issued ${stable.issuedAt})`);
