// Live engine (2026-10-03): the preview server reads viewer files from the engine this run chose.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');

const SERVER = path.resolve(__dirname, '../../src/main/src/web-server.js');
const children = [];
after(() => children.forEach((c) => c.kill()));

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });

function get(port, p) {
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

async function startServer(engineRoot, liveInfo) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xgenia-ws-engine-'));
  const appDir = path.join(root, 'app');
  const projectDir = path.join(root, 'project');
  fs.mkdirSync(path.join(appDir, 'src/external/viewer'), { recursive: true });
  fs.writeFileSync(path.join(appDir, 'src/external/viewer/xgenia.viewer.js'), 'BUILTIN VIEWER');
  fs.writeFileSync(path.join(appDir, 'src/external/viewer/xgenia.683.js'), 'BUILTIN CHUNK');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(root, 'secret.txt'), 'TOP SECRET');
  const port = await freePort();
  const script = `
    const Module = require('module');
    const load = Module._load;
    Module._load = function (request, ...rest) {
      if (request === 'electron' || request === '@electron/remote') return { app: { getPath: () => ${JSON.stringify(root)} } };
      return load.call(this, request, ...rest);
    };
    ${liveInfo ? `global.xgeniaLiveEngine = ${JSON.stringify(liveInfo)};` : ''}
    const startServer = require(${JSON.stringify(SERVER)});
    const app = { getAppPath: () => ${JSON.stringify(appDir)}, on() {}, quit() {}, emit(name) { process.stdout.write('EVENT ' + name + '\\n'); } };
    startServer(app, (cb) => cb && cb({}), (cb) => cb({ projectDirectory: ${JSON.stringify(projectDir)} }), () => '');
  `;
  const env = { ...process.env, XGENIAPORT: String(port) };
  delete env.XGENIA_ENGINE_ROOT;
  if (engineRoot) env.XGENIA_ENGINE_ROOT = engineRoot;
  const child = spawn(process.execPath, ['-e', script], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  children.push(child);
  let out = '';
  child.stdout.on('data', (c) => (out += c));
  for (let i = 0; i < 100; i++) {
    try {
      await get(port, '/xgenia.683.js');
      return { port, events: () => out };
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw new Error('web server did not start');
}

test("with no engine chosen, the app's own viewer files are served", async () => {
  const s = await startServer(null);
  assert.equal((await get(s.port, '/xgenia.viewer.js')).body, 'BUILTIN VIEWER');
});

test('with a live engine chosen, its viewer files are served and the bundle request is announced', async () => {
  const engine = fs.mkdtempSync(path.join(os.tmpdir(), 'xgenia-live-'));
  fs.mkdirSync(path.join(engine, 'viewer'), { recursive: true });
  fs.writeFileSync(path.join(engine, 'viewer/xgenia.viewer.js'), 'LIVE VIEWER');
  fs.writeFileSync(path.join(engine, 'viewer/xgenia.683.js'), 'LIVE CHUNK');
  const s = await startServer(engine);
  assert.equal((await get(s.port, '/xgenia.viewer.js')).body, 'LIVE VIEWER');
  assert.equal((await get(s.port, '/xgenia.683.js')).body, 'LIVE CHUNK');
  await new Promise((r) => setTimeout(r, 50));
  assert.match(s.events(), /EVENT xgenia:preview-requested/);
  assert.notEqual((await get(s.port, '/../secret.txt')).body, 'TOP SECRET');
});

// ── 2026-10-04: deferred review minors ──
function liveEngineDir(files) {
  const engine = fs.mkdtempSync(path.join(os.tmpdir(), 'xgenia-live-'));
  const stats = {};
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(engine, rel)), { recursive: true });
    fs.writeFileSync(path.join(engine, rel), body);
    const st = fs.statSync(path.join(engine, rel));
    stats[rel] = { size: st.size, mtimeMs: st.mtimeMs };
  }
  return { engine, info: { source: 'live', version: 'v1', root: engine, builtinRoot: '/x', files: stats } };
}

test('asking for the preview page starts the health check, even if it never loads the bundle', async () => {
  const { engine, info } = liveEngineDir({ 'viewer/index.html': '<html>broken</html>', 'viewer/xgenia.viewer.js': 'LIVE', 'viewer/xgenia.683.js': 'C' });
  const s = await startServer(engine, info);
  await get(s.port, '/');
  await new Promise((r) => setTimeout(r, 50));
  assert.match(s.events(), /EVENT xgenia:preview-requested/);
});

test('a live engine file changed on disk after start, or not in its manifest, is not served', async () => {
  const { engine, info } = liveEngineDir({ 'viewer/xgenia.viewer.js': 'LIVE', 'viewer/xgenia.683.js': 'C' });
  const s = await startServer(engine, info);
  assert.equal((await get(s.port, '/xgenia.viewer.js')).body, 'LIVE');
  fs.writeFileSync(path.join(engine, 'viewer/xgenia.viewer.js'), 'TAMPERED AFTER START');
  assert.notEqual((await get(s.port, '/xgenia.viewer.js')).body, 'TAMPERED AFTER START');
  fs.writeFileSync(path.join(engine, 'viewer/planted.js'), 'PLANTED');
  assert.notEqual((await get(s.port, '/planted.js')).body, 'PLANTED');
});
