// The preview web server listens on the LAN (the viewer shows a LAN URL for phones) and builds
// every file path by concatenating the URL onto a base directory. A ".." segment, plain or
// percent-encoded, used to read files outside the app and the open project. (2026-09-24)
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');

const SERVER = path.resolve(__dirname, '../src/main/src/web-server.js');

let child;
let port;
let root;

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

function get(p) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'xgenia-ws-'));
  const appDir = path.join(root, 'app');
  const projectDir = path.join(root, 'project');
  fs.mkdirSync(path.join(appDir, 'src/external/viewer'), { recursive: true });
  fs.mkdirSync(path.join(projectDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'assets/logo.txt'), 'project asset');
  fs.writeFileSync(path.join(root, 'secret.txt'), 'TOP SECRET');

  port = await freePort();
  // The server's helpers pull in Electron modules at load time; stub them so it runs under node.
  const script = `
    const Module = require('module');
    const load = Module._load;
    Module._load = function (request, ...rest) {
      if (request === 'electron' || request === '@electron/remote') return { app: { getPath: () => ${JSON.stringify(root)} } };
      return load.call(this, request, ...rest);
    };
    const startServer = require(${JSON.stringify(SERVER)});
    const app = { getAppPath: () => ${JSON.stringify(appDir)}, on() {}, quit() {} };
    startServer(app, (cb) => cb && cb({}), (cb) => cb({ projectDirectory: ${JSON.stringify(projectDir)} }), () => '');
  `;
  child = spawn(process.execPath, ['-e', script], { env: { ...process.env, XGENIAPORT: String(port) }, stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; i < 100; i++) {
    try {
      await get('/assets/logo.txt');
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw new Error('web server did not start');
});

after(() => {
  child?.kill();
  fs.rmSync(root, { recursive: true, force: true });
});

test('a normal project file is still served', async () => {
  const r = await get('/assets/logo.txt');
  assert.equal(r.status, 200);
  assert.equal(r.body, 'project asset');
});

for (const p of [
  '/../secret.txt',
  '/assets/../../secret.txt',
  '/%2e%2e/secret.txt',
  '/%2E%2E/%2E%2E/secret.txt',
  '/%252e%252e/secret.txt',
  '/packages/..%2f..%2fsecret.txt',
  '/external/canvas/../../../secret.txt',
  '/xgenia_modules/%2e%2e/%2e%2e/secret.txt'
]) {
  test(`refuses ${p}`, async () => {
    const r = await get(p);
    assert.equal(r.status, 403);
    assert.doesNotMatch(r.body, /TOP SECRET/);
  });
}
