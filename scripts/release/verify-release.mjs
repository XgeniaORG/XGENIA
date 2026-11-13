#!/usr/bin/env node
// Checks a GitHub release the way an installed app will use it, before and after it is published
// (release.yml): every update manifest is there, signed with the key the app trusts, and every file
// a manifest lists is an asset of the release with the size the manifest says.
//
//   --draft:  reads the (not yet public) release through the gh CLI; run before publishing.
//   --public: reads it from the public download URLs, as an app does; run after publishing.
//
// Usage: node scripts/release/verify-release.mjs <tag> --draft|--public [--repo owner/name]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { parseManifest, verifyUpdateInfo, releaseAssetUrl } = require('../../packages/xgenia-editor/src/main/src/update-manifest.js');
const { UPDATE_PUBLIC_KEY_PEM } = require('../../packages/xgenia-editor/src/main/src/update-public-key.js');

/** One per platform the app updates on (update-manifest.js manifestName). */
export const REQUIRED_MANIFESTS = ['latest.yml', 'latest-mac.yml', 'latest-linux.yml'];

/**
 * @param manifests { [name]: { raw: Buffer|string, sig: string } | undefined }
 * @param assets    [{ name, size }]
 * @returns the problems found; empty means the release is good.
 */
export function checkRelease({ manifests, assets, publicKeyPem = UPDATE_PUBLIC_KEY_PEM }) {
  const problems = [];
  const sizes = new Map(assets.map((a) => [a.name, Number(a.size)]));
  for (const name of REQUIRED_MANIFESTS) {
    const m = manifests[name];
    if (!m || m.raw == null) {
      problems.push(`${name} is missing`);
      continue;
    }
    if (!m.sig) {
      problems.push(`${name}.sig is missing`);
      continue;
    }
    const parsed = parseManifest(Buffer.from(m.raw).toString('utf8'));
    try {
      verifyUpdateInfo({ info: parsed, manifest: m.raw, signature: m.sig, publicKeyPem });
    } catch (err) {
      problems.push(`${name}: ${err.message}`);
      continue;
    }
    for (const f of parsed.files) {
      if (!sizes.has(f.url)) problems.push(`${name} lists ${f.url}, which is not in the release`);
      else if (f.size != null && sizes.get(f.url) !== Number(f.size)) {
        problems.push(`${f.url} is ${sizes.get(f.url)} bytes, ${name} says ${f.size}`);
      }
    }
  }
  return problems;
}

function readDraft(repo, tag) {
  const gh = (...args) => execFileSync('gh', [...args, '-R', repo], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const assets = JSON.parse(gh('release', 'view', tag, '--json', 'assets')).assets.map((a) => ({ name: a.name, size: a.size }));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-release-'));
  const manifests = {};
  for (const name of REQUIRED_MANIFESTS) {
    const read = (file) => {
      if (!assets.some((a) => a.name === file)) return undefined;
      gh('release', 'download', tag, '--pattern', file, '--dir', dir, '--clobber');
      return fs.readFileSync(path.join(dir, file));
    };
    const raw = read(name);
    const sig = read(name + '.sig');
    manifests[name] = raw ? { raw, sig: sig?.toString('utf8') } : undefined;
  }
  return { manifests, assets };
}

async function readPublic(repo, tag) {
  const get = async (name) => {
    const res = await fetch(releaseAssetUrl(repo, tag, name), { cache: 'no-store' });
    return res.ok ? Buffer.from(await res.arrayBuffer()) : undefined;
  };
  const manifests = {};
  const assets = [];
  for (const name of REQUIRED_MANIFESTS) {
    const raw = await get(name);
    const sig = await get(name + '.sig');
    manifests[name] = raw ? { raw, sig: sig?.toString('utf8') } : undefined;
    if (!raw) continue;
    // The size each listed file is actually served with, at the URL the app downloads from.
    for (const f of parseManifest(raw.toString('utf8')).files) {
      if (assets.some((a) => a.name === f.url)) continue;
      const res = await fetch(releaseAssetUrl(repo, tag, f.url), { method: 'HEAD' });
      const size = res.ok ? res.headers.get('content-length') : null;
      if (size != null) assets.push({ name: f.url, size: Number(size) });
    }
  }
  return { manifests, assets };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const tag = args.find((a) => !a.startsWith('--'));
  const repoArg = args.indexOf('--repo');
  const repo = repoArg !== -1 ? args[repoArg + 1] : process.env.GITHUB_REPOSITORY;
  const mode = args.includes('--public') ? 'public' : args.includes('--draft') ? 'draft' : null;
  if (!tag || !repo || !mode) {
    console.error('usage: verify-release.mjs <tag> --draft|--public [--repo owner/name]');
    process.exit(2);
  }
  const release = mode === 'draft' ? readDraft(repo, tag) : await readPublic(repo, tag);
  const problems = checkRelease(release);
  if (problems.length) {
    for (const p of problems) console.error(`::error::${tag} (${mode}): ${p}`);
    process.exit(1);
  }
  console.log(`${tag} (${mode}): ${REQUIRED_MANIFESTS.join(', ')} signed, every listed file present with the right size`);
}
