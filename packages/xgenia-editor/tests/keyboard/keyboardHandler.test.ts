import { test } from 'node:test';
import assert from 'node:assert/strict';

// KeyboardHandler builds its singleton at import time and listens on `document`; give it one.
type Listener = (e: any) => void;
const listeners: Record<string, Listener[]> = {};
const body = el('BODY');
const fakeDocument: any = {
  body,
  activeElement: body,
  addEventListener: (type: string, fn: Listener) => (listeners[type] ||= []).push(fn),
  removeEventListener: () => undefined
};
(globalThis as any).document = fakeDocument;

function el(tagName: string, attrs: Record<string, string> = {}, extra: Record<string, unknown> = {}) {
  return { tagName, getAttribute: (n: string) => (n in attrs ? attrs[n] : null), isContentEditable: false, ...extra };
}

function press(key: string, mods: Partial<KeyboardEvent> = {}) {
  const e = { key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, repeat: false, ...mods };
  for (const fn of listeners.keydown || []) fn(e);
}

const load = async () => {
  const mod = await import('../../src/editor/src/utils/keyboardhandler');
  const { KeyMod, KeyCode } = await import('../../src/editor/src/utils/keyboard/KeyCode');
  return { mod, KeyMod, KeyCode };
};

test('only text editing counts as typing', async () => {
  const { mod } = await load();
  const { isTypingTarget } = mod;
  assert.equal(isTypingTarget(el('INPUT') as any), true);
  assert.equal(isTypingTarget(el('INPUT', {}, { type: 'number' }) as any), true);
  assert.equal(isTypingTarget(el('TEXTAREA') as any), true);
  assert.equal(isTypingTarget(el('DIV', {}, { isContentEditable: true }) as any), true);
  assert.equal(isTypingTarget(el('DIV', { role: 'textbox' }) as any), true);
  // The ones that used to swallow Cmd+Z: a focused button (the Edit/Preview toggle) and the
  // preview frame.
  assert.equal(isTypingTarget(el('BUTTON') as any), false);
  assert.equal(isTypingTarget(el('IFRAME') as any), false);
  assert.equal(isTypingTarget(el('INPUT', {}, { type: 'checkbox' }) as any), false);
  assert.equal(isTypingTarget(null), false);
});

test('Cmd+Z runs undo while a button has focus, but not while typing', async () => {
  const { mod, KeyMod, KeyCode } = await load();
  const handler = mod.default.instance;
  let undos = 0;
  const cmd = { handler: () => undos++, keybinding: KeyMod.CtrlCmd | KeyCode.KEY_Z };
  handler.registerCommands([cmd]);
  try {
    fakeDocument.activeElement = el('BUTTON');
    press('z', { metaKey: true });
    assert.equal(undos, 1);

    fakeDocument.activeElement = el('INPUT');
    press('z', { metaKey: true });
    assert.equal(undos, 1);
  } finally {
    fakeDocument.activeElement = body;
    handler.deregisterCommands([cmd]);
  }
});

test('Enter on a focused button activates the button, not an editor command', async () => {
  const { mod, KeyCode } = await load();
  const handler = mod.default.instance;
  let ran = 0;
  const cmd = { handler: () => ran++, keybinding: KeyCode.Enter };
  handler.registerCommands([cmd]);
  try {
    fakeDocument.activeElement = el('BUTTON');
    press('Enter');
    assert.equal(ran, 0);
    fakeDocument.activeElement = body;
    press('Enter');
    assert.equal(ran, 1);
  } finally {
    fakeDocument.activeElement = body;
    handler.deregisterCommands([cmd]);
  }
});

test('a key forwarded from the preview runs the command and says so', async () => {
  const { mod, KeyMod, KeyCode } = await load();
  const handler = mod.default.instance;
  let redos = 0;
  const cmd = { handler: () => redos++, keybinding: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_Z };
  handler.registerCommands([cmd]);
  try {
    const evt = { key: 'z', metaKey: true, ctrlKey: false, shiftKey: true, altKey: false };
    assert.equal(handler.executeCommandMatchingKeyEvent(evt, 'down', 'viewport'), true);
    assert.equal(redos, 1);
    assert.equal(handler.executeCommandMatchingKeyEvent({ ...evt, key: 'q' }, 'down', 'viewport'), false);
  } finally {
    handler.deregisterCommands([cmd]);
  }
});

test('the Edit-menu accelerator of the same press does not undo twice', async () => {
  const { mod, KeyMod, KeyCode } = await load();
  const handler = mod.default.instance as any;
  let undos = 0;
  const code = KeyMod.CtrlCmd | KeyCode.KEY_Z;
  const cmd = { handler: () => undos++, keybinding: code };
  handler.registerCommands([cmd]);
  try {
    press('z', { metaKey: true }); // the page's keydown
    handler.runCommand(code, 'down', 'menu'); // Electron's menu accelerator for the same press
    assert.equal(undos, 1);

    // Two real presses from the keyboard are two undos.
    press('z', { metaKey: true });
    assert.equal(undos, 2);
  } finally {
    handler.deregisterCommands([cmd]);
  }
});

test('a menu zoom goes to the first view that claims it, else to the UI', async () => {
  const { mod } = await load();
  const handler = mod.default.instance;
  assert.equal(handler.claimMenuZoom('zoomIn'), false); // nobody claims: the UI zooms

  const seen: string[] = [];
  let previewFocused = false;
  const release = handler.addMenuZoomClaimant((command) => {
    if (!previewFocused) return false;
    seen.push(command);
    return true;
  });
  assert.equal(handler.claimMenuZoom('zoomIn'), false);
  previewFocused = true;
  assert.equal(handler.claimMenuZoom('zoomOut'), true);
  assert.equal(handler.claimMenuZoom('zoomReset'), true);
  assert.deepEqual(seen, ['zoomOut', 'zoomReset']);

  release();
  assert.equal(handler.claimMenuZoom('zoomIn'), false); // a disposed view stops claiming
});
