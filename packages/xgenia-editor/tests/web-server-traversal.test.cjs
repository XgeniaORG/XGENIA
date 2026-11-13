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
  // A cloned or imported project can carry symlinks (git creates them): they must not lead out.
  fs.symlinkSync(path.join(root, 'secret.txt'), path.join(projectDir, 'assets/linked-secret.txt'));
  fs.symlinkSync(root, path.join(projectDir, 'assets/linked-dir'));
  fs.writeFileSync(path.join(projectDir, 'assets/real.txt'), 'inside');
  fs.symlinkSync(path.join(projectDir, 'assets/real.txt'), path.join(projectDir, 'assets/alias.txt'));

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

for (const p of ['/assets/linked-secret.txt', '/assets/linked-dir/secret.txt']) {
  test(`does not follow a project symlink out of the project: ${p}`, async () => {
    const r = await get(p);
    assert.notEqual(r.status, 200);
    assert.doesNotMatch(r.body, /TOP SECRET/);
  });
}

test('a symlink that stays inside the project still serves', async () => {
  const r = await get('/assets/alias.txt');
  assert.equal(r.status, 200);
  assert.equal(r.body, 'inside');
});

// The preview relay (WebSocket on the same port).
const WebSocket = require('ws');
function openWs(origin) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, origin === undefined ? {} : { headers: { Origin: origin } });
    ws.once('open', () => resolve({ ws, ok: true }));
    ws.once('error', () => resolve({ ws, ok: false }));
    ws.once('unexpected-response', () => resolve({ ws, ok: false }));
  });
}

for (const origin of ['https://example.com', 'null', 'http://example.com:' + 8574]) {
  test(`the relay refuses a page from ${origin}`, async () => {
    const { ws, ok } = await openWs(origin);
    assert.equal(ok, false);
    ws.terminate();
  });
}

test('the relay accepts our own pages, and an unregistered socket reaches nobody', async () => {
  const viewer = await openWs(`http://localhost:${port}`);
  assert.equal(viewer.ok, true);
  viewer.ws.send(JSON.stringify({ cmd: 'register', type: 'viewer', clientId: 'v1' }));
  const got = [];
  viewer.ws.on('message', (m) => got.push(String(m)));
  const stranger = await openWs(undefined);
  assert.equal(stranger.ok, true);
  stranger.ws.send(JSON.stringify({ cmd: 'refresh' }));
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(got.filter((m) => m.includes('refresh')), []);
  viewer.ws.close();
  stranger.ws.close();
});
