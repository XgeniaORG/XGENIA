import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';

import { SidebarModel } from '@xgenia-models/sidebar';

import { Box } from '@xgenia-core-ui/components/layout/Box';
import { BasePanel } from '@xgenia-core-ui/components/sidebar/BasePanel';
import { TextInput } from '@xgenia-core-ui/components/inputs/TextInput';
import { useSimpleConfirmationDialog } from '@xgenia-core-ui/components/popups/ConfirmationDialog/ConfirmationDialog.hooks';
import { TagButton } from '@xgenia-core-ui/components/inputs/TagButton';

import { ToastLayer } from '../../ToastLayer';

import { AssetGrid } from './AssetGrid';
import { AssetInspector } from './AssetInspector';
import { MoveFolderPicker } from './MoveFolderPicker';
import { AssetBreadcrumbs } from './AssetBreadcrumbs';
import { AssetToolbar } from './AssetToolbar';
import { useProjectAssets } from './useProjectAssets';
import { useProjectFolderTree } from './useProjectFolderTree';
import { AssetFolderTree } from './AssetFolderTree';
import { useAssetSelection } from './useAssetSelection';
import { deleteToTrash, renameAsset, createFolder, duplicate, revealInOS, moveAsset } from './assetOps';
import { AssetKind } from './asset-classification';
import {
  getAssetMeta,
  getAllTags,
  useAssetMetaVersion,
  migrateAssetMeta,
  removeAssetMeta,
  copyAssetMeta,
  toggleAssetFavorite
} from './assetMeta';
import { reconcileGraphAssetRefs, getReferencedAssetPaths } from './assetGraphRefs';
import {
  getCollections,
  addCollection,
  removeCollection,
  useCollectionsVersion,
  AssetCollection
} from './collections';
import { smartSearchAssets, getSearchSuggestions } from './searchUtils';
import { ViewMode, SortBy } from './types';

import styles from './AssetPanel.module.scss';

const IS_ELECTRON = typeof window !== 'undefined' && !!(window as any).process?.type;

// The grid renders all items (fine for typical folders). For very large folders we cap
// the rendered set to keep the UI responsive; the user narrows via search/filters/folders.
const RENDER_CAP = 500;

const BULK_BTN: React.CSSProperties = {
  fontSize: 11,
  padding: '4px 10px',
  borderRadius: 6,
  cursor: 'pointer',
  color: '#ddd',
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.14)'
};

export function AssetPanel() {
  // Disk-backed asset browsing only makes sense with the real filesystem. In
  // WEB_MODE the platform FS is an in-memory map that diverges from the host disk
  // the AI tools read, so the panel is gated to the desktop app to avoid showing
  // a misleading empty list.
  if (process.env.WEB_MODE) {
    return (
      <BasePanel title="Assets">
        <div style={{ padding: 20, opacity: 0.7, fontSize: 13 }}>
          The asset browser is available in the desktop app.
        </div>
      </BasePanel>
    );
  }
  return <AssetPanelInner />;
}

function AssetPanelInner() {
  try {
    const [currentPath, setCurrentPath] = useState('/');
    const [viewMode, setViewMode] = useState<ViewMode>('grid');
    const [sortBy, setSortBy] = useState<SortBy>('name');
    const [sortAscending, setSortAscending] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [isDragOver, setIsDragOver] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [searchSuggestions, setSearchSuggestions] = useState<string[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [editingPath, setEditingPath] = useState<string | null>(null);
    const [activeKinds, setActiveKinds] = useState<Set<AssetKind>>(new Set());
    const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
    const [favoritesOnly, setFavoritesOnly] = useState(false);
    const [unusedOnly, setUnusedOnly] = useState(false);
    const [movePickerPaths, setMovePickerPaths] = useState<string[] | null>(null);
    const [tileSize, setTileSize] = useState(96);
    const [showTree, setShowTree] = useState(true);
    const metaVersion = useAssetMetaVersion();
    useCollectionsVersion();
    const [savingCollection, setSavingCollection] = useState(false);
    const [newCollectionName, setNewCollectionName] = useState('');
    const panelRef = useRef<HTMLDivElement>(null);

    const { assets, isLoading, error, refetch } = useProjectAssets(currentPath);
    const { tree, refetch: refetchTree } = useProjectFolderTree();

    // ONE canonical ordered list: search/score order THEN folders-first + sortBy.
    // This exact array feeds selection (range math) AND the grid (rendered verbatim).
    const filteredAssets = useMemo(
      () => smartSearchAssets(assets, searchQuery).map((r) => r.asset),
      [assets, searchQuery]
    );
    const orderedAssets = useMemo(() => {
      // Compose filters over the canonical list (kind chips → favorites → tags), then
      // enrich files with stored tags/favorite for display. Folders always pass so they
      // stay navigable; the folder branch precedes the kind cast.
      const referenced = unusedOnly ? getReferencedAssetPaths() : null;
      const arr = filteredAssets
        .filter((a) => a.type === 'folder' || activeKinds.size === 0 || activeKinds.has(a.type as AssetKind))
        .filter((a) => a.type === 'folder' || !favoritesOnly || !!getAssetMeta(a.path).favorite)
        .filter((a) => !referenced || a.type === 'folder' || !referenced.has(a.path))
        .filter((a) => {
          if (a.type === 'folder' || activeTags.size === 0) return true;
          return (getAssetMeta(a.path).tags || []).some((t) => activeTags.has(t));
        })
        .map((a) => {
          if (a.type === 'folder') return a;
          const m = getAssetMeta(a.path);
          return { ...a, favorite: m.favorite, tags: m.tags };
        });
      arr.sort((a, b) => {
        if (a.type === 'folder' && b.type !== 'folder') return -1;
        if (a.type !== 'folder' && b.type === 'folder') return 1;
        let c = 0;
        switch (sortBy) {
          case 'name': c = a.name.localeCompare(b.name); break;
          case 'date': c = (a.lastModified?.getTime() || 0) - (b.lastModified?.getTime() || 0); break;
          case 'size': c = (a.size || 0) - (b.size || 0); break;
          case 'type': c = a.type.localeCompare(b.type); break;
          default: c = 0;
        }
        return sortAscending ? c : -c;
      });
      return arr;
    }, [filteredAssets, sortBy, sortAscending, activeKinds, favoritesOnly, unusedOnly, activeTags, metaVersion]);

    const renderedAssets = orderedAssets.length > RENDER_CAP ? orderedAssets.slice(0, RENDER_CAP) : orderedAssets;

    const selection = useAssetSelection(orderedAssets);

    const [DeleteDialog, confirmDelete] = useSimpleConfirmationDialog({
      title: 'Delete assets',
      confirmButtonLabel: 'Delete',
      isDangerousAction: true
    });

    // Refs keep the delete handler stable so selection clicks don't re-render every tile.
    const selectionRef = useRef(selection);
    selectionRef.current = selection;
    const orderedRef = useRef(orderedAssets);
    orderedRef.current = orderedAssets;
    const confirmDeleteRef = useRef(confirmDelete);
    confirmDeleteRef.current = confirmDelete;

    // Clear the asset inspector when leaving the panel.
    useEffect(() => {
      return () => {
        if (SidebarModel.instance.RightPanelId === 'AssetInspector') {
          SidebarModel.instance.hidePanels();
        }
      };
    }, []);

    const handlePathChange = useCallback((newPath: string) => {
      setCurrentPath(newPath);
    }, []);

    const handleSearchChange = useCallback((value: string) => {
      setSearchQuery(value);
      if (value.trim()) {
        const suggestions = getSearchSuggestions(value, assets);
        setSearchSuggestions(suggestions);
        setShowSuggestions(suggestions.length > 0);
      } else {
        setSearchSuggestions([]);
        setShowSuggestions(false);
      }
    }, [assets]);

    const handleSuggestionClick = useCallback((suggestion: string) => {
      setSearchQuery(suggestion);
      setShowSuggestions(false);
    }, []);

    // Move the current selection (files and/or folders) to .trash, with confirm,
    // multi-select, partial-failure reporting, and a single refetch.
    const handleRequestDelete = useCallback(async () => {
      const sel = selectionRef.current;
      const ordered = orderedRef.current;
      const paths = Array.from(sel.selectedPaths);
      if (paths.length === 0) return;

      try {
        await confirmDeleteRef.current(
          paths.length === 1 ? 'Move this asset to Trash?' : `Move these ${paths.length} assets to Trash?`
        );
      } catch {
        return; // cancelled (the confirm promise rejects on cancel)
      }

      const byPath = new Map(ordered.map((a) => [a.path, a] as const));
      let ok = 0;
      let fail = 0;
      for (const p of paths) {
        const a = byPath.get(p);
        if (!a) continue;
        // Folder rows carry a nav-path ('/sub'); files carry 'assets/...'. Normalize.
        const rel = a.type === 'folder' ? `assets${a.path}` : a.path;
        try {
          await deleteToTrash(rel);
          if (a.type !== 'folder') removeAssetMeta(a.path);
          ok++;
        } catch (err) {
          fail++;
          console.error('[AssetPanel] delete failed:', p, err);
        }
      }

      refetch();
      refetchTree();
      sel.clear();

      if (fail > 0) {
        ToastLayer.showError(`Moved ${ok} of ${ok + fail} to Trash (${fail} failed)`);
      } else {
        ToastLayer.showSuccess(`Moved ${ok} ${ok === 1 ? 'item' : 'items'} to Trash`);
      }
    }, [refetch]);

    const handleStartRename = useCallback((path: string) => {
      setEditingPath(path);
    }, []);

    const handleCancelRename = useCallback(() => {
      setEditingPath(null);
    }, []);

    const handleCommitRename = useCallback(async (path: string, newName: string) => {
      setEditingPath(null);
      const a = orderedRef.current.find((x) => x.path === path);
      if (!a) return;
      const trimmed = (newName || '').trim();
      if (!trimmed || trimmed === a.name) return; // no-op
      const rel = a.type === 'folder' ? `assets${a.path}` : a.path;
      try {
        const newRel = await renameAsset(rel, trimmed);
        // Prefix-aware: files migrate by exact key, folders carry all inner-file metadata.
        migrateAssetMeta(rel, newRel);
        const refs = reconcileGraphAssetRefs(rel, newRel);
        refetch();
        refetchTree();
        ToastLayer.showSuccess(
          refs > 0 ? `Renamed to "${trimmed}" — updated ${refs} graph reference${refs === 1 ? '' : 's'}` : `Renamed to "${trimmed}"`
        );
      } catch (err: any) {
        ToastLayer.showError(err?.message || 'Rename failed');
      }
    }, [refetch]);

    const handleCreateFolder = useCallback(async () => {
      const parentRel = currentPath === '/' || currentPath === '' ? 'assets' : `assets${currentPath}`;
      try {
        const name = await createFolder(parentRel, 'New Folder');
        refetch();
        refetchTree();
        ToastLayer.showSuccess(`Created folder "${name}"`);
        // Open it for inline rename once the refetched row renders.
        const folderPath = currentPath === '/' || currentPath === '' ? `/${name}` : `${currentPath}/${name}`;
        setEditingPath(folderPath);
      } catch (err: any) {
        ToastLayer.showError(err?.message || 'Create folder failed');
      }
    }, [currentPath, refetch]);

    const handleToggleKind = useCallback((k: AssetKind) => {
      setActiveKinds((prev) => {
        const next = new Set(prev);
        if (next.has(k)) next.delete(k);
        else next.add(k);
        return next;
      });
    }, []);

    const handleToggleTag = useCallback((t: string) => {
      setActiveTags((prev) => {
        const next = new Set(prev);
        if (next.has(t)) next.delete(t);
        else next.add(t);
        return next;
      });
    }, []);

    const handleApplyCollection = useCallback((c: AssetCollection) => {
      setSearchQuery(c.query || '');
      setActiveKinds(new Set((c.kinds || []) as AssetKind[]));
      setActiveTags(new Set(c.tags || []));
      setFavoritesOnly(!!c.favoritesOnly);
    }, []);

    const handleSaveCollection = useCallback(() => {
      const name = newCollectionName.trim();
      if (!name) {
        setSavingCollection(false);
        setNewCollectionName('');
        return;
      }
      addCollection({
        name,
        query: searchQuery || undefined,
        kinds: activeKinds.size ? Array.from(activeKinds) : undefined,
        tags: activeTags.size ? Array.from(activeTags) : undefined,
        favoritesOnly: favoritesOnly || undefined
      });
      setNewCollectionName('');
      setSavingCollection(false);
      ToastLayer.showSuccess(`Saved collection "${name}"`);
    }, [newCollectionName, searchQuery, activeKinds, activeTags, favoritesOnly]);

    const handleDuplicate = useCallback(async () => {
      const sel = selectionRef.current;
      const ordered = orderedRef.current;
      const paths = Array.from(sel.selectedPaths);
      if (!paths.length) return;
      const byPath = new Map(ordered.map((a) => [a.path, a] as const));
      let ok = 0;
      let fail = 0;
      for (const p of paths) {
        const a = byPath.get(p);
        if (!a) continue;
        const rel = a.type === 'folder' ? `assets${a.path}` : a.path;
        try {
          const newName = await duplicate(rel, a.type === 'folder');
          if (a.type !== 'folder') {
            const dir = rel.split('/').slice(0, -1).join('/');
            copyAssetMeta(a.path, dir ? `${dir}/${newName}` : newName);
          }
          ok++;
        } catch (err) {
          fail++;
          console.error('[AssetPanel] duplicate failed:', p, err);
        }
      }
      refetch();
      refetchTree();
      if (fail > 0) ToastLayer.showError(`Duplicated ${ok} of ${ok + fail} (${fail} failed)`);
      else ToastLayer.showSuccess(`Duplicated ${ok} ${ok === 1 ? 'item' : 'items'}`);
    }, [refetch]);

    const handleReveal = useCallback((path: string) => {
      const a = orderedRef.current.find((x) => x.path === path);
      if (!a) return;
      const rel = a.type === 'folder' ? `assets${a.path}` : a.path;
      try {
        revealInOS(rel);
      } catch (err) {
        ToastLayer.showError('Reveal failed');
      }
    }, []);

    // Move uses project-relative paths ('assets/...'); folder asset.path is a nav-path
    // ('/sub'), so callers convert folders to 'assets' + path before opening the picker.
    const handleRequestMove = useCallback((relPaths: string[]) => {
      setMovePickerPaths(relPaths.length ? relPaths : null);
    }, []);

    const handleBulkMove = useCallback(() => {
      const paths = Array.from(selectionRef.current.selectedPaths).map((p) => {
        const a = orderedRef.current.find((x) => x.path === p);
        return a && a.type === 'folder' ? `assets${p}` : p;
      });
      setMovePickerPaths(paths.length ? paths : null);
    }, []);

    const handleBulkFavorite = useCallback(() => {
      const paths = Array.from(selectionRef.current.selectedPaths);
      for (const p of paths) {
        const a = orderedRef.current.find((x) => x.path === p);
        if (a && a.type !== 'folder') toggleAssetFavorite(p);
      }
    }, []);

    const handleMovePick = useCallback(
      async (navPath: string) => {
        const paths = movePickerPaths;
        setMovePickerPaths(null);
        if (!paths || !paths.length) return;
        const destRel = navPath === '/' ? 'assets' : `assets${navPath}`;
        let ok = 0;
        let fail = 0;
        for (const p of paths) {
          try {
            const newRel = await moveAsset(p, destRel);
            if (newRel !== p) {
              migrateAssetMeta(p, newRel);
              reconcileGraphAssetRefs(p, newRel);
            }
            ok++;
          } catch (err) {
            console.error('[AssetPanel] move failed:', p, err);
            fail++;
          }
        }
        refetch();
        refetchTree();
        selectionRef.current.clear();
        if (ok > 0) ToastLayer.showSuccess(`Moved ${ok} item${ok === 1 ? '' : 's'}`);
        if (fail > 0) ToastLayer.showError(`${fail} could not be moved`);
      },
      [movePickerPaths, refetch, refetchTree]
    );

    const handleGridKeyDown = useCallback((e: React.KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return; // don't hijack the rename field
      const sel = selectionRef.current;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        handleRequestDelete();
      } else if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        sel.selectAll();
      } else if (e.key === 'Escape') {
        sel.clear();
      } else if ((e.metaKey || e.ctrlKey) && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        handleDuplicate();
      } else if (e.key === 'F2') {
        if (sel.primaryPath) setEditingPath(sel.primaryPath);
      } else if (e.key === 'Enter') {
        const a = orderedRef.current.find((x) => x.path === sel.primaryPath);
        if (a?.type === 'folder') setCurrentPath(a.path);
      }
    }, [handleRequestDelete, handleDuplicate]);

    // Drive the right-hand Inspector from the asset selection (Unity-style): a single
    // selected file shows its inspector with preview + metadata + edit actions.
    useEffect(() => {
      const paths = selection.selectedPaths;
      if (paths.size === 1) {
        const only = Array.from(paths)[0];
        const a = orderedAssets.find((x) => x.path === only);
        if (a && a.type !== 'folder') {
          SidebarModel.instance.showRightPanel('AssetInspector', () =>
            React.createElement(AssetInspector, {
              asset: a,
              isElectron: IS_ELECTRON,
              onRename: handleStartRename,
              onDuplicate: handleDuplicate,
              onDelete: handleRequestDelete,
              onReveal: handleReveal,
              onMove: () => setMovePickerPaths([a.path])
            })
          );
          return;
        }
      }
      if (SidebarModel.instance.RightPanelId === 'AssetInspector') {
        SidebarModel.instance.hidePanels();
      }
    }, [selection.selectedPaths, orderedAssets, handleStartRename, handleDuplicate, handleRequestDelete, handleReveal]);

    const handleFilesImport = useCallback(async (files: FileList) => {
      if (!files || files.length === 0) return;
      setIsImporting(true);
      const fileArray = Array.from(files);
      try {
        for (const file of fileArray) {
          const assetKey = `asset_${Date.now()}_${file.name}`;
          localStorage.setItem(assetKey, JSON.stringify({
            name: file.name,
            type: file.type,
            size: file.size,
            path: currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`,
            lastModified: file.lastModified
          }));
        }
        refetch();
      } catch (error: any) {
        console.error('Error importing files:', error);
      } finally {
        setIsImporting(false);
      }
    }, [currentPath, refetch]);

    const handleDragOver = useCallback((e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (panelRef.current && !panelRef.current.contains(e.relatedTarget as Node)) {
        setIsDragOver(false);
      }
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        handleFilesImport(files);
      }
    }, [handleFilesImport]);

    return (
      <BasePanel title="Assets" isFill>
        <div
          ref={panelRef}
          className={`${styles['asset-panel']} ${isDragOver ? styles['asset-panel--drag-over'] : ''} ${isImporting ? styles['asset-panel--importing'] : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {isDragOver && (
            <div className={styles['asset-panel__drag-overlay']}>
              <div className={styles['asset-panel__drag-message']}>
                Drop files here to import them as assets
              </div>
            </div>
          )}

          {movePickerPaths && (
            <MoveFolderPicker
              tree={tree}
              count={movePickerPaths.length}
              onPick={handleMovePick}
              onClose={() => setMovePickerPaths(null)}
            />
          )}

          <Box UNSAFE_className="asset-panel__search">
            <div className={styles['asset-panel__search-container']}>
              <TextInput
                placeholder="Search assets (smart fuzzy search)..."
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                UNSAFE_className="asset-panel__search-input"
                isDisabled={isImporting}
              />
              {showSuggestions && searchSuggestions.length > 0 && (
                <div className={styles['asset-panel__suggestions']}>
                  {searchSuggestions.map((suggestion, index) => (
                    <div
                      key={index}
                      className={styles['asset-panel__suggestion-item']}
                      onClick={() => handleSuggestionClick(suggestion)}
                    >
                      {suggestion}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Box>

          <AssetBreadcrumbs
            currentPath={currentPath}
            onPathChange={handlePathChange}
            assetCount={orderedAssets.length}
          />

          {getCollections().length > 0 && (
            <div className={styles['asset-panel__filter-chips']}>
              {getCollections().map((c) => (
                <span
                  key={c.id}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 12,
                    padding: '3px 4px 3px 9px',
                    borderRadius: 6,
                    background: 'rgba(103,222,146,0.12)',
                    border: '1px solid rgba(103,222,146,0.3)'
                  }}
                >
                  <button
                    type="button"
                    onClick={() => handleApplyCollection(c)}
                    title="Apply this saved view"
                    style={{ background: 'none', border: 'none', color: '#CFEEDE', cursor: 'pointer', padding: 0, fontSize: 12 }}
                  >
                    {c.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeCollection(c.id)}
                    title="Delete collection"
                    style={{ background: 'none', border: 'none', color: '#7FAE93', cursor: 'pointer', padding: 0, fontSize: 13, lineHeight: 1 }}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className={styles['asset-panel__filter-chips']}>
            <TagButton label="★ Favorites" isActive={favoritesOnly} onClick={() => setFavoritesOnly((v) => !v)} />
            <TagButton label="Unused" isActive={unusedOnly} onClick={() => setUnusedOnly((v) => !v)} />
            {(['image', 'audio', 'font', 'video', 'document'] as AssetKind[]).map((k) => (
              <TagButton key={k} label={k} isActive={activeKinds.has(k)} onClick={() => handleToggleKind(k)} />
            ))}
            {getAllTags().map((t) => (
              <TagButton key={`tag-${t}`} label={`#${t}`} isActive={activeTags.has(t)} onClick={() => handleToggleTag(t)} />
            ))}
            {savingCollection ? (
              <input
                autoFocus
                value={newCollectionName}
                placeholder="Name this view…"
                onChange={(e) => setNewCollectionName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveCollection();
                  else if (e.key === 'Escape') {
                    setSavingCollection(false);
                    setNewCollectionName('');
                  }
                }}
                onBlur={() => {
                  setSavingCollection(false);
                  setNewCollectionName('');
                }}
                style={{
                  fontSize: 12,
                  padding: '3px 8px',
                  borderRadius: 6,
                  color: '#e6e6e6',
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.25)',
                  width: 130
                }}
              />
            ) : (
              <button
                type="button"
                onClick={() => setSavingCollection(true)}
                title="Save the current filters as a collection"
                style={{
                  fontSize: 12,
                  padding: '3px 10px',
                  borderRadius: 6,
                  color: '#aaa',
                  background: 'transparent',
                  border: '1px dashed rgba(255,255,255,0.2)',
                  cursor: 'pointer'
                }}
              >
                + Save view
              </button>
            )}
          </div>

          <AssetToolbar
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            sortBy={sortBy}
            onSortByChange={setSortBy}
            sortAscending={sortAscending}
            onSortDirectionChange={setSortAscending}
            onCreateFolder={handleCreateFolder}
            tileSize={tileSize}
            onTileSizeChange={setTileSize}
            showTree={showTree}
            onToggleTree={() => setShowTree((v) => !v)}
          />

          {selection.selectedPaths.size > 1 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 8px',
                margin: '0 4px',
                borderRadius: 8,
                background: 'rgba(103,222,146,0.10)',
                border: '1px solid rgba(103,222,146,0.25)'
              }}
            >
              <span style={{ fontSize: 12, color: '#CFEEDE', fontWeight: 600 }}>{selection.selectedPaths.size} selected</span>
              <div style={{ flex: 1 }} />
              <button type="button" onClick={handleBulkFavorite} style={BULK_BTN}>★ Favorite</button>
              <button type="button" onClick={handleBulkMove} style={BULK_BTN}>Move…</button>
              <button
                type="button"
                onClick={handleRequestDelete}
                style={{ ...BULK_BTN, color: '#FF8080', borderColor: 'rgba(255,128,128,0.4)' }}
              >
                Delete
              </button>
            </div>
          )}

          {orderedAssets.length > RENDER_CAP && (
            <div style={{ fontSize: 11, color: '#C9A227', padding: '0 4px' }}>
              Showing first {RENDER_CAP} of {orderedAssets.length} — narrow with search, filters, or folders.
            </div>
          )}

          <div className={styles['asset-panel__split']}>
            {showTree && (
              <div className={styles['asset-panel__tree']}>
                <AssetFolderTree tree={tree} currentPath={currentPath} onSelectFolder={handlePathChange} />
              </div>
            )}
            <div className={styles['asset-panel__grid-wrap']}>
              <AssetGrid
                assets={renderedAssets}
                isLoading={isLoading || isImporting}
                error={error}
                onPathChange={handlePathChange}
                searchQuery={searchQuery}
                viewMode={viewMode}
                isSelected={selection.isSelected}
                onItemClick={selection.onItemClick}
                onClearSelection={selection.clear}
                onRequestDelete={handleRequestDelete}
                onDuplicate={handleDuplicate}
                onReveal={IS_ELECTRON ? handleReveal : undefined}
                onRequestMove={(relPath) => handleRequestMove([relPath])}
                tileSize={tileSize}
                editingPath={editingPath}
                onStartRename={handleStartRename}
                onCommitRename={handleCommitRename}
                onCancelRename={handleCancelRename}
                onKeyDown={handleGridKeyDown}
              />
            </div>
          </div>

          <DeleteDialog />
        </div>
      </BasePanel>
    );
  } catch (error: any) {
    console.error('❌ AssetPanel render error:', error);
    return (
      <BasePanel title="Assets">
        <div style={{ padding: '20px', color: 'red' }}>
          Error loading AssetPanel: {error.message}
        </div>
      </BasePanel>
    );
  }
}
