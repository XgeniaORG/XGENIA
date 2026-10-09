import React, { useCallback, useEffect, useRef, useState } from 'react';

import type { IndexedAsset } from './assetIndex';
import { roleLabel } from './assetRoles';
import { assetUrl, isPreviewable } from './assetUrl';
import { formatBytes, formatShortDate } from './assetFormat';
import css from './AssetLibrary.module.scss';

export interface Dims {
  w: number;
  h: number;
}

/** Natural image sizes, learned as thumbnails load. Shared by grid, list, inspector, quick look. */
export function useImageDims() {
  const ref = useRef(new Map<string, Dims>());
  const [, bump] = useState(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const set = useCallback((path: string, d: Dims) => {
    const prev = ref.current.get(path);
    if (prev && prev.w === d.w && prev.h === d.h) return;
    ref.current.set(path, d);
    // Batch: a grid of 200 thumbnails would otherwise re-render the panel 200 times.
    if (!pending.current) {
      pending.current = setTimeout(() => {
        pending.current = null;
        bump((n) => n + 1);
      }, 120);
    }
  }, []);
  useEffect(() => () => void (pending.current && clearTimeout(pending.current)), []);
  return { get: (path: string) => ref.current.get(path), set };
}

interface ItemProps {
  asset: IndexedAsset;
  version: number;
  selected: boolean;
  focused: boolean;
  renaming: boolean;
  dims?: Dims;
  onDims: (path: string, d: Dims) => void;
  onMouseDown: (e: React.MouseEvent, a: IndexedAsset) => void;
  onClick: (e: React.MouseEvent, a: IndexedAsset) => void;
  onDoubleClick: () => void;
  onContextMenu: (e: React.MouseEvent, a: IndexedAsset) => void;
  onRename: (a: IndexedAsset, next: string) => void;
  onCancelRename: () => void;
}

function Thumb({ asset, version, onDims }: { asset: IndexedAsset; version: number; onDims: ItemProps['onDims'] }) {
  if (!isPreviewable(asset.kind)) {
    return <span className={css.ThumbGlyph}>{asset.extension || asset.kind}</span>;
  }
  return (
    // loading="lazy" matters: a project's key art can be several megabytes and the grid would
    // otherwise decode every one of them on mount.
    <img
      src={assetUrl(asset.path, version)}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onLoad={(e) => onDims(asset.path, { w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
    />
  );
}

function RenameField({ asset, onRename, onCancel }: { asset: IndexedAsset; onRename: ItemProps['onRename']; onCancel: () => void }) {
  const [value, setValue] = useState(asset.name);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    // Select the stem, not the extension — the Finder convention.
    const dot = asset.name.lastIndexOf('.');
    el.setSelectionRange(0, dot > 0 ? dot : asset.name.length);
  }, [asset.name]);
  const commit = () => {
    if (done.current) return;
    done.current = true;
    onRename(asset, value);
  };
  return (
    <input
      ref={ref}
      className={css.RenameInput}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          e.preventDefault();
          done.current = true;
          onCancel();
        }
      }}
    />
  );
}

function Badges({ asset }: { asset: IndexedAsset }) {
  return (
    <span className={css.Badges}>
      {asset.favorite && <span className={`${css.Badge} ${css.BadgeFavorite}`}>★</span>}
      {asset.previousPlacement && (
        <span className={`${css.Badge} ${css.BadgeWarn}`} title="Lost its placement on a re-save — an earlier version still has it">
          !
        </span>
      )}
      {asset.placement && (
        <span className={`${css.Badge} ${css.BadgeLineage}`} title={asset.placement.source === 'authored' ? 'Placed by hand' : `Placed from ${asset.lineage?.rootPath.split('/').pop()}`}>
          ⌖
        </span>
      )}
      {asset.versions.length > 0 && (
        <span className={css.Badge} title={`${asset.versions.length} earlier versions`}>
          v{asset.versions.length + 1}
        </span>
      )}
    </span>
  );
}

function itemClass(base: string, p: ItemProps) {
  return [base, p.selected ? css.CardSelected : '', p.focused ? css.CardFocused : '', p.asset.used ? '' : css.CardUnused]
    .filter(Boolean)
    .join(' ');
}

export function AssetGridItem(p: ItemProps) {
  const { asset } = p;
  return (
    <div
      className={itemClass(css.Card, p)}
      data-asset-path={asset.path}
      role="option"
      aria-selected={p.selected}
      title={`${asset.path}${p.dims ? `\n${p.dims.w}×${p.dims.h}` : ''}${asset.size ? ` · ${formatBytes(asset.size)}` : ''}`}
      onMouseDown={(e) => p.onMouseDown(e, asset)}
      onClick={(e) => p.onClick(e, asset)}
      onDoubleClick={p.onDoubleClick}
      onContextMenu={(e) => p.onContextMenu(e, asset)}
    >
      <span className={css.Thumb}>
        <Thumb asset={asset} version={p.version} onDims={p.onDims} />
        <Badges asset={asset} />
      </span>
      {p.renaming ? (
        <RenameField asset={asset} onRename={p.onRename} onCancel={p.onCancelRename} />
      ) : (
        <span className={css.Name}>{asset.name}</span>
      )}
    </div>
  );
}

export function AssetListRow(p: ItemProps) {
  const { asset } = p;
  return (
    <div
      className={itemClass(css.Row2, p)}
      data-asset-path={asset.path}
      role="option"
      aria-selected={p.selected}
      title={asset.path}
      onMouseDown={(e) => p.onMouseDown(e, asset)}
      onClick={(e) => p.onClick(e, asset)}
      onDoubleClick={p.onDoubleClick}
      onContextMenu={(e) => p.onContextMenu(e, asset)}
    >
      <span className={css.RowThumb}>
        <Thumb asset={asset} version={p.version} onDims={p.onDims} />
      </span>
      <span className={css.RowMain}>
        {p.renaming ? (
          <RenameField asset={asset} onRename={p.onRename} onCancel={p.onCancelRename} />
        ) : (
          <span className={css.Name}>
            {asset.favorite ? '★ ' : ''}
            {asset.name}
          </span>
        )}
        <span className={css.RowSub}>
          {[roleLabel(asset.role), p.dims ? `${p.dims.w}×${p.dims.h}` : '', formatBytes(asset.size), formatShortDate(asset.mtime)]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </span>
      <Badges asset={asset} />
    </div>
  );
}
