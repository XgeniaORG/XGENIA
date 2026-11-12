// A hidden offscreen capture window (src/main/src/offscreen-capture.js) registers with the editor
// like any preview. It must never be taken for "the game": the relay tags it and keeps its chatter
// out, and the editor never addresses evals or signals to it. (2026-11-12)
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const ts = require('typescript');
const WebSocket = require('ws');
const { CAPTURE_UA_TAG } = require('../../src/main/src/offscreen-capture');

const SERVER = path.resolve(__dirname, '../../src/main/src/web-server.js');
const VIEWER_CONNECTION = path.resolve(__dirname, '../../src/editor/src/ViewerConnection.ts');

/** The pure helpers of ViewerConnection.ts, lifted and run (the file itself needs the editor). */
function pureSelectors() {
  const src = fs.readFileSync(VIEWER_CONNECTION, 'utf8');
  const block = src.split('// PURE-SELECTORS:START')[1].split('// PURE-SELECTORS:END')[0];
  const js = ts.transpileModule(block, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const m = { exports: {} };
  new Function('module', 'exports', js)(m, m.exports);
  return m.exports;
}

test('the game viewer is the sole real browser client that is not a capture window', () => {
  const { gameViewerTarget } = pureSelectors();
  assert.equal(gameViewerTarget(['game', 'cap'], new Set(['cap'])), 'game');
  assert.equal(gameViewerTarget(['game'], new Set()), 'game');
  assert.equal(gameViewerTarget(['a', 'b'], new Set()), undefined);
  assert.equal(gameViewerTarget(['cap'], new Set(['cap'])), undefined);
});

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

function open(headers) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers });
    const got = [];
    ws.on('message', (m) => got.push(JSON.parse(String(m))));
    ws.on('open', () => resolve({ ws, got }));
    ws.on('error', reject);
  });
}

const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'xgenia-cap-'));
  const appDir = path.join(root, 'app');
  const projectDir = path.join(root, 'project');
  fs.mkdirSync(path.join(appDir, 'src/external/viewer'), { recursive: true });
  fs.mkdirSync(projectDir, { recursive: true });
  port = await freePort();
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
      const { ws } = await open({});
      ws.close();
      return;
    } catch {
      await settle(50);
    }
  }
  throw new Error('web server did not start');
});

after(() => {
  child?.kill();
  fs.rmSync(root, { recursive: true, force: true });
});

test('a capture viewer is announced as capture and may only fetch the project', async () => {
  const editor = await open({});
  editor.ws.send(JSON.stringify({ cmd: 'register', type: 'editor', clientId: 'ed' }));
  await settle();

  const cap = await open({ 'user-agent': `Mozilla/5.0 Electron/44.7.2 ${CAPTURE_UA_TAG}` });
  cap.ws.send(JSON.stringify({ cmd: 'register', type: 'viewer', clientId: 'cap' }));
  const game = await open({ 'user-agent': 'Mozilla/5.0 Electron/44.7.2' });
  game.ws.send(JSON.stringify({ cmd: 'register', type: 'viewer', clientId: 'game' }));
  await settle();

  const reg = editor.got.filter((m) => m.cmd === 'registered');
  assert.deepEqual(reg.find((m) => m.clientId === 'cap')?.capture, true);
  assert.equal(reg.find((m) => m.clientId === 'game')?.capture, undefined);

  cap.ws.send(JSON.stringify({ cmd: 'showwarning', type: 'viewer', clientId: 'cap', content: '{}' }));
  cap.ws.send(JSON.stringify({ cmd: 'runtimeEvalResult', type: 'viewer', clientId: 'cap', content: '{}' }));
  cap.ws.send(JSON.stringify({ cmd: 'nodelibrary', type: 'viewer', clientId: 'cap', content: '{}' }));
  game.ws.send(JSON.stringify({ cmd: 'showwarning', type: 'viewer', clientId: 'game', content: '{}' }));
  await settle();

  const fromCap = editor.got.filter((m) => m.clientId === 'cap' && m.cmd !== 'registered').map((m) => m.cmd);
  assert.deepEqual(fromCap, ['nodelibrary']);
  assert.ok(editor.got.some((m) => m.clientId === 'game' && m.cmd === 'showwarning'));

  // A message the editor addresses to the capture window still reaches it (the project export).
  editor.ws.send(JSON.stringify({ cmd: 'export', target: 'cap', content: '{}' }));
  await settle();
  assert.ok(cap.got.some((m) => m.cmd === 'export'));

  for (const s of [editor, cap, game]) s.ws.close();
});
