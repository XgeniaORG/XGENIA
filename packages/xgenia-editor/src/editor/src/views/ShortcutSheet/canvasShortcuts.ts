/**
 * Keys and gestures the preview frame handles itself in Edit mode (assets/webview-preload-viewer.js,
 * its mousedown / keydown / wheel handlers). They never pass through KeyboardHandler, so they are
 * written down here; change this list with those handlers. Undo/redo and ⌘+/−/0 are menu items and
 * are listed from the menu.
 */
export interface CanvasShortcut {
  group: string;
  action: string;
  /** An Electron accelerator, formatted per platform; otherwise the literal mac/other text. */
  accelerator?: string;
  mac?: string;
  other?: string;
}

const GROUP = 'Edit mode canvas';

export const CANVAS_SHORTCUTS: CanvasShortcut[] = [
  { group: GROUP, action: 'Select the topmost node', mac: 'Click', other: 'Click' },
  { group: GROUP, action: 'Select the node underneath (repeat to go deeper)', mac: '⌥-click', other: 'Alt-click' },
  { group: GROUP, action: 'Add to / remove from the selection', mac: '⇧-click', other: 'Shift-click' },
  { group: GROUP, action: 'Box select', mac: '⌘-drag', other: 'Ctrl-drag' },
  { group: GROUP, action: 'Move · drag a layout child to reorder it', mac: 'Drag', other: 'Drag' },
  { group: GROUP, action: 'While dragging: lock to one axis · keep aspect · snap 15°', mac: '⇧', other: 'Shift' },
  { group: GROUP, action: 'While dragging: place freely (no smart guides)', mac: '⌘', other: 'Ctrl' },
  { group: GROUP, action: 'Nudge 1 px · with ⇧ 10 px', mac: '← ↑ → ↓', other: '← ↑ → ↓' },
  { group: GROUP, action: 'Duplicate', accelerator: 'CmdOrCtrl+D' },
  { group: GROUP, action: 'Copy · paste · cut', mac: '⌘C · ⌘V · ⌘X', other: 'Ctrl+C · Ctrl+V · Ctrl+X' },
  { group: GROUP, action: 'Delete', mac: '⌫', other: 'Delete' },
  { group: GROUP, action: 'Select the siblings', accelerator: 'CmdOrCtrl+A' },
  { group: GROUP, action: 'Bring to front', accelerator: 'Shift+CmdOrCtrl+]' },
  { group: GROUP, action: 'Send to back', accelerator: 'Shift+CmdOrCtrl+[' },
  { group: GROUP, action: 'Pan the zoomed preview', mac: 'Space-drag', other: 'Space-drag' },
  { group: GROUP, action: 'Zoom toward the pointer', mac: '⌘-scroll', other: 'Ctrl-scroll' },
  { group: GROUP, action: 'Frame the selection (or the whole game), from anywhere', mac: 'F', other: 'F' },
  { group: GROUP, action: 'Deselect', mac: 'Esc', other: 'Esc' },
  { group: GROUP, action: 'Node menu: select, add to chat, arrange', mac: 'Right-click', other: 'Right-click' },
  { group: GROUP, action: 'Add the node to the chat', mac: 'Double-click', other: 'Double-click' },
  { group: GROUP, action: 'This list (anywhere outside a text field; also Help menu)', mac: '?', other: '?' }
];
