// (2026-10-08) On macOS electron-updater reports 'update-downloaded' when ITS download finishes; Squirrel.Mac
// then fetches the zip again, unzips and verifies it before it can install. The "restart now?" box came up at
// the first event, as an app-modal alert that held Squirrel back until it was answered; after "Quit" nothing
// visible happened, the user quit by hand mid-unzip, and the update was dropped.
// (2026-10-15) Native dialogs are gone: the updater broadcasts its state and the editor asks in-app
// (BaseWindow.tsx). These pin the same behaviour through that state.
// node --test packages/xgenia-editor/tests/updater/update-restart.test.cjs
const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { EventEmitter } = require('node:events');

const MODULE = require.resolve('../../src/main/src/autoupdater');
const noop = () => undefined;
const FEED = { version: '3.0.2', files: [{ url: 'XGENIA-3.0.2-mac-x64.zip' }, { url: 'XGENIA-3.0.2-mac-arm64.zip' }] };

function setup(platform) {
  const seen = { boxes: 0, quitAndInstall: 0, downloads: 0 };
  const handlers = {};
  const listeners = {};
  const squirrel = new EventEmitter();
  const updater = Object.assign(new EventEmitter(), {
    checkForUpdates: () => Promise.resolve(),
    downloadUpdate() {
      seen.downloads++;
      return Promise.resolve();
    },
    quitAndInstall: () => seen.quitAndInstall++
  });
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'xgenia-restart-'));
  const fakes = {
    electron: {
      app: { getPath: () => userData },
      autoUpdater: squirrel,
      BrowserWindow: { getAllWindows: () => [] },
      // Any native box is a failure of this test: the editor asks in-app now.
      dialog: { showMessageBox: () => (seen.boxes++, Promise.resolve({ response: 1 })), showErrorBox: () => seen.boxes++ },
      ipcMain: { handle: (name, fn) => (handlers[name] = fn), on: (name, fn) => (listeners[name] = fn) },
      net: { fetch: () => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) }) }
    },
    'electron-log/main': { info: noop, warn: noop, error: noop, transports: { file: {} } },
    'electron-updater': { autoUpdater: updater },
    // These tests are about what happens after the signature check, which update-manifest.test.cjs covers.
    './update-manifest': { MAX_MANIFEST_BYTES: 1, manifestName: () => 'latest.yml', releaseAssetUrl: () => '', verifyUpdateInfo: noop }
  };

  const realLoad = Module._load;
  const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  Module._load = function (request, ...rest) {
    return request in fakes ? fakes[request] : realLoad.call(this, request, ...rest);
  };
  Object.defineProperty(process, 'platform', { value: platform });
  try {
    delete require.cache[MODULE];
    require(MODULE).setupAutoUpdate({ isDestroyed: () => false, setProgressBar: noop });
  } finally {
    Module._load = realLoad;
    Object.defineProperty(process, 'platform', realPlatform);
  }
  return { seen, squirrel, updater, state: () => handlers['auto-update:get-state'](), install: () => listeners['auto-update:install']() };
}

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
};

test.beforeEach(() => mock.timers.enable({ apis: ['setTimeout', 'setInterval'] }));
test.afterEach(() => mock.timers.reset());

test('macOS: not ready until Squirrel.Mac has the update staged; then Restart installs at once', async () => {
  const u = setup('darwin');
  u.updater.emit('update-available', FEED);
  await settle();
  assert.equal(u.seen.downloads, 1);

  u.updater.emit('update-downloaded', FEED);
  await settle();
  assert.equal(u.state().status, 'downloading', 'electron-updater finishing its download is not "ready" on macOS');
  u.install();
  assert.equal(u.seen.quitAndInstall, 0, 'Restart before Squirrel has it would drop the update');

  u.squirrel.emit('update-downloaded');
  await settle();
  assert.equal(u.state().status, 'ready');
  assert.equal(u.state().version, '3.0.2');
  u.install();
  assert.equal(u.seen.quitAndInstall, 1);
});

test('no native dialog is ever shown: the editor asks in-app from the broadcast state', async () => {
  const u = setup('darwin');
  u.updater.emit('update-available', FEED);
  await settle();
  u.updater.emit('update-downloaded', FEED);
  u.squirrel.emit('update-downloaded');
  await settle();
  assert.equal(u.state().status, 'ready');
  assert.equal(u.seen.boxes, 0);
  assert.equal(u.seen.quitAndInstall, 0, 'nothing installs until the user says Restart (or quits)');
});

test('Windows: ready as soon as electron-updater has downloaded, which is the whole job there', async () => {
  const u = setup('win32');
  u.updater.emit('update-available', { version: '3.0.2', files: [{ url: 'XGENIA-Setup-3.0.2.exe' }] });
  await settle();
  u.updater.emit('update-downloaded', { version: '3.0.2' });
  await settle();
  assert.equal(u.state().status, 'ready');
  u.install();
  assert.equal(u.seen.quitAndInstall, 1);
});

test('a Squirrel.Mac failure while staging is shown to the user, not only logged', async () => {
  for (const source of ['squirrel', 'updater']) {
    const u = setup('darwin');
    u.updater.emit('update-available', FEED);
    await settle();
    u.updater.emit('update-downloaded', FEED);
    (source === 'squirrel' ? u.squirrel : u.updater).emit('error', new Error('Code signature at URL did not pass validation'));
    await settle();
    const s = u.state();
    assert.equal(s.status, 'idle', `${source}: back to idle, so the next check retries`);
    assert.equal(s.failure.version, '3.0.2');
    assert.match(s.failure.message, /did not pass validation/);
    assert.equal(s.lastCheck.result, 'error');
    assert.equal(u.seen.boxes, 0, 'told in-app (BaseWindow), not with a native box');
  }
});

test('a failed background check is not shown as a failed update', async () => {
  const u = setup('darwin');
  u.updater.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'));
  await settle();
  assert.equal(u.state().failure, null);
});
