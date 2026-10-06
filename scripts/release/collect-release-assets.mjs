#!/usr/bin/env node
// Gathers release.yml's build artifacts into one folder for `gh release create`.
//
// macOS is built once per arch, and each build writes its own latest-mac.yml listing only its own
// zip and dmg. The auto-updater reads ONE latest-mac.yml per release and picks the arm64 or x64 zip
// from its file list, so the two are merged into one. Everything else is copied as is.
//
// It refuses to produce a release with a hole in it: a missing arch, manifests from two versions,
// or a manifest naming a file that was not built. Any of those installs nothing for some users.
//
// Usage: node scripts/release/collect-release-assets.mjs <artifacts dir> <output dir>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// No latest-linux.yml: the app never checks for updates on Linux (autoupdater.js returns early).
const SHIPPED = [/\.dmg$/, /-mac-.*\.zip$/, /\.blockmap$/, /Setup.*\.exe$/, /\.deb$/, /\.AppImage$/, /^latest\.yml$/];

// electron-builder's latest*.yml: top-level scalars and one `files:` list of `- url:` entries.
// Values are kept as written (quotes included) so they come back out unchanged.
export function parseManifest(text) {
  const head = {};
  const files = [];
  let inFiles = false;
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (!line.trim()) continue;
    if (/^files:\s*$/.test(line)) {
      inFiles = true;
      continue;
    }
    if (inFiles && /^\s/.test(line)) {
      const m = /^\s+(-\s+)?(\w+):\s*(.*)$/.exec(line);
      if (!m) throw new Error(`unreadable line in files: ${line}`);
      if (m[1]) files.push({});
      if (!files.length) throw new Error(`file field before any "- url:" entry: ${line}`);
      files[files.length - 1][m[2]] = m[3];
      continue;
    }
    inFiles = false;
    const m = /^(\w+):\s*(.*)$/.exec(line);
    if (!m) throw new Error(`unreadable manifest line: ${line}`);
    head[m[1]] = m[2];
  }
  return { head, files };
}

function writeManifest({ head, files }) {
  const out = [`version: ${head.version}`, 'files:'];
  for (const file of files) {
    Object.entries(file).forEach(([key, value], i) => out.push(`${i === 0 ? '  - ' : '    '}${key}: ${value}`));
  }
  for (const [key, value] of Object.entries(head)) if (key !== 'version') out.push(`${key}: ${value}`);
  return out.join('\n') + '\n';
}

const unquote = (v) => String(v).replace(/^['"]|['"]$/g, '');

export function mergeMacManifests(texts) {
  const manifests = texts.map(parseManifest);
  const isArm64 = (m) => m.files.some((f) => /arm64/.test(f.url));
  const arm64 = manifests.filter(isArm64);
  const x64 = manifests.filter((m) => !isArm64(m));
  if (manifests.length !== 2 || arm64.length !== 1 || x64.length !== 1) {
    throw new Error(`expected one arm64 and one x64 latest-mac.yml, got ${arm64.length} arm64 and ${x64.length} x64`);
  }
  if (unquote(arm64[0].head.version) !== unquote(x64[0].head.version)) {
    throw new Error(`macOS manifests disagree on version: arm64 ${arm64[0].head.version}, x64 ${x64[0].head.version}`);
  }
  // x64 first, and its top-level path/sha512, as a single-arch x64 build writes them: old updaters
  // read only those fields, and the arm64 updater picks its own zip out of `files`.
  return writeManifest({ head: x64[0].head, files: [...x64[0].files, ...arm64[0].files] });
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

export function collectReleaseAssets(srcDir, outDir) {
  const all = walk(srcDir);
  const macManifests = all.filter((f) => path.basename(f) === 'latest-mac.yml');
  if (macManifests.length !== 2) {
    throw new Error(`expected 2 latest-mac.yml (arm64 + x64), found ${macManifests.length}`);
  }

  fs.mkdirSync(outDir, { recursive: true });
  for (const file of all) {
    const name = path.basename(file);
    if (name === 'latest-mac.yml' || !SHIPPED.some((re) => re.test(name))) continue;
    const dest = path.join(outDir, name);
    if (fs.existsSync(dest) && !fs.readFileSync(dest).equals(fs.readFileSync(file))) {
      throw new Error(`two different files are both named ${name}`);
    }
    fs.copyFileSync(file, dest);
  }
  fs.writeFileSync(
    path.join(outDir, 'latest-mac.yml'),
    mergeMacManifests(macManifests.map((f) => fs.readFileSync(f, 'utf8')))
  );

  const manifests = fs.readdirSync(outDir).filter((n) => /^latest.*\.yml$/.test(n));
  if (!manifests.includes('latest.yml')) throw new Error('no latest.yml: the Windows build left no update manifest');
  for (const name of manifests) {
    const { files } = parseManifest(fs.readFileSync(path.join(outDir, name), 'utf8'));
    for (const { url } of files) {
      if (!fs.existsSync(path.join(outDir, url))) throw new Error(`${name} lists ${url}, which was not built`);
    }
  }
  return fs.readdirSync(outDir).sort();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [src, out] = process.argv.slice(2);
  if (!src || !out) {
    console.error('usage: collect-release-assets.mjs <artifacts dir> <output dir>');
    process.exit(2);
  }
  for (const name of collectReleaseAssets(src, out)) console.log(name);
}
