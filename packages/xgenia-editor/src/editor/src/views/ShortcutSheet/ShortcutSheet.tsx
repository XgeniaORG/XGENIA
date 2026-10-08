import React, { useEffect, useMemo, useRef, useState } from 'react';
import { platform, PlatformOS } from '@xgenia/platform';

import { KeyCodeUtils } from '@xgenia-utils/keyboard/KeyCodeMapper';
import KeyboardHandler from '@xgenia-utils/keyboardhandler';

import { CANVAS_SHORTCUTS } from './canvasShortcuts';
import {
  commandRows,
  filterRows,
  formatAccelerator,
  groupRows,
  keybindingAccelerator,
  menuRows,
  ShortcutRow
} from './shortcutRows';
import css from './ShortcutSheet.module.scss';

function applicationMenuItems() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Menu } = require('@electron/remote');
    const menu = Menu.getApplicationMenu();
    return menu ? menu.items : [];
  } catch {
    return [];
  }
}

/** Read when the sheet opens: the menu as built now, and the commands registered now. */
function liveRows(isMac: boolean): ShortcutRow[] {
  const canvas = CANVAS_SHORTCUTS.map((s) => ({
    keys: s.accelerator ? formatAccelerator(s.accelerator, isMac) : isMac ? s.mac : s.other,
    action: s.action,
    group: s.group
  }));
  const fromMenu = menuRows(applicationMenuItems(), isMac);
  const commands = KeyboardHandler.instance.listTitledCommands().map((c) => ({
    keys: formatAccelerator(keybindingAccelerator(c.keybinding, KeyCodeUtils.toString(c.keybinding & 0xff)), isMac),
    title: c.title,
    group: c.group
  }));
  return [...commandRows(commands, fromMenu), ...canvas, ...fromMenu];
}

export interface ShortcutSheetProps {
  onClose: () => void;
}

export function ShortcutSheet({ onClose }: ShortcutSheetProps) {
  const isMac = platform.os === PlatformOS.MacOS;
  const rows = useMemo(() => liveRows(isMac), [isMac]);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const groups = groupRows(filterRows(rows, query));

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div
      className={css['Backdrop']}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={css['Root']}
        role="dialog"
        aria-label="Keyboard shortcuts"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <header className={css['Header']}>
          <h2 className={css['Title']}>Keyboard shortcuts</h2>
          <button className={css['Close']} onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <input
          ref={inputRef}
          className={css['Search']}
          placeholder="Search shortcuts"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
        />
        <div className={css['List']}>
          {groups.length === 0 && <div className={css['Empty']}>No shortcut matches “{query}”</div>}
          {groups.map(({ group, rows }) => (
            <section key={group} className={css['Group']}>
              <h3 className={css['GroupTitle']}>{group}</h3>
              {rows.map((r) => (
                <div key={r.group + r.keys + r.action} className={css['Row']}>
                  <span className={css['Action']}>{r.action}</span>
                  <kbd className={css['Keys']}>{r.keys}</kbd>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
