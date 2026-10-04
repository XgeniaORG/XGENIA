// Shared fixtures for the live-engine tests: a key pair, a minimal engine pack, its manifest.
const crypto = require('crypto');
const { sha256 } = require('../../src/main/src/live-engine/manifest');

function keys() {
  return crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
}

function packFiles(extra = {}) {
  return {
    'viewer/index.html': '<html>live</html>',
    'viewer/xgenia.viewer.js': 'LIVE VIEWER',
    'deploy/index.json': '[]',
    'deploy/xgenia.deploy.js': 'LIVE DEPLOY',
    'compiler/xgenia.rgs-compiler.js': 'module.exports = { CloudFunctionConverter: function LiveCompiler() {} };',
    ...extra
  };
}

function makeManifest(files, over = {}) {
  const version = over.version || '20261003.1200-aaaaaaaa-bbbbbbbb';
  return {
    format: 1,
    version,
    channel: 'beta',
    issuedAt: '2026-10-03T12:00:00.000Z',
    minShell: 1,
    sources: { outer: 'a', private: 'b' },
    filesBase: `https://cdn.example/engine/${version}/files/`,
    files: Object.entries(files).map(([path, body]) => ({
      path,
      sha256: sha256(Buffer.from(body)),
      size: Buffer.byteLength(body)
    })),
    ...over
  };
}

const zlib = require('zlib');
const { signManifest } = require('../../src/main/src/live-engine/manifest');

/** A channel manifest + gzipped files served from memory, as the Supabase bucket serves them. */
function fakeCdn({ version = 'v2', channel = 'beta', issuedAt = '2026-10-03T12:00:00.000Z', minShell = 1, files = packFiles(), signKey, corrupt, cdn = 'https://cdn.example/engine' } = {}) {
  const m = makeManifest(files, { version, channel, issuedAt, minShell, filesBase: `${cdn}/${version}/files/` });
  const raw = Buffer.from(JSON.stringify(m));
  const objects = new Map([
    [`${cdn}/channels/${channel}/manifest.json`, raw],
    [`${cdn}/channels/${channel}/manifest.sig`, Buffer.from(signManifest(raw, signKey))]
  ]);
  for (const [p, body] of Object.entries(files)) {
    objects.set(`${cdn}/${version}/files/${p}.gz`, zlib.gzipSync(Buffer.from(corrupt === p ? 'CORRUPT' : body)));
  }
  const fetched = [];
  const fetchBytes = async (url) => {
    fetched.push(url);
    if (!objects.has(url)) throw new Error('404 ' + url);
    return objects.get(url);
  };
  return { m, fetchBytes, fetched };
}

module.exports = { keys, packFiles, makeManifest, fakeCdn };
