import React, { useEffect } from 'react';

import type { FolderNode } from './assetFolders';
import { createPortal } from 'react-dom';

import css from './AssetLibrary.module.scss';

export function FolderPicker({
  tree,
  title,
  onPick,
  onClose
}: {
  tree: FolderNode;
  title: string;
  onPick: (folder: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [onClose]);

  const rows: React.ReactNode[] = [];
  const walk = (n: FolderNode, depth: number) => {
    rows.push(
      <button key={n.path} type="button" className={css.PickerRow} style={{ paddingLeft: 10 + depth * 14 }} onClick={() => onPick(n.path)}>
        {n.path === 'assets' ? 'assets' : n.name}
        <span className={css.Count}>{n.count}</span>
      </button>
    );
    n.children.forEach((c) => walk(c, depth + 1));
  };
  walk(tree, 0);

  // Portaled: the panel card has a backdrop-filter, which makes it the containing block for
  // position:fixed and would trap this overlay inside the card.
  return createPortal(

    <div className={css.Scrim} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={css.Picker} role="dialog" aria-label={title}>
        <div className={css.PickerTitle}>{title}</div>
        <div className={css.PickerList}>{rows}</div>
        <div className={css.Row}>
          <span className={css.FooterGrow} />
          <button type="button" className={css.Action} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
