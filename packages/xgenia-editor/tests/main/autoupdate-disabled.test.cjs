const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

test('with the updater off, the windows still get an answer: idle and disabled', async () => {
  const handlers = {};
  const fakes = {
    electron: { ipcMain: { handle: (ch, fn) => { if (handlers[ch]) throw new Error('second handler for ' + ch); handlers[ch] = fn; }, on() {} }, BrowserWindow: { getAllWindows: () => [] }, app: {} },
    'electron-log/main': { info() {}, warn() {}, error() {}, transports: { file: {} } },
    'electron-updater': { autoUpdater: { on() {} } }
  };
  const realLoad = Module._load;
  Module._load = function (request, ...rest) { return request in fakes ? fakes[request] : realLoad.call(this, request, ...rest); };
  try {
    const mod = require('../../src/main/src/autoupdater');
    mod.setupDisabledAutoUpdate();
    mod.setupDisabledAutoUpdate(); // a second window: no second registration
    for (const ch of ['auto-update:get-state', 'auto-update:check', 'auto-update:set-channel']) {
      const s = await handlers[ch]();
      assert.equal(s.enabled, false, ch);
      assert.equal(s.status, 'idle', ch);
    }
  } finally {
    Module._load = realLoad;
  }
});
