// Turn a built engine (<files>/viewer, <files>/deploy, <files>/compiler) into an upload folder:
// <out>/<version>/files/<path>.gz, <out>/<version>/manifest.json + .sig, and the same manifest and
// signature at <out>/channels/<channel>/. (2026-10-03)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { FORMAT, ROOTS, validateManifest, signManifest, sha256 } = require(path.join(ROOT, 'packages/xgenia-editor/src/main/src/live-engine/manifest.js'));

export const PUBLIC_BASE = 'https://pcrghrjikkcmelflwiys.supabase.co/storage/v1/object/public/engine';
const skip = (rel) => rel.endsWith('.map') || path.basename(rel) === '.DS_Store';

export function listPackFiles(filesDir) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(abs);
        continue;
      }
      const rel = path.relative(filesDir, abs).split(path.sep).join('/');
      if (!skip(rel) && ROOTS.some((r) => rel.startsWith(r))) out.push(rel);
    }
  };
  walk(filesDir);
  return out.sort();
}

export function buildManifest({ filesDir, version, channel, minShell, sources, issuedAt = new Date().toISOString(), publicBase = PUBLIC_BASE }) {
  const files = listPackFiles(filesDir).map((p) => {
    const body = fs.readFileSync(path.join(filesDir, p));
    return { path: p, sha256: sha256(body), size: body.length };
  });
  return validateManifest({ format: FORMAT, version, channel, issuedAt, minShell, sources, filesBase: `${publicBase}/${version}/files/`, files });
}

export function writePack({ filesDir, outDir, manifest, privateKeyPem }) {
  const raw = Buffer.from(JSON.stringify(manifest, null, 2));
  const sig = signManifest(raw, privateKeyPem);
  for (const f of manifest.files) {
    const dest = path.join(outDir, manifest.version, 'files', f.path + '.gz');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, zlib.gzipSync(fs.readFileSync(path.join(filesDir, f.path)), { level: 9 }));
  }
  for (const dir of [path.join(outDir, manifest.version), path.join(outDir, 'channels', manifest.channel)]) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), raw);
    fs.writeFileSync(path.join(dir, 'manifest.sig'), sig);
  }
  return { raw, sig };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = {};
  process.argv.slice(2).forEach((a, i, all) => {
    if (a.startsWith('--')) args[a.slice(2)] = all[i + 1];
  });
  const key = process.env.ENGINE_SIGNING_KEY;
  const version = process.env.XGENIA_ENGINE_VERSION;
  if (!key) { console.error('ENGINE_SIGNING_KEY is not set'); process.exit(1); }
  if (!version) { console.error('XGENIA_ENGINE_VERSION is not set'); process.exit(1); }
  if (!args.files || !args.out) { console.error('usage: pack.mjs --files <dir> --out <dir> [--channel beta]'); process.exit(2); }
  const channel = args.channel || 'beta';
  const { minShell } = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/xgenia-viewer-react/engine-compat.json'), 'utf8'));
  const manifest = buildManifest({
    filesDir: args.files, version, channel, minShell,
    sources: { outer: process.env.ENGINE_OUTER_SHA || '', private: process.env.ENGINE_PRIVATE_SHA || '' }
  });
  writePack({ filesDir: args.files, outDir: args.out, manifest, privateKeyPem: key });
  console.log(`packed ${manifest.files.length} files as ${version} (${channel}) -> ${args.out}`);
}
