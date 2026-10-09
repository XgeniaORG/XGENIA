// (2026-10-08) On macOS electron-updater reports 'update-downloaded' when ITS download finishes; Squirrel.Mac
// then fetches the zip again, unzips and verifies it before it can install. The "restart now?" box came up at
// the first event, as an app-modal alert that held Squirrel back until it was answered; after "Quit" nothing
// visible happened, the user quit by hand mid-unzip, and the update was dropped.
// node --test packages/xgenia-editor/tests/updater/update-restart.test.cjs
const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { EventEmitter } = require('node:events');

const MODULE = require.resolve('../../src/main/src/autoupdater');
const noop = () => undefined;
const FEED = { version: '3.0.2', files: [{ url: 'XGENIA-3.0.2-mac-x64.zip' }, { url: 'XGENIA-3.0.2-mac-arm64.zip' }] };

function setup(platform, answers = []) {
  const seen = { boxes: [], errors: [], quitAndInstall: 0, downloads: 0 };
  const squirrel = new EventEmitter();
  const updater = new EventEmitter();
  updater.checkForUpdates = () => Promise.resolve();
  updater.downloadUpdate = () => {
    seen.downloads++;
    return Promise.resolve();
  };
  updater.quitAndInstall = () => seen.quitAndInstall++;
  const window = { isDestroyed: () => false, isVisible: () => true, setProgressBar: noop };
  const dialog = {
    showMessageBox(...args) {
      const [parent, box] = args.length > 1 ? args : [undefined, args[0]];
      seen.boxes.push({ parent, ...box });
      return Promise.resolve({ response: answers.length ? answers.shift() : 1 });
    },
    showErrorBox: (title, message) => seen.errors.push(`${title}: ${message}`)
  };
  const log = { info: noop, warn: noop, error: noop, transports: { file: {} } };
  const fakes = {
    electron: { autoUpdater: squirrel, dialog, ipcMain: { on: noop } },
    'electron-log/main': log,
    'electron-updater': { autoUpdater: updater }
  };

  const realLoad = Module._load;
  const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  Module._load = function (request, ...rest) {
    return request in fakes ? fakes[request] : realLoad.call(this, request, ...rest);
  };
  Object.defineProperty(process, 'platform', { value: platform });
  try {
    delete require.cache[MODULE];
    require(MODULE).setupAutoUpdate(window);
  } finally {
    Module._load = realLoad;
    Object.defineProperty(process, 'platform', realPlatform);
  }
  return { seen, squirrel, updater, window };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));
const readyBoxes = (seen) => seen.boxes.filter((b) => b.title === 'Update ready');

test.beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
test.afterEach(() => mock.timers.reset());

test('macOS: no restart prompt until Squirrel.Mac has the update staged; then Restart installs at once', async () => {
  const { seen, squirrel, updater } = setup('darwin', [0, 0]);
  updater.emit('update-available', FEED);
  await settle();
  assert.equal(seen.downloads, 1);

  updater.emit('update-downloaded', FEED);
  await settle();
  assert.equal(readyBoxes(seen).length, 0, 'electron-updater finishing its download is not "ready" on macOS');

  squirrel.emit('update-downloaded');
  await settle();
  assert.equal(readyBoxes(seen).length, 1);
  assert.equal(seen.quitAndInstall, 1);
});

test('the restart prompt is a sheet on the editor window, not an app-modal alert', async () => {
  const { seen, squirrel, updater, window } = setup('darwin', [0, 1]);
  updater.emit('update-available', FEED);
  await settle();
  updater.emit('update-downloaded', FEED);
  squirrel.emit('update-downloaded');
  await settle();
  assert.equal(readyBoxes(seen)[0].parent, window);
  assert.match(readyBoxes(seen)[0].message, /3\.0\.2/);
  assert.equal(seen.quitAndInstall, 0, 'Later does not quit');
});

test('Windows: the prompt follows electron-updater, whose download is the whole job there', async () => {
  const { seen, updater } = setup('win32', [0, 0]);
  updater.emit('update-available', { version: '3.0.2', files: [{ url: 'XGENIA-Setup-3.0.2.exe' }] });
  await settle();
  updater.emit('update-downloaded', { version: '3.0.2' });
  await settle();
  assert.equal(readyBoxes(seen).length, 1);
  assert.equal(seen.quitAndInstall, 1);
});

test('a Squirrel.Mac failure while staging is shown to the user, not only logged', async () => {
  const { seen, updater } = setup('darwin', [0]);
  updater.emit('update-available', FEED);
  await settle();
  updater.emit('update-downloaded', FEED);
  updater.emit('error', new Error('Code signature at URL did not pass validation'));
  await settle();
  assert.equal(seen.errors.length, 1);
  assert.match(seen.errors[0], /did not pass validation/);
  assert.equal(readyBoxes(seen).length, 0);
});
