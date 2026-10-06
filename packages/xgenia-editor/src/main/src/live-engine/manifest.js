// Live engine manifest: what an engine pack contains, and the ed25519 check that our CI made it.
// Shared by the app (verify) and scripts/live-engine (sign). (2026-10-03)
'use strict';
const crypto = require('crypto');

const FORMAT = 1;
const CHANNELS = ['beta', 'stable'];
const ROOTS = ['viewer/', 'deploy/', 'compiler/'];
const REQUIRED = [
  'viewer/index.html',
  'viewer/xgenia.viewer.js',
  'deploy/index.json',
  'deploy/xgenia.deploy.js',
  'compiler/xgenia.rgs-compiler.js'
];

function fail(msg) {
  throw new Error('live-engine manifest: ' + msg);
}

function isSafePath(p) {
  return (
    typeof p === 'string' &&
    p.length > 0 &&
    p.length < 300 &&
    !p.startsWith('/') &&
    !p.includes('\\') &&
    !p.includes('\0') &&
    !p.split('/').some((seg) => seg === '' || seg === '.' || seg === '..') &&
    ROOTS.some((r) => p.startsWith(r))
  );
}

function validateManifest(m) {
  if (!m || typeof m !== 'object') fail('not an object');
  if (m.format !== FORMAT) fail('unknown format ' + m.format);
  if (typeof m.version !== 'string' || !/^[0-9A-Za-z][0-9A-Za-z.\-]{0,79}$/.test(m.version)) fail('bad version');
  if (!CHANNELS.includes(m.channel)) fail('bad channel');
  if (typeof m.issuedAt !== 'string' || Number.isNaN(Date.parse(m.issuedAt))) fail('bad issuedAt');
  if (!Number.isInteger(m.minShell) || m.minShell < 1) fail('bad minShell');
  if (typeof m.filesBase !== 'string' || !/^https:\/\/\S+\/$/.test(m.filesBase)) fail('bad filesBase');
  if (!Array.isArray(m.files) || m.files.length === 0) fail('no files');
  const seen = new Set();
  for (const f of m.files) {
    if (!f || !isSafePath(f.path)) fail('unsafe path ' + (f && f.path));
    if (seen.has(f.path)) fail('duplicate path ' + f.path);
    seen.add(f.path);
    if (typeof f.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(f.sha256)) fail('bad sha256 for ' + f.path);
    if (!Number.isInteger(f.size) || f.size < 0) fail('bad size for ' + f.path);
  }
  for (const r of REQUIRED) if (!seen.has(r)) fail('missing ' + r);
  return m;
}

/** The manifest, parsed, only if `sigB64` is our key's signature over exactly these bytes. */
function verifyManifest(raw, sigB64, publicKeyPem) {
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  let ok = false;
  try {
    ok = crypto.verify(null, bytes, publicKeyPem, Buffer.from(String(sigB64).trim(), 'base64'));
  } catch {
    ok = false;
  }
  if (!ok) fail('signature does not match');
  let m;
  try {
    m = JSON.parse(bytes.toString('utf8'));
  } catch {
    fail('not JSON');
  }
  return validateManifest(m);
}

function signManifest(raw, privateKeyPem) {
  return crypto.sign(null, Buffer.isBuffer(raw) ? raw : Buffer.from(raw), privateKeyPem).toString('base64');
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

module.exports = { FORMAT, CHANNELS, ROOTS, REQUIRED, isSafePath, validateManifest, verifyManifest, signManifest, sha256 };
