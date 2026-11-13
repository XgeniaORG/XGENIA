import React, { useState } from 'react';

import PopupLayer from '../../popuplayer';
import type { FolderNode } from './assetFolders';
import css from './AssetLibrary.module.scss';

/** Folders under assets/. Click to scope the browser; drop dragged assets on a row to move them. */
export function AssetFolderTree({
  tree,
  selected,
  onSelect,
  onDropAsset,
  onContextMenu
}: {
  tree: FolderNode;
  selected: string | null;
  onSelect: (folder: string | null) => void;
  onDropAsset: (dest: string, draggedPath: string) => void;
  onContextMenu: (e: React.MouseEvent, folder: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<string | null>(null);

  const toggle = (path: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });

  // The asset drag runs through PopupLayer, which clears its item on the body's mouseup. React's
  // handler on the row runs first, so the item is still readable here.
  const draggedAsset = (): string | null => {
    const item: any = (PopupLayer.instance as any)?.dragItem;
    return item?.type === 'asset' && item.assetPath ? item.assetPath : null;
  };

  const row = (node: FolderNode, depth: number): React.ReactNode => {
    const isRoot = node.path === 'assets';
    const active = isRoot ? selected === null : selected === node.path;
    const open = !collapsed.has(node.path);
    return (
      <React.Fragment key={node.path}>
        <div
          className={[css.FolderRow, active ? css.FolderRowActive : '', hover === node.path ? css.FolderRowDrop : ''].join(' ')}
          style={{ paddingLeft: 6 + depth * 12 }}
          onClick={() => onSelect(isRoot ? null : node.path)}
          onContextMenu={(e) => onContextMenu(e, node.path)}
          onMouseEnter={() => draggedAsset() && setHover(node.path)}
          onMouseLeave={() => setHover(null)}
          onMouseUp={() => {
            const dragged = draggedAsset();
            setHover(null);
            if (dragged) onDropAsset(node.path, dragged);
          }}
          title={node.path}
        >
          {node.children.length > 0 ? (
            <button
              type="button"
              className={css.FolderTwisty}
              onClick={(e) => {
                e.stopPropagation();
                toggle(node.path);
              }}
              aria-label={open ? 'Collapse' : 'Expand'}
            >
              {open ? '▾' : '▸'}
            </button>
          ) : (
            <span className={css.FolderTwisty} />
          )}
          <span className={css.FolderName}>{isRoot ? 'All folders' : node.name}</span>
          <span className={css.Count}>{node.count}</span>
        </div>
        {open && node.children.map((c) => row(c, depth + 1))}
      </React.Fragment>
    );
  };

  return <div className={css.FolderTree}>{row(tree, 0)}</div>;
}
