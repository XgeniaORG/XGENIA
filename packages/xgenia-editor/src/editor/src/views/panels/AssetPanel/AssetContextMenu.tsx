import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { createPortal } from 'react-dom';

import css from './AssetLibrary.module.scss';

/** A menu row, or a separator when `separator` is set (the other fields are then ignored). */
export interface MenuEntry {
  separator?: boolean;
  label?: string;
  hint?: string;
  danger?: boolean;
  checked?: boolean;
  action?: () => void;
  submenu?: MenuEntry[];
}

export function AssetContextMenu({ x, y, entries, onClose }: { x: number; y: number; entries: MenuEntry[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [open, setOpen] = useState<number | null>(null);

  // Keep the menu on screen.
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ x: Math.min(x, window.innerWidth - r.width - 8), y: Math.min(y, window.innerHeight - r.height - 8) });
  }, [x, y]);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Handled here, so neither the panel card (home) nor the library (clear selection) acts on it.
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key, true);
    };
  }, [onClose]);

  // Portaled: the panel card has a backdrop-filter, which makes it the containing block for
  // position:fixed and would trap this overlay inside the card.
  return createPortal(

    <div ref={ref} className={css.Menu} style={{ left: pos.x, top: pos.y }} role="menu">
      {entries.map((entry, i) =>
        entry.separator ? (
          <div key={i} className={css.MenuSep} />
        ) : (
          <div key={i} className={css.MenuItemWrap} onMouseEnter={() => setOpen(entry.submenu ? i : null)}>
            <button
              type="button"
              role="menuitem"
              className={entry.danger ? `${css.MenuItem} ${css.MenuItemDanger}` : css.MenuItem}
              onClick={() => {
                if (entry.submenu) return setOpen(i);
                entry.action?.();
                onClose();
              }}
            >
              <span className={css.MenuCheck}>{entry.checked ? '✓' : ''}</span>
              <span className={css.MenuLabel}>{entry.label}</span>
              {entry.hint && <span className={css.MenuHint}>{entry.hint}</span>}
              {entry.submenu && <span className={css.MenuHint}>▸</span>}
            </button>
            {entry.submenu && open === i && (
              <div className={css.Submenu} role="menu">
                {entry.submenu.map((sub, j) =>
                  sub.separator ? (
                    <div key={j} className={css.MenuSep} />
                  ) : (
                    <button
                      key={j}
                      type="button"
                      role="menuitem"
                      className={css.MenuItem}
                      onClick={() => {
                        sub.action?.();
                        onClose();
                      }}
                    >
                      <span className={css.MenuCheck}>{sub.checked ? '✓' : ''}</span>
                      <span className={css.MenuLabel}>{sub.label}</span>
                    </button>
                  )
                )}
              </div>
            )}
          </div>
        )
      )}
    </div>,
    document.body
  );
}
