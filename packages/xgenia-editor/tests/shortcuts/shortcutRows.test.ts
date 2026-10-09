// Help > Keyboard Shortcuts reads the live menu and the registered editor commands; these are the
// pure pieces that turn them into rows. npx tsx --test packages/xgenia-editor/tests/shortcuts/shortcutRows.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  formatAccelerator,
  keybindingAccelerator,
  menuRows,
  commandRows,
  filterRows,
  groupRows
} from '../../src/editor/src/views/ShortcutSheet/shortcutRows';

test('accelerators read the Mac way on a Mac and spelled out elsewhere', () => {
  assert.equal(formatAccelerator('Shift+CmdOrCtrl+Z', true), '⇧⌘Z');
  assert.equal(formatAccelerator('Shift+CmdOrCtrl+Z', false), 'Ctrl+Shift+Z');
  assert.equal(formatAccelerator('CmdOrCtrl+Plus', true), '⌘+');
  assert.equal(formatAccelerator('CmdOrCtrl+/', true), '⌘/');
  assert.equal(formatAccelerator('Ctrl+Cmd+F', true), '⌃⌘F');
  assert.equal(formatAccelerator('Alt+CmdOrCtrl+I', false), 'Ctrl+Alt+I');
  assert.equal(formatAccelerator('CmdOrCtrl+Enter', true), '⌘↩');
});

test('an editor keybinding becomes the same accelerator text as a menu item', () => {
  const CTRLCMD = 1 << 11,
    SHIFT = 1 << 10,
    ALT = 1 << 9;
  assert.equal(formatAccelerator(keybindingAccelerator(CTRLCMD | 50, 'T'), true), '⌘T');
  assert.equal(formatAccelerator(keybindingAccelerator(CTRLCMD | SHIFT | 34, 'D'), true), '⇧⌘D');
  assert.equal(formatAccelerator(keybindingAccelerator(CTRLCMD | ALT | 22, '1'), false), 'Ctrl+Alt+1');
  assert.equal(formatAccelerator(keybindingAccelerator(15, 'ArrowLeft'), true), '←');
});

test('menu rows: every visible item with a key, roles included, grouped by top menu', () => {
  const menu = [
    {
      label: 'XGENIA',
      submenu: {
        items: [
          { label: 'About' },
          { role: 'hide' },
          { type: 'separator' },
          { label: 'Quit', accelerator: 'Command+Q' }
        ]
      }
    },
    {
      label: 'Edit',
      submenu: {
        items: [
          { label: 'Undo', accelerator: 'CmdOrCtrl+Z' },
          { role: 'copy' },
          { label: 'Hidden', accelerator: 'CmdOrCtrl+=', visible: false }
        ]
      }
    },
    { label: 'View', submenu: { items: [{ label: 'Toggle Edit / Preview', accelerator: 'CmdOrCtrl+T' }] } }
  ];
  assert.deepEqual(menuRows(menu, true), [
    { keys: '⌘H', action: 'Hide', group: 'XGENIA' },
    { keys: '⌘Q', action: 'Quit', group: 'XGENIA' },
    { keys: '⌘Z', action: 'Undo', group: 'Edit' },
    { keys: '⌘C', action: 'Copy', group: 'Edit' },
    { keys: '⌘T', action: 'Toggle Edit / Preview', group: 'View' }
  ]);
  // Hide is a macOS-only menu role.
  assert.equal(
    menuRows(menu, false).some((r) => r.action === 'Hide'),
    false
  );
});

test('command rows skip keys the menu already lists and duplicates', () => {
  const taken = [{ keys: '⌘T', action: 'Toggle Edit / Preview', group: 'View' }];
  const rows = commandRows(
    [
      { keys: '⌘T', title: 'Toggle preview', group: 'Editor' },
      { keys: '⌘B', title: 'Show/hide left panel', group: 'Editor' },
      { keys: '⌘B', title: 'Show/hide left panel', group: 'Editor' }
    ],
    taken
  );
  assert.deepEqual(rows, [{ keys: '⌘B', action: 'Show/hide left panel', group: 'Editor' }]);
});

test('search matches action, group or keys; groups keep first-seen order', () => {
  const rows = [
    { keys: '⌘Z', action: 'Undo', group: 'Edit' },
    { keys: 'F', action: 'Frame selection', group: 'Edit mode canvas' },
    { keys: '⌘T', action: 'Toggle Edit / Preview', group: 'View' }
  ];
  assert.deepEqual(
    filterRows(rows, 'frame').map((r) => r.keys),
    ['F']
  );
  assert.deepEqual(
    filterRows(rows, '⌘').map((r) => r.action),
    ['Undo', 'Toggle Edit / Preview']
  );
  assert.deepEqual(filterRows(rows, '  ').length, 3);
  assert.deepEqual(
    groupRows(rows).map((g) => g.group),
    ['Edit', 'Edit mode canvas', 'View']
  );
});
