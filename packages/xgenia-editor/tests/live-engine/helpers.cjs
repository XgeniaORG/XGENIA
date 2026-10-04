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

module.exports = { keys, packFiles, makeManifest };
