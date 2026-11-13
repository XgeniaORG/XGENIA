// "The AI finished" notifications: shown only while XGENIA is in the background.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';

const ipcHandlers: Record<string, () => void> = {};
const realLoad = (Module as any)._load;
(Module as any)._load = function (request: string, ...rest: unknown[]) {
  if (request === 'electron') return { ipcRenderer: { on: (ch: string, fn: () => void) => (ipcHandlers[ch] = fn) } };
  if (request === '@electron/remote') return { getCurrentWindow: () => ({ show() {}, focus() {}, isMinimized: () => false, restore() {} }) };
  return realLoad.call(this, request, ...rest);
};

const shown: string[] = [];
let docFocused = false;
const g = globalThis as any;
g.window = { process: { type: 'renderer' }, addEventListener() {} };
g.document = { hasFocus: () => docFocused };
g.Notification = class {
  static permission = 'granted';
  static requestPermission = async () => 'granted';
  onclick: any;
  constructor(title: string, opts: any) { shown.push(`${title}: ${opts.body}`); }
  close() {}
};

test('notifies only when the window is in the background and no frame of ours has focus', async () => {
  // require, not import: the ESM loader would skip the 'electron' stub above.
  const { desktopNotificationService: svc } = require('../../src/editor/src/utils/DesktopNotificationService');

  ipcHandlers['app-focused']?.();
  assert.equal(svc.notifyAITaskComplete('done'), false, 'window focused: nothing');

  ipcHandlers['app-blurred']?.();
  docFocused = true; // e.g. the user is typing in the chat iframe
  assert.equal(svc.notifyAITaskComplete('done'), false, 'focus inside one of our frames: nothing');

  docFocused = false;
  assert.equal(svc.notifyAITaskComplete('done'), true, 'in the background: shown');
  assert.equal(svc.notifyAIError('model busy'), true);
  assert.equal(shown.length, 2);
  assert.match(shown[0], /done/);
});
