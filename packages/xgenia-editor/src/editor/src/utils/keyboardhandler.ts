import { KeyMod, KeyCode } from './keyboard/KeyCode';
import { KeyCodeUtils } from './keyboard/KeyCodeMapper';

/** Input types that take no typing, so editor shortcuts stay live while one has focus. */
const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file', 'image']);
const TYPING_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton']);
/** Roles whose arrow/Enter/Space keys drive the widget itself. */
const WIDGET_ROLES = new Set(['menu', 'menubar', 'menuitem', 'listbox', 'option', 'tab', 'tablist', 'radiogroup', 'slider', 'tree', 'treeitem', 'grid']);
const ACTIVATING_TAGS = new Set(['BUTTON', 'A', 'SUMMARY']);

/**
 * Is a keypress on this element text editing? Then editor shortcuts stand aside. Only
 * typing counts: the old check bailed on ANY focused element, so after clicking the
 * Edit/Preview toggle (a focused button) or the preview frame, Cmd+Z and Delete did nothing.
 */
export function isTypingTarget(el: Element | null | undefined): boolean {
  if (!el || !(el as HTMLElement).tagName) return false;
  const tag = (el as HTMLElement).tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !NON_TEXT_INPUTS.has(((el as HTMLInputElement).type || 'text').toLowerCase());
  if ((el as HTMLElement).isContentEditable) return true;
  const role = el.getAttribute && el.getAttribute('role');
  return !!role && TYPING_ROLES.has(role);
}

/** Keys a focused, non-text control handles itself: Enter/Space on a button, arrows in a menu. */
function keyBelongsToFocusedControl(el: Element | null, event: KeyboardEvent): boolean {
  if (!el || el === document.body) return false;
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  const key = event.key;
  const role = el.getAttribute && el.getAttribute('role');
  if ((key === 'Enter' || key === ' ') && (ACTIVATING_TAGS.has((el as HTMLElement).tagName) || role === 'button' || role === 'link' || role === 'checkbox')) {
    return true;
  }
  return !!role && WIDGET_ROLES.has(role) && /^(Arrow|Home|End|Enter| )/.test(key);
}

/** The element that really has focus, looking inside same-process frames (the preview, the chat). */
export function deepActiveElement(doc: Document = document): Element | null {
  let el: Element | null = doc.activeElement;
  for (let depth = 0; el && el.tagName === 'IFRAME' && depth < 4; depth++) {
    try {
      const inner = (el as HTMLIFrameElement).contentDocument;
      if (!inner) return el;
      el = inner.activeElement;
    } catch {
      return el; // unreachable frame: leave its keys alone
    }
  }
  return el;
}

/**
 * Undo and redo arrive two ways for one keypress: the page's keydown (here) and the Edit menu's
 * accelerator (main.js), which Electron fires for keys the page did not preventDefault. The
 * second arrival within this window is the same press, not a new one.
 */
const SAME_PRESS_MS = 400;

/** View > Zoom In / Zoom Out / Actual Size, as the menu reports them. */
export type MenuZoomCommand = 'zoomIn' | 'zoomOut' | 'zoomReset';

export interface KeyboardCommand {
  handler: () => void;
  keybinding: number; //e.g. KeyMod.CtrlCmd | KeyCode.KEY_V
  weight?: number;
  type?: 'up' | 'down'; //default is down
}

function getKeyMod(evt: KeyboardEvent): KeyMod {
  let modKey: KeyMod = 0;
  if (evt.metaKey || evt.ctrlKey) modKey |= KeyMod.CtrlCmd; // | KeyMod.WinCtrl
  if (evt.shiftKey) modKey |= KeyMod.Shift;
  if (evt.altKey) modKey |= KeyMod.Alt;
  return modKey;
}

type KeyEventHandler = (event: KeyboardEvent) => void;
type MouseEventHandler = (event: MouseEvent) => void;

export default class KeyboardHandler {
  static instance = new KeyboardHandler();

  commands: KeyboardCommand[];

  onKeyDown: KeyEventHandler;
  onKeyUp: KeyEventHandler;
  onMouseUp: MouseEventHandler;

  constructor() {
    this.commands = [];

    this.onKeyDown = (event) => {
      if (event.repeat) {
        return;
      }

      const code = getKeyMod(event) + KeyCodeUtils.fromString(event.key);

      const activeEl = document.activeElement;
      const isInputFocused = isTypingTarget(activeEl);

      if (code === KeyCode.Escape) {
        if (isInputFocused) {
          (activeEl as HTMLElement)?.blur?.();
          return;
        }
      }

      if (isInputFocused || keyBelongsToFocusedControl(activeEl, event)) {
        return;
      }

      this.executeCommandMatchingKeyEvent(event, 'down', 'keyboard');
    };

    this.onKeyUp = (event) => {
      if (event.repeat) {
        return;
      }

      const activeEl = document.activeElement;
      if (isTypingTarget(activeEl) || keyBelongsToFocusedControl(activeEl, event)) return;

      this.executeCommandMatchingKeyEvent(event, 'up');
    };

    this.onMouseUp = (event) => {
      switch (event.button) {
        case 0:
          // Left button
          break;
        case 1:
          // Middle button
          break;
        case 2:
          // Right button
          break;
        case 3:
          // Back button
          break;
        case 4:
          // Forward button
          break;
      }
    };

    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mouseup', this.onMouseUp);

    this.listenForMenuCommands();
  }

  /**
   * Edit > Undo / Redo. The menu used to carry the macOS-only `undo:` selector, which runs
   * Chromium's text undo: a no-op outside a text field, and dead on Windows and Linux. Now
   * main.js asks us, and we decide: text editing gets the native command back, everything
   * else is the editor's undo history.
   */
  private listenForMenuCommands() {
    let ipc: any = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      ipc = require('electron').ipcRenderer;
    } catch {
      return; // not in Electron (tests)
    }
    if (!ipc || typeof ipc.on !== 'function') return;
    ipc.on('editor-menu-command', (_event: unknown, args: { command: 'undo' | 'redo' | MenuZoomCommand }) => {
      const command = args && args.command;
      // ⌘+ / ⌘− / ⌘0 are menu accelerators, so the key never reaches the page: the preview
      // canvas claims them while it has focus in Edit mode, and otherwise they zoom the UI.
      if (command === 'zoomIn' || command === 'zoomOut' || command === 'zoomReset') {
        if (!this.claimMenuZoom(command)) ipc.send('editor-ui-zoom', command);
        return;
      }
      if (command !== 'undo' && command !== 'redo') return;
      if (isTypingTarget(deepActiveElement())) {
        ipc.send('editor-native-edit', command);
        return;
      }
      const code = command === 'redo' ? KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_Z : KeyMod.CtrlCmd | KeyCode.KEY_Z;
      if (!this.runCommand(code, 'down', 'menu')) ipc.send('editor-native-edit', command);
    });
  }

  private menuZoomClaimants = new Set<(command: MenuZoomCommand) => boolean>();

  /** Register a view that may take a menu zoom for itself; returns the unregister function. */
  addMenuZoomClaimant(claim: (command: MenuZoomCommand) => boolean): () => void {
    this.menuZoomClaimants.add(claim);
    return () => {
      this.menuZoomClaimants.delete(claim);
    };
  }

  /** True when some view took the zoom; false means it is the editor UI's. */
  claimMenuZoom(command: MenuZoomCommand): boolean {
    for (const claim of this.menuZoomClaimants) {
      if (claim(command)) return true;
    }
    return false;
  }

  dispose() {
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('mouseup', this.onMouseUp);
  }

  private lastRun: { code: number; source: string; at: number } | null = null;

  /**
   * Run the command for a key event. `source` says where the press came from: the editor's own
   * keydown, the preview frame (which forwards its keys, because focus lands inside it after any
   * click there), or the Edit menu. Returns whether a command ran.
   */
  executeCommandMatchingKeyEvent(
    event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>,
    type: 'down' | 'up',
    source: 'keyboard' | 'viewport' | 'menu' = 'keyboard'
  ): boolean {
    const code = getKeyMod(event as KeyboardEvent) + KeyCodeUtils.fromString(event.key);
    return this.runCommand(code, type, source);
  }

  private runCommand(code: number, type: 'up' | 'down', source: string): boolean {
    const command = this.findCommand(code, type);
    if (!command) return false;
    const now = Date.now();
    const last = this.lastRun;
    const menuEcho = last && last.source !== source && (last.source === 'menu' || source === 'menu');
    if (type === 'down' && menuEcho && last.code === code && now - last.at < SAME_PRESS_MS) {
      return true; // the menu accelerator and the keydown of one press — already ran
    }
    if (type === 'down') this.lastRun = { code, source, at: now };
    command.handler();
    return true;
  }

  private findCommand(code: number, type: 'up' | 'down') {
    const matchingCommands = this.commands.filter((c) => c.keybinding === code && (c.type || 'down') === type);

    if (matchingCommands.length === 0) {
      return null;
    }

    return matchingCommands.reduce((prev, curr) => (prev.weight < curr.weight ? prev : curr));
  }

  registerCommands(commands: KeyboardCommand[]) {
    commands.forEach((c) => this.commands.push(c));
  }

  deregisterCommands(commands: KeyboardCommand[]) {
    commands.forEach((c) => this.deregisterCommand(c));
  }

  private deregisterCommand(command: KeyboardCommand) {
    const index = this.commands.indexOf(command);
    if (index !== -1) {
      this.commands.splice(index, 1);
    } else {
      console.error("KeyboardHandler: Trying to deregister a command that's not registered");
    }
  }
}
