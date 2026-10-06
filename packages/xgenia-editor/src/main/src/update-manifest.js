// Signed update manifests (2026-10-06). CI signs every latest*.yml of a release with an ed25519 key
// (scripts/release/sign-update-manifests.mjs) and uploads the signature next to it as <name>.sig.
// Before downloading, the app fetches that manifest and its signature itself and checks that what
// electron-updater is about to download (every file's url and sha512) is exactly what CI signed.
// electron-updater then checks the downloaded file against that sha512, so a release or manifest
// that did not come from our CI is never installed. Fail-closed: no signature, no update.
//
// Pure (no electron), so CI and the tests use the same code as the app.
'use strict';
const crypto = require('crypto');

const MAX_MANIFEST_BYTES = 256 * 1024;

/** The manifest electron-updater reads on this platform; nightly.yml/release.yml only publish these. */
function manifestName(platform = process.platform) {
  if (platform === 'win32') return 'latest.yml';
  if (platform === 'darwin') return 'latest-mac.yml';
  return 'latest-linux.yml';
}

const unquote = (v) => String(v).trim().replace(/^(['"])(.*)\1$/, '$2');

/**
 * electron-builder's latest*.yml: top-level `version`, and one `files:` list of `- url:` entries
 * with sha512 and size. Anything else (path, releaseDate, block scalars) is not needed and skipped.
 */
function parseManifest(text) {
  let version = null;
  const files = [];
  let inFiles = false;
  for (const line of String(text).replace(/\r\n/g, '\n').split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (/^files:\s*$/.test(line)) {
      inFiles = true;
      continue;
    }
    if (/^\S/.test(line)) {
      inFiles = false;
      const m = /^version:\s*(.+)$/.exec(line);
      if (m) version = unquote(m[1]);
      continue;
    }
    if (!inFiles) continue;
    const m = /^\s+(-\s+)?(\w+):\s*(.*)$/.exec(line);
    if (!m) continue;
    if (m[1]) files.push({});
    if (files.length) files[files.length - 1][m[2]] = unquote(m[3]);
  }
  return { version, files };
}

function signManifest(raw, privateKeyPem) {
  return crypto.sign(null, Buffer.isBuffer(raw) ? raw : Buffer.from(raw), privateKeyPem).toString('base64');
}

function fail(msg) {
  throw new Error('update manifest: ' + msg);
}

/**
 * Throws unless `signature` is our key's signature over `manifest`, and every file in `info` (what
 * electron-updater found) appears in the signed manifest with the same sha512.
 */
function verifyUpdateInfo({ info, manifest, signature, publicKeyPem }) {
  const bytes = Buffer.isBuffer(manifest) ? manifest : Buffer.from(String(manifest));
  if (bytes.length > MAX_MANIFEST_BYTES) fail('too large');
  let ok = false;
  try {
    ok = crypto.verify(null, bytes, publicKeyPem, Buffer.from(String(signature || '').trim(), 'base64'));
  } catch {
    ok = false;
  }
  if (!ok) fail('signature does not match');

  const signed = parseManifest(bytes.toString('utf8'));
  if (!info || signed.version !== String(info.version)) fail(`signed version ${signed.version} is not ${info && info.version}`);
  const files = Array.isArray(info.files) ? info.files : [];
  if (!files.length) fail('no files to check');
  for (const f of files) {
    const match = signed.files.find((s) => s.url === f.url);
    if (!match) fail(`${f.url} is not in the signed manifest`);
    if (!f.sha512 || match.sha512 !== f.sha512) fail(`${f.url} does not match the signed sha512`);
  }
  return signed;
}

/** Where a release's manifest lives: https://github.com/<repo>/releases/download/<tag>/<name>. */
function releaseAssetUrl(repo, tag, name) {
  return `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
}

module.exports = { MAX_MANIFEST_BYTES, manifestName, parseManifest, signManifest, verifyUpdateInfo, releaseAssetUrl };
