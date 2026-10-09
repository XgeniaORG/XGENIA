/**
 * Rows for Help > Keyboard Shortcuts. The menu rows and the editor-command rows are read from the
 * live bindings (the application menu, and the commands registered with KeyboardHandler right
 * now), so they cannot drift from what the keys do. Only the Edit-mode canvas keys and mouse
 * gestures are a written list: the preview frame handles those itself
 * (assets/webview-preload-viewer.js) and keep this list in step with it.
 */

export interface ShortcutRow {
  keys: string;
  action: string;
  group: string;
}

/** The parts of an Electron MenuItem this reads. */
export interface MenuItemLike {
  label?: string;
  role?: string;
  accelerator?: string | null;
  visible?: boolean;
  type?: string;
  submenu?: { items: MenuItemLike[] } | null;
}

const MAC_MOD_ORDER = ['⌃', '⌥', '⇧', '⌘'];

const KEY_NAMES: Record<string, { mac: string; other: string }> = {
  plus: { mac: '+', other: '+' },
  enter: { mac: '↩', other: 'Enter' },
  return: { mac: '↩', other: 'Enter' },
  backspace: { mac: '⌫', other: 'Backspace' },
  delete: { mac: '⌦', other: 'Delete' },
  escape: { mac: 'Esc', other: 'Esc' },
  esc: { mac: 'Esc', other: 'Esc' },
  space: { mac: 'Space', other: 'Space' },
  tab: { mac: '⇥', other: 'Tab' },
  up: { mac: '↑', other: '↑' },
  down: { mac: '↓', other: '↓' },
  left: { mac: '←', other: '←' },
  right: { mac: '→', other: '→' },
  uparrow: { mac: '↑', other: '↑' },
  downarrow: { mac: '↓', other: '↓' },
  leftarrow: { mac: '←', other: '←' },
  rightarrow: { mac: '→', other: '→' },
  arrowup: { mac: '↑', other: '↑' },
  arrowdown: { mac: '↓', other: '↓' },
  arrowleft: { mac: '←', other: '←' },
  arrowright: { mac: '→', other: '→' }
};

/** KeyMod bits, as in utils/keyboard/KeyCode (kept here so this file stays free of imports). */
const MOD_CTRLCMD = 1 << 11;
const MOD_SHIFT = 1 << 10;
const MOD_ALT = 1 << 9;

/**
 * A KeyboardHandler keybinding as an accelerator string. `keyName` is KeyCodeUtils.toString of the
 * low byte. The handler treats ⌘ and Ctrl alike (CtrlCmd), so it reads as CmdOrCtrl.
 */
export function keybindingAccelerator(keybinding: number, keyName: string): string {
  const parts: string[] = [];
  if (keybinding & MOD_CTRLCMD) parts.push('CmdOrCtrl');
  if (keybinding & MOD_ALT) parts.push('Alt');
  if (keybinding & MOD_SHIFT) parts.push('Shift');
  parts.push(keyName);
  return parts.join('+');
}

/** 'CmdOrCtrl+Shift+Z' → '⇧⌘Z' on a Mac, 'Ctrl+Shift+Z' elsewhere. */
export function formatAccelerator(accelerator: string, isMac: boolean): string {
  const parts = accelerator.split('+');
  // 'CmdOrCtrl++' splits with an empty last part: that key is '+'.
  let key = parts.pop() || '+';
  const mods = new Set<string>();
  for (const raw of parts) {
    const p = raw.toLowerCase();
    if (p === 'cmdorctrl' || p === 'commandorcontrol') mods.add(isMac ? '⌘' : 'Ctrl');
    else if (p === 'cmd' || p === 'command' || p === 'super' || p === 'meta') mods.add(isMac ? '⌘' : 'Win');
    else if (p === 'ctrl' || p === 'control') mods.add(isMac ? '⌃' : 'Ctrl');
    else if (p === 'alt' || p === 'option' || p === 'altgr') mods.add(isMac ? '⌥' : 'Alt');
    else if (p === 'shift') mods.add(isMac ? '⇧' : 'Shift');
  }
  const named = KEY_NAMES[key.toLowerCase()];
  key = named ? (isMac ? named.mac : named.other) : key.length === 1 ? key.toUpperCase() : key;
  if (isMac) return MAC_MOD_ORDER.filter((m) => mods.has(m)).join('') + key;
  return [...['Ctrl', 'Win', 'Alt', 'Shift'].filter((m) => mods.has(m)), key].join('+');
}

/** Accelerators Electron gives a role when the template names none. */
const ROLE_ACCELERATORS: Record<string, string> = {
  undo: 'CmdOrCtrl+Z',
  redo: 'Shift+CmdOrCtrl+Z',
  cut: 'CmdOrCtrl+X',
  copy: 'CmdOrCtrl+C',
  paste: 'CmdOrCtrl+V',
  pasteandmatchstyle: 'Shift+Alt+CmdOrCtrl+V',
  selectall: 'CmdOrCtrl+A',
  minimize: 'CmdOrCtrl+M',
  close: 'CmdOrCtrl+W',
  quit: 'CmdOrCtrl+Q',
  hide: 'Cmd+H',
  hideothers: 'Alt+Cmd+H',
  reload: 'CmdOrCtrl+R',
  forcereload: 'Shift+CmdOrCtrl+R',
  toggledevtools: 'Alt+CmdOrCtrl+I',
  togglefullscreen: 'Ctrl+Cmd+F',
  resetzoom: 'CmdOrCtrl+0',
  zoomin: 'CmdOrCtrl+Plus',
  zoomout: 'CmdOrCtrl+-'
};

const ROLE_LABELS: Record<string, string> = {
  undo: 'Undo',
  redo: 'Redo',
  cut: 'Cut',
  copy: 'Copy',
  paste: 'Paste',
  pasteandmatchstyle: 'Paste and Match Style',
  selectall: 'Select All',
  minimize: 'Minimize',
  close: 'Close Window',
  quit: 'Quit',
  hide: 'Hide',
  hideothers: 'Hide Others',
  reload: 'Reload',
  forcereload: 'Force Reload',
  toggledevtools: 'Toggle Developer Tools',
  togglefullscreen: 'Toggle Full Screen',
  resetzoom: 'Actual Size',
  zoomin: 'Zoom In',
  zoomout: 'Zoom Out'
};

/** Every visible menu item that has a key, grouped by its top-level menu. */
export function menuRows(topItems: MenuItemLike[], isMac: boolean): ShortcutRow[] {
  const rows: ShortcutRow[] = [];
  const walk = (items: MenuItemLike[], group: string) => {
    for (const item of items) {
      if (!item || item.visible === false || item.type === 'separator') continue;
      if (item.submenu && item.submenu.items) {
        walk(item.submenu.items, group);
        continue;
      }
      const role = (item.role || '').toLowerCase();
      const accelerator = item.accelerator || ROLE_ACCELERATORS[role];
      if (!accelerator) continue;
      if (!isMac && (role === 'hide' || role === 'hideothers')) continue;
      const action = item.label || ROLE_LABELS[role] || role;
      rows.push({ keys: formatAccelerator(accelerator, isMac), action, group });
    }
  };
  for (const top of topItems) {
    if (!top || top.visible === false || !top.submenu) continue;
    walk(top.submenu.items, top.label || '');
  }
  return rows;
}

/** Rows for every titled editor command, minus keys the menu already lists. */
export function commandRows(
  commands: { keys: string; title: string; group: string }[],
  taken: ShortcutRow[]
): ShortcutRow[] {
  const takenKeys = new Set(taken.map((r) => r.keys));
  const seen = new Set<string>();
  const rows: ShortcutRow[] = [];
  for (const c of commands) {
    const id = c.keys + '|' + c.title;
    if (takenKeys.has(c.keys) || seen.has(id)) continue;
    seen.add(id);
    rows.push({ keys: c.keys, action: c.title, group: c.group });
  }
  return rows;
}

/** Case-insensitive match on the action, the group or the keys. */
export function filterRows(rows: ShortcutRow[], query: string): ShortcutRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => (r.action + ' ' + r.group + ' ' + r.keys).toLowerCase().includes(q));
}

/** Groups in first-seen order. */
export function groupRows(rows: ShortcutRow[]): { group: string; rows: ShortcutRow[] }[] {
  const out: { group: string; rows: ShortcutRow[] }[] = [];
  const index = new Map<string, number>();
  for (const r of rows) {
    if (!index.has(r.group)) {
      index.set(r.group, out.length);
      out.push({ group: r.group, rows: [] });
    }
    out[index.get(r.group)].rows.push(r);
  }
  return out;
}
