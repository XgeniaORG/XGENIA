// Upload a pack to the public Supabase Storage bucket `engine`: the version's files and manifest
// first, the channel manifest last, so a channel never names files that are not there yet.
// Usage: SUPABASE_ENGINE_SERVICE_KEY=… node scripts/live-engine/publish.mjs <uploadDir> <version> <channel>
import fs from 'node:fs';
import path from 'node:path';

const SUPABASE_URL = 'https://pcrghrjikkcmelflwiys.supabase.co';
const BUCKET = 'engine';
const key = process.env.SUPABASE_ENGINE_SERVICE_KEY;
const [uploadDir, version, channel] = process.argv.slice(2);
if (!key) {
  console.error('SUPABASE_ENGINE_SERVICE_KEY is not set');
  process.exit(1);
}
if (!uploadDir || !version || !channel) {
  console.error('usage: publish.mjs <uploadDir> <version> <channel>');
  process.exit(2);
}
const auth = { Authorization: `Bearer ${key}`, apikey: key };

async function ensureBucket() {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true })
  });
  if (r.ok) return;
  const t = await r.text();
  if (!/already exists|duplicate/i.test(t)) throw new Error(`create bucket: ${r.status} ${t}`);
}

async function upload(objectPath, body, contentType, maxAge) {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${objectPath}`, {
    method: 'POST',
    headers: { ...auth, 'content-type': contentType, 'cache-control': `max-age=${maxAge}`, 'x-upsert': 'true' },
    body
  });
  if (!r.ok) throw new Error(`upload ${objectPath}: ${r.status} ${await r.text()}`);
}

function walk(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name)).split(path.sep).join('/')]
  );
}

const type = (p) => (p.endsWith('.gz') ? 'application/gzip' : p.endsWith('.json') ? 'application/json' : 'text/plain');

await ensureBucket();
const versionDir = path.join(uploadDir, version);
const files = walk(versionDir);
for (const rel of files) {
  await upload(`${version}/${rel}`, fs.readFileSync(path.join(versionDir, rel)), type(rel), 31536000);
}
for (const name of ['manifest.json', 'manifest.sig']) {
  await upload(`channels/${channel}/${name}`, fs.readFileSync(path.join(uploadDir, 'channels', channel, name)), type(name), 60);
}
console.log(`published ${version} (${files.length} objects) and pointed ${channel} at it: ${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/channels/${channel}/manifest.json`);
