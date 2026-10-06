// Update channel (2026-10-06): Stable unless the user opts in to Beta; never a downgrade; a nightly
// downloaded before leaving Beta is not installed.
const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const AUTOUPDATER = path.resolve(__dirname, '../../src/main/src/autoupdater.js');

/** Loads autoupdater.js fresh, with electron, electron-updater and electron-log faked. */
function load({ settings } = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'xgenia-updates-'));
  if (settings) fs.writeFileSync(path.join(userData, 'update-settings.json'), JSON.stringify(settings));
  const handlers = {};
  const listeners = {};
  const updater = Object.assign(new EventEmitter(), {
    allowPrerelease: undefined,
    allowDowngrade: undefined,
    autoInstallOnAppQuit: undefined,
    checks: 0,
    checkForUpdates() {
      this.checks++;
      return Promise.resolve(null);
    },
    downloadUpdate: () => Promise.resolve(),
    quitAndInstall() {
      this.installed = true;
    }
  });
  const fakes = {
    electron: {
      app: { getPath: () => userData },
      BrowserWindow: { getAllWindows: () => [] },
      ipcMain: {
        handle: (name, fn) => (handlers[name] = fn),
        on: (name, fn) => (listeners[name] = fn)
      },
      net: { fetch: () => Promise.reject(new Error('offline')) }
    },
    'electron-updater': { autoUpdater: updater },
    'electron-log/main': { transports: { file: {} }, info() {}, warn() {}, error() {} }
  };
  const realLoad = Module._load;
  Module._load = function (request, ...rest) {
    return request in fakes ? fakes[request] : realLoad.call(this, request, ...rest);
  };
  try {
    delete require.cache[AUTOUPDATER];
    const { setupAutoUpdate } = require(AUTOUPDATER);
    setupAutoUpdate(null);
  } finally {
    Module._load = realLoad;
  }
  return { userData, handlers, listeners, updater, state: () => handlers['auto-update:get-state']() };
}

function withUpdatableInstall(fn) {
  return async () => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const appimage = process.env.APPIMAGE;
    process.env.APPIMAGE = '/tmp/XGENIA.AppImage'; // Linux CI: an install that can update itself
    try {
      await fn();
    } finally {
      if (appimage === undefined) delete process.env.APPIMAGE;
      else process.env.APPIMAGE = appimage;
      mock.timers.reset();
    }
  };
}

test(
  'Stable by default: no pre-releases and no downgrades',
  withUpdatableInstall(() => {
    const u = load();
    assert.equal(u.state().channel, 'stable');
    assert.equal(u.state().enabled, true);
    assert.equal(u.updater.allowPrerelease, false);
    assert.equal(u.updater.allowDowngrade, false);
  })
);

test(
  'opting in to Beta allows pre-releases, is saved, and checks straight away',
  withUpdatableInstall(async () => {
    const u = load();
    const before = u.updater.checks;
    await u.handlers['auto-update:set-channel'](null, 'beta');
    assert.equal(u.updater.allowPrerelease, true);
    assert.equal(u.updater.allowDowngrade, false);
    assert.equal(u.state().channel, 'beta');
    assert.equal(u.updater.checks, before + 1);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(u.userData, 'update-settings.json'), 'utf8')), { channel: 'beta' });
    // The next start reads it back.
    assert.equal(load({ settings: { channel: 'beta' } }).updater.allowPrerelease, true);
  })
);

test(
  'an unknown channel is refused and an unreadable settings file means Stable',
  withUpdatableInstall(() => {
    const u = load();
    assert.throws(() => u.handlers['auto-update:set-channel'](null, 'alpha'), /unknown update channel/);
    assert.equal(load({ settings: { channel: 'canary' } }).state().channel, 'stable');
  })
);

test(
  'leaving Beta drops a downloaded nightly instead of installing it on quit',
  withUpdatableInstall(async () => {
    const u = load({ settings: { channel: 'beta' } });
    u.updater.emit('update-downloaded', { version: '3.0.1-beta.9.nightly.202610070215' });
    assert.equal(u.state().status, 'ready');
    assert.equal(u.updater.autoInstallOnAppQuit, true);
    await u.handlers['auto-update:set-channel'](null, 'stable');
    assert.equal(u.state().status, 'idle');
    assert.equal(u.updater.autoInstallOnAppQuit, false);
    u.listeners['auto-update:install']();
    assert.equal(u.updater.installed, undefined);
  })
);

test(
  'on Stable, a nightly that finishes downloading is not offered',
  withUpdatableInstall(() => {
    const u = load();
    u.updater.emit('update-downloaded', { version: '3.0.1-beta.9.nightly.202610070215' });
    assert.equal(u.state().status, 'idle');
    assert.equal(u.updater.autoInstallOnAppQuit, false);
    u.updater.emit('update-downloaded', { version: '3.1.0' });
    assert.equal(u.state().status, 'ready');
    assert.equal(u.updater.autoInstallOnAppQuit, true);
  })
);

test(
  'an update that fails the signature check is never downloaded',
  withUpdatableInstall(async () => {
    const u = load();
    let downloaded = false;
    u.updater.downloadUpdate = () => {
      downloaded = true;
      return Promise.resolve();
    };
    u.updater.emit('update-available', { version: '3.1.0', files: [{ url: 'a.exe', sha512: 'x' }] });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    assert.equal(downloaded, false);
    assert.equal(u.state().status, 'idle');
    assert.equal(u.state().lastCheck.result, 'error');
  })
);
