import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ToastLayer } from '../../ToastLayer';
import PopupLayer from '../../popuplayer';

import { useAssetIndex } from './useAssetIndex';
import { rolesInIndex, roleCounts, type IndexedAsset } from './assetIndex';
import { filterAssets, sortAssets, EMPTY_QUERY, type AssetQuery, type SortMode } from './assetFilter';
import { roleLabel } from './assetRoles';
import { AssetLibraryInspector } from './AssetLibraryInspector';
import {
  createFolder,
  deleteToTrash,
  downscaleImage,
  duplicate,
  importFiles,
  importPaths,
  moveAsset,
  pickFilesToImport,
  renameAsset,
  restoreVersion,
  revealInOS,
  restoreFromTrash,
  ensureFolder,
  removeEmptyFolder
} from './assetOps';
import {
  addAssetTag,
  copyAssetMeta,
  getAllTags,
  mergeAssetMeta,
  buildUidToPathMap,
  migrateAssetMeta,
  replaceAssetMeta,
  retireAssetMeta,
  snapshotAssetMeta
} from './assetMeta';
import { editAssetMeta, recordAssetChange, redoAssetChange, undoAssetChange } from './assetHistory';
import { reconcileGraphAssetRefs } from './assetGraphRefs';
import { editorBridge } from '../ChatPanelBridge/EditorBridge';
import {
  EMPTY_SELECTION,
  moveFocus,
  pruneSelection,
  selectAll,
  selectionClick,
  type AssetSelection
} from './assetSelection';
import { buildFolderTree } from './assetFolders';
import { AssetToolbar } from './AssetToolbar';
import { AssetFolderTree } from './AssetFolderTree';
import { AssetGridItem, AssetListRow, useImageDims } from './AssetItems';
import { AssetContextMenu, type MenuEntry } from './AssetContextMenu';
import { FolderPicker } from './FolderPicker';
import { AssetQuickLook } from './AssetQuickLook';
import { AssetVersionCompare } from './AssetVersionCompare';
import { AssetBrokenRefs } from './AssetBrokenRefs';
import { AssetPlacementBoard } from './AssetPlacementBoard';
import { collectGraphRefEntries, findBrokenRefs } from './graphRefs';
import { copyText, formatBytes } from './assetFormat';
import { assetUrl } from './assetUrl';
import { scaleSlice } from './assetImagePlan';
import { ProjectModel } from '../../../models/projectmodel';
import { filesystem } from '@xgenia/platform';
import css from './AssetLibrary.module.scss';

export interface AssetViewPrefs {
  view: 'grid' | 'list';
  thumb: number;
  sort: SortMode;
  folders: boolean;
  inspectorHeight: number;
}

const PREFS_KEY = 'xgenia.assets.prefs';
const DEFAULT_PREFS: AssetViewPrefs = { view: 'grid', thumb: 112, sort: 'name', folders: false, inspectorHeight: 360 };

function readPrefs(): AssetViewPrefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') };
  } catch {
    return DEFAULT_PREFS;
  }
}

const MAX_SIZES = [2048, 1024, 512, 256];

/** Rename a file or folder in place, carrying its metadata and graph references. */
async function renameWithRefs(path: string, newName: string, exact = false): Promise<{ path: string; refs: number }> {
  // renameAsset sanitizes the name; the path it returns is the only true one.
  const next = await renameAsset(path, newName, { exact });
  if (next === path) return { path, refs: 0 };
  migrateAssetMeta(path, next);
  return { path: next, refs: reconcileGraphAssetRefs(path, next) };
}

/** Move into a folder, carrying metadata and graph references. */
async function moveWithRefs(path: string, folder: string): Promise<{ path: string; refs: number }> {
  const next = await moveAsset(path, folder);
  if (next === path) return { path, refs: 0 };
  migrateAssetMeta(path, next);
  return { path: next, refs: reconcileGraphAssetRefs(path, next) };
}

function savedSearchKey(): string {
  return `xgenia.assets.saved.${ProjectModel.instance?._retainedProjectDirectory || ''}`;
}
function readSavedSearches(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(savedSearchKey()) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
const GRID_GAP = 8;

/**
 * The asset library: what the project HAS, organised by what each thing IS — with the working
 * surface of a real engine's project window. Roles, search syntax, folders, multi-select, keyboard,
 * drag to the canvas, import, versions and the inspector's placement and sprite settings.
 */
export function AssetLibrary() {
  const { index, status, error, lastReason, lastRunAt, folders, screen, refresh } = useAssetIndex();
  const [query, setQuery] = useState<AssetQuery>(EMPTY_QUERY);
  const [prefs, setPrefsState] = useState<AssetViewPrefs>(readPrefs);
  const [selection, setSelection] = useState<AssetSelection>(EMPTY_SELECTION);
  const [menu, setMenu] = useState<{ x: number; y: number; folder?: string; maxSizeFor?: IndexedAsset[] } | null>(null);
  const [saved, setSaved] = useState<string[]>(readSavedSearches);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [moving, setMoving] = useState<string[] | null>(null);
  const [quickLook, setQuickLook] = useState(false);
  const [comparing, setComparing] = useState<{ path: string; versionPath: string } | null>(null);
  const [showBroken, setShowBroken] = useState(false);
  const [board, setBoard] = useState<{ root: string | null; selection: string[] } | null>(null);
  const [brokenCheck, setBrokenCheck] = useState(0);
  const [dropActive, setDropActive] = useState(false);
  const dims = useImageDims();

  const rootRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const setPrefs = useCallback((patch: Partial<AssetViewPrefs>) => {
    setPrefsState((p) => {
      const next = { ...p, ...patch };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        /* prefs are a convenience */
      }
      return next;
    });
  }, []);

  const roles = useMemo(() => (index ? rolesInIndex(index) : []), [index]);
  const counts = useMemo(() => (index ? roleCounts(index) : {}), [index]);
  const shown = useMemo(
    () => (index ? sortAssets(filterAssets(index.assets, query), prefs.sort) : []),
    [index, query, prefs.sort]
  );
  const order = useMemo(() => shown.map((a) => a.path), [shown]);
  const tree = useMemo(
    () => buildFolderTree(index ? index.assets.map((a) => a.path) : [], folders),
    [index, folders]
  );
  const lostCount = useMemo(() => (index ? index.assets.filter((a) => a.previousPlacement).length : 0), [index]);
  const allTags = useMemo(() => getAllTags(), [index]);

  // References that render nothing. Recomputed with every scan (and on demand after a relink): the
  // graph can change without the asset set changing.
  const broken = useMemo(() => {
    if (!index) return [];
    const live = new Set<string>(index.byPath.keys());
    // A `.vN` sibling is a real file a node may point at on purpose.
    for (const a of index.assets) for (const v of a.versions) if (v.source === 'file') live.add(v.path);
    const components = Array.isArray(ProjectModel.instance?.components) ? ProjectModel.instance.components : [];
    const root = ProjectModel.instance?._retainedProjectDirectory;
    const onDisk = (rel: string) => {
      try {
        return !!root && filesystem.exists(filesystem.join(String(root), rel));
      } catch {
        return false;
      }
    };
    return findBrokenRefs(collectGraphRefEntries(components), live, buildUidToPathMap(), onDisk);
  }, [index, brokenCheck]);

  // A rescan can remove selected files (delete, rename, an AI move). Never keep a phantom selection.
  useEffect(() => {
    if (index) setSelection((s) => pruneSelection(s, new Set(index.byPath.keys())));
  }, [index]);

  const selectedAssets = useMemo(
    () => (index ? [...selection.paths].map((p) => index.byPath.get(p)).filter(Boolean) as IndexedAsset[] : []),
    [index, selection]
  );
  const focused = selection.focus && index ? index.byPath.get(selection.focus) || null : null;
  const destFolder = query.folder || 'assets';

  // ─── operations ─────────────────────────────────────────────────────────────

  const commitRename = useCallback(
    async (asset: IndexedAsset, next: string) => {
      setRenaming(null);
      // The rename field unmounts; without this focus lands on <body> and the panel stops hearing keys.
      rootRef.current?.focus({ preventScroll: true });
      const clean = next.trim();
      if (!clean || clean === asset.name) return;
      try {
        const { path: nextPath, refs } = await renameWithRefs(asset.path, clean);
        if (nextPath === asset.path) return;
        recordAssetChange(
          `rename ${asset.name}`,
          async () => void (await renameWithRefs(asset.path, clean)),
          async () => void (await renameWithRefs(nextPath, asset.name, true))
        );
        setSelection({ paths: new Set([nextPath]), anchor: nextPath, focus: nextPath });
        refresh('rename');
        ToastLayer.showSuccess(refs > 0 ? `Renamed, and updated ${refs} graph references` : 'Renamed');
      } catch (e: any) {
        ToastLayer.showError(`Rename failed: ${e?.message || e}`);
      }
    },
    [refresh]
  );

  const deleteAssets = useCallback(
    async (assets: IndexedAsset[]) => {
      if (assets.length === 0) return;
      const used = assets.filter((a) => a.used).length;
      const what = assets.length === 1 ? assets[0].name : `${assets.length} assets`;
      const warn = used > 0 ? `\n\n${used === 1 && assets.length === 1 ? 'It is' : `${used} of them are`} used by the game and will stop showing.` : '';
      if (!window.confirm(`Move ${what} to the project's .trash? ${isMac ? '⌘Z' : 'Ctrl+Z'} brings it back.${warn}`)) return;
      const deleted: Array<{ path: string; row: ReturnType<typeof snapshotAssetMeta>; trash: string }> = [];
      for (const a of assets) {
        try {
          const row = snapshotAssetMeta(a.path);
          const trash = await deleteToTrash(a.path);
          if (trash) {
            await retireAssetMeta(a.path, trash);
            deleted.push({ path: a.path, row, trash });
          }
        } catch (e: any) {
          ToastLayer.showError(`Could not delete ${a.name}: ${e?.message || e}`);
        }
      }
      if (deleted.length) {
        recordAssetChange(
          deleted.length === 1 ? `delete ${assets[0].name}` : `delete ${deleted.length} assets`,
          async () => {
            for (const d of deleted) {
              const trash = await deleteToTrash(d.path);
              if (trash) {
                await retireAssetMeta(d.path, trash);
                d.trash = trash;
              }
            }
          },
          async () => {
            for (const d of deleted) {
              await restoreFromTrash(d.trash, d.path);
              await replaceAssetMeta(d.trash, null);
              // The row as it was, uid included, so uid:// references resolve again.
              await replaceAssetMeta(d.path, d.row);
            }
          }
        );
      }
      setSelection(EMPTY_SELECTION);
      refresh('delete');
      if (deleted.length) ToastLayer.showSuccess(deleted.length === 1 ? `${assets[0].name} moved to .trash` : `${deleted.length} assets moved to .trash`);
    },
    [refresh]
  );

  const duplicateAssets = useCallback(
    async (assets: IndexedAsset[]) => {
      const created: Array<{ from: string; to: string }> = [];
      for (const a of assets) {
        try {
          const name = await duplicate(a.path, false);
          const rel = `${a.path.split('/').slice(0, -1).join('/')}/${name}`;
          copyAssetMeta(a.path, rel);
          created.push({ from: a.path, to: rel });
        } catch (e: any) {
          ToastLayer.showError(`Could not duplicate ${a.name}: ${e?.message || e}`);
        }
      }
      if (created.length) {
        // Undo parks the copy in .trash with its row (uid included); redo brings back THAT file and
        // row, so a node pointing at the copy's uid:// keeps resolving across undo/redo.
        const parked = new Map<string, { trash: string; row: ReturnType<typeof snapshotAssetMeta> }>();
        recordAssetChange(
          created.length === 1 ? `duplicate ${assets[0].name}` : `duplicate ${created.length} assets`,
          async () => {
            for (const c of created) {
              const p = parked.get(c.to);
              if (!p) continue;
              await restoreFromTrash(p.trash, c.to);
              await replaceAssetMeta(p.trash, null);
              await replaceAssetMeta(c.to, p.row);
            }
          },
          async () => {
            for (const c of created) {
              const row = snapshotAssetMeta(c.to);
              const trash = await deleteToTrash(c.to);
              if (trash) {
                await retireAssetMeta(c.to, trash);
                parked.set(c.to, { trash, row });
              }
            }
          }
        );
        setSelection({ paths: new Set(created.map((c) => c.to)), anchor: created[0].to, focus: created[created.length - 1].to });
        refresh('duplicate');
      }
    },
    [refresh]
  );

  const moveAssets = useCallback(
    async (paths: string[], dest: string) => {
      setMoving(null);
      let refs = 0;
      const moved: Array<{ from: string; to: string }> = [];
      for (const p of paths) {
        try {
          const r = await moveWithRefs(p, dest);
          if (r.path === p) continue;
          refs += r.refs;
          moved.push({ from: p, to: r.path });
        } catch (e: any) {
          ToastLayer.showError(`Could not move ${p.split('/').pop()}: ${e?.message || e}`);
        }
      }
      if (moved.length) {
        recordAssetChange(
          `move ${moved.length === 1 ? moved[0].from.split('/').pop() : `${moved.length} assets`} to ${dest}`,
          async () => {
            for (const m of moved) await moveWithRefs(m.from, dest);
          },
          async () => {
            for (const m of moved) await moveWithRefs(m.to, m.from.split('/').slice(0, -1).join('/'));
          }
        );
        setSelection({ paths: new Set(moved.map((m) => m.to)), anchor: moved[0].to, focus: moved[moved.length - 1].to });
        refresh('move');
        ToastLayer.showSuccess(`Moved ${moved.length} to ${dest}${refs ? `, updated ${refs} graph references` : ''}`);
      }
    },
    [refresh]
  );

  const setRoleFor = useCallback(
    async (assets: IndexedAsset[], role: string) => {
      await editAssetMeta(`set role to ${roleLabel(role)}`, assets.map((a) => a.path), async () => {
        for (const a of assets) await mergeAssetMeta(a.path, { role });
      });
      refresh('role set');
    },
    [refresh]
  );

  const setStarFor = useCallback(
    async (assets: IndexedAsset[]) => {
      const star = !assets.every((a) => a.favorite);
      await editAssetMeta(star ? 'star' : 'unstar', assets.map((a) => a.path), async () => {
        for (const a of assets) await mergeAssetMeta(a.path, { favorite: star });
      });
      refresh(star ? 'starred' : 'unstarred');
    },
    [refresh]
  );

  const tagAssets = useCallback(
    async (assets: IndexedAsset[]) => {
      const tag = window.prompt(assets.length === 1 ? `Add a tag to ${assets[0].name}` : `Add a tag to ${assets.length} assets`);
      if (!tag || !tag.trim()) return;
      await editAssetMeta(`tag "${tag.trim()}"`, assets.map((a) => a.path), () => {
        for (const a of assets) addAssetTag(a.path, tag.trim());
      });
      refresh('tagged');
    },
    [refresh]
  );

  const regenerate = useCallback((asset: IndexedAsset) => {
    // The chat panel subscribes to this and hands the AI a composed instruction. Without a
    // prompt there is nothing to regenerate FROM, so say that rather than sending an empty ask.
    if (!asset.ai?.prompt) {
      ToastLayer.showError('No prompt was recorded for this asset, so there is nothing to regenerate from.');
      return;
    }
    editorBridge.pushEvent('regenerate-asset', { path: asset.path, prompt: asset.ai.prompt, model: asset.ai.model });
    ToastLayer.showSuccess('Asked the chat to regenerate this asset');
  }, []);

  /** Swap live bytes for another file's, keeping the current art as a version; undoable. */
  const swapBytes = useCallback(async (asset: IndexedAsset, label: string, apply: () => Promise<string>) => {
    // Every swap backs the live bytes up first, so undo is "restore that backup" and redo is
    // "restore the backup undo made" — history grows, nothing is ever lost.
    let backup = await apply();
    if (!backup) return;
    recordAssetChange(
      label,
      async () => {
        backup = await restoreVersion(asset.path, backup);
      },
      async () => {
        backup = await restoreVersion(asset.path, backup);
      }
    );
  }, []);

  const restore = useCallback(
    async (asset: IndexedAsset, versionPath: string, n: number) => {
      if (!window.confirm(`Make v${n} of ${asset.name} the live art? The current art is kept as a new version.`)) return;
      try {
        await swapBytes(asset, `restore v${n} of ${asset.name}`, () => restoreVersion(asset.path, versionPath));
        refresh('version restored');
        ToastLayer.showSuccess(`v${n} is live again`);
      } catch (e: any) {
        ToastLayer.showError(`Restore failed: ${e?.message || e}`);
      }
    },
    [refresh, swapBytes]
  );

  const doImport = useCallback(
    async (files?: FileList | File[]) => {
      try {
        const written = files ? await importFiles(files, destFolder) : await importPaths(await pickFilesToImport(), destFolder);
        if (written.length === 0) return;
        const trashed = new Map<string, { trash: string; row: ReturnType<typeof snapshotAssetMeta> }>();
        recordAssetChange(
          written.length === 1 ? `import ${written[0].split('/').pop()}` : `import ${written.length} files`,
          async () => {
            for (const w of written) {
              const t = trashed.get(w);
              if (!t) continue;
              await restoreFromTrash(t.trash, w);
              await replaceAssetMeta(t.trash, null);
              await replaceAssetMeta(w, t.row);
            }
          },
          async () => {
            for (const w of written) {
              // The row goes with the file, or a later import of the same name inherits its uid.
              const row = snapshotAssetMeta(w);
              const trash = await deleteToTrash(w);
              if (trash) {
                await retireAssetMeta(w, trash);
                trashed.set(w, { trash, row });
              }
            }
          }
        );
        refresh('import');
        setSelection({ paths: new Set(written), anchor: written[0], focus: written[written.length - 1] });
        ToastLayer.showSuccess(`Imported ${written.length} ${written.length === 1 ? 'file' : 'files'} into ${destFolder}`);
      } catch (e: any) {
        ToastLayer.showError(`Import failed: ${e?.message || e}`);
      }
    },
    [destFolder, refresh]
  );

  const saveSearch = useCallback((text: string) => {
    setSaved((list) => {
      const next = [...new Set([...list, text.trim()])].filter(Boolean);
      try {
        localStorage.setItem(savedSearchKey(), JSON.stringify(next));
      } catch {
        /* convenience only */
      }
      return next;
    });
  }, []);
  const forgetSearch = useCallback((text: string) => {
    setSaved((list) => {
      const next = list.filter((s) => s !== text);
      try {
        localStorage.setItem(savedSearchKey(), JSON.stringify(next));
      } catch {
        /* convenience only */
      }
      return next;
    });
  }, []);

  const downscale = useCallback(
    async (assets: IndexedAsset[], maxSide: number) => {
      let done = 0;
      let failed = 0;
      for (const a of assets) {
        if (a.extension !== 'png') continue;
        try {
          let r: Awaited<ReturnType<typeof downscaleImage>> = null;
          await swapBytes(a, `resize ${a.name} to ${maxSide}px`, async () => {
            r = await downscaleImage(a.path, assetUrl(a.path, Date.now()), maxSide);
            return r?.backup || '';
          });
          if (!r) continue;
          done++;
          // The planner's own scale, not a thumbnail-measured size: an off-screen asset has none.
          // (Undoing the resize restores the pixels; the borders are a separate, undoable step.)
          const scale = (r as { scale: number }).scale;
          if (a.sprite?.slice) {
            await editAssetMeta(`scale 9-slice of ${a.name}`, [a.path], () =>
              mergeAssetMeta(a.path, { sprite: { ...a.sprite, slice: scaleSlice(a.sprite!.slice, scale) } })
            );
          }
        } catch (e: any) {
          failed++;
          ToastLayer.showError(`Could not resize ${a.name}: ${e?.message || e}`);
        }
      }
      refresh('resized');
      if (done > 0) ToastLayer.showSuccess(`Resized ${done} to fit ${maxSide}px; the previous art is kept as a version`);
      else if (failed === 0) ToastLayer.showSuccess(`Nothing was larger than ${maxSide}px`);
    },
    [refresh, swapBytes]
  );

  const renameFolder = useCallback(
    async (folder: string) => {
      const current = folder.split('/').pop() || folder;
      const next = window.prompt('Rename folder', current);
      if (!next || !next.trim() || next.trim() === current) return;
      try {
        const { path: newRel, refs: updated } = await renameWithRefs(folder, next.trim());
        if (newRel === folder) return;
        recordAssetChange(
          `rename folder ${current}`,
          async () => void (await renameWithRefs(folder, next.trim())),
          async () => void (await renameWithRefs(newRel, current, true))
        );
        setQuery((q) => ({ ...q, folder: q.folder && (q.folder === folder || q.folder.startsWith(folder + '/')) ? newRel + q.folder.slice(folder.length) : q.folder }));
        refresh('folder renamed');
        ToastLayer.showSuccess(updated ? `Renamed, and updated ${updated} graph references` : 'Folder renamed');
      } catch (e: any) {
        ToastLayer.showError(`Rename failed: ${e?.message || e}`);
      }
    },
    [refresh]
  );

  const newFolder = useCallback(async (parent?: string) => {
    const where = parent || destFolder;
    const name = window.prompt(`New folder in ${where}`, 'New Folder');
    if (!name || !name.trim()) return;
    try {
      const created = await createFolder(where, name.trim());
      const rel = `${where}/${created}`;
      recordAssetChange(`new folder ${created}`, () => ensureFolder(rel), () => removeEmptyFolder(rel));
      refresh('folder created');
      setQuery((q) => ({ ...q, folder: `${where}/${created}` }));
      setPrefs({ folders: true });
    } catch (e: any) {
      ToastLayer.showError(`Could not create the folder: ${e?.message || e}`);
    }
  }, [destFolder, refresh, setPrefs]);

  // ─── selection, drag, keyboard ──────────────────────────────────────────────

  const dragArmed = useRef<IndexedAsset | null>(null);

  const onItemMouseDown = useCallback((e: React.MouseEvent, asset: IndexedAsset) => {
    if (e.button !== 0) return;
    dragArmed.current = asset;
  }, []);

  const onItemMouseMove = useCallback((e: React.MouseEvent) => {
    const asset = dragArmed.current;
    if (!asset || !(e.buttons & 1)) return;
    dragArmed.current = null;
    // The node canvas ignores HTML5 drag and drop; it listens to PopupLayer's own pipeline.
    PopupLayer.instance.startDragging({
      type: 'asset',
      label: asset.placement ? `${asset.name} — placed` : asset.name,
      assetPath: asset.path,
      assetType: asset.kind
    });
  }, []);

  const onItemClick = useCallback(
    (e: React.MouseEvent, asset: IndexedAsset) => {
      dragArmed.current = null;
      rootRef.current?.focus({ preventScroll: true });
      setSelection((s) => selectionClick(s, asset.path, { toggle: isMac ? e.metaKey : e.ctrlKey, range: e.shiftKey }, order));
    },
    [order]
  );

  const onItemContextMenu = useCallback((e: React.MouseEvent, asset: IndexedAsset) => {
    e.preventDefault();
    setSelection((s) => (s.paths.has(asset.path) ? { ...s, focus: asset.path } : selectionClick(s, asset.path, {}, [])));
    setMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const gridColumns = useCallback(() => {
    if (prefs.view === 'list') return 1;
    const w = gridRef.current?.clientWidth || 1;
    return Math.max(1, Math.floor((w + GRID_GAP) / (prefs.thumb + GRID_GAP)));
  }, [prefs.view, prefs.thumb]);

  useEffect(() => {
    if (!selection.focus) return;
    const el = gridRef.current?.querySelector(`[data-asset-path="${CSS.escape(selection.focus)}"]`);
    (el as HTMLElement | null)?.scrollIntoView({ block: 'nearest' });
  }, [selection.focus]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
      const mod = isMac ? e.metaKey : e.ctrlKey;
      // Undo/redo work from anywhere in the panel, a focused button included: the editor's global
      // shortcut ignores keys while any element has focus, so nobody else would handle them.
      if (mod && e.key.toLowerCase() === 'z') {
        // The global shortcut is silent while this panel has focus, so the panel drives the same queue.
        e.preventDefault();
        const label = e.shiftKey ? redoAssetChange() : undoAssetChange();
        ToastLayer.showInteraction(label ? `${e.shiftKey ? 'Redo' : 'Undo'} ${label}` : `Nothing to ${e.shiftKey ? 'redo' : 'undo'}`);
        return;
      }
      // Other keys on a focused control belong to that control: Tab, Enter and Space on an inspector
      // button, a menu item or the folder picker must never rename, delete or open quick look.
      if (target !== e.currentTarget && target.closest('button, a, [role="menuitem"], [role="menu"], [role="dialog"]')) return;
      // A keyboard move re-renders the inspector, which can unmount a focused element and drop focus
      // to <body>, where the next key would never reach this handler. Keep it on the panel.
      const keep = () => rootRef.current?.focus({ preventScroll: true });

      if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        keep();
        setSelection(selectAll(order));
        return;
      }
      if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        keep();
        const next = moveFocus(order, selection.focus, e.key, gridColumns());
        if (next) setSelection((s) => selectionClick(s, next, { range: e.shiftKey }, order));
        return;
      }
      if (e.key === 'Escape') {
        if (quickLook) {
          e.preventDefault();
          setQuickLook(false);
        } else if (selection.paths.size > 0) {
          // preventDefault marks it handled so the card's Escape-goes-home listener leaves it.
          e.preventDefault();
          setSelection(EMPTY_SELECTION);
        }
        return;
      }
      if (!focused) return;
      if (e.key === ' ') {
        e.preventDefault();
        setQuickLook((v) => !v);
      } else if (e.key === 'F2' || (e.key === 'Enter' && selection.paths.size === 1)) {
        e.preventDefault();
        setRenaming(focused.path);
      } else if (e.key === 'Delete' || (e.key === 'Backspace' && (mod || !isMac))) {
        e.preventDefault();
        void deleteAssets(selectedAssets);
      } else if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        void duplicateAssets(selectedAssets);
      } else if (mod && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        copyText(selectedAssets.map((a) => a.path).join('\n'));
      }
    },
    [order, selection, focused, selectedAssets, quickLook, gridColumns, deleteAssets, duplicateAssets]
  );

  // ─── context menu ───────────────────────────────────────────────────────────

  const folderEntries = (folder: string): MenuEntry[] => [
    { label: 'Show only this folder', action: () => setQuery((q) => ({ ...q, folder: folder === 'assets' ? null : folder })) },
    { label: 'New folder here…', action: () => void newFolder(folder) },
    ...(folder === 'assets' ? [] : [{ label: 'Rename folder…', action: () => void renameFolder(folder) }]),
    { separator: true },
    { label: 'Copy path', action: () => copyText(folder) },
    { label: isMac ? 'Reveal in Finder' : 'Show in Explorer', action: () => revealInOS(folder) }
  ];

  const menuEntries = useMemo((): MenuEntry[] => {
    const many = selectedAssets.length > 1;
    const one = selectedAssets.length === 1 ? selectedAssets[0] : null;
    if (selectedAssets.length === 0) return [];
    const entries: MenuEntry[] = [];
    if (one) {
      entries.push({ label: 'Quick look', hint: 'Space', action: () => setQuickLook(true) });
      entries.push({ label: 'Rename', hint: 'F2', action: () => setRenaming(one.path) });
    }
    entries.push({ label: many ? `Duplicate ${selectedAssets.length}` : 'Duplicate', hint: isMac ? '⌘D' : 'Ctrl+D', action: () => void duplicateAssets(selectedAssets) });
    entries.push({ label: 'Move to…', action: () => setMoving(selectedAssets.map((a) => a.path)) });
    entries.push({ separator: true });
    entries.push({
      label: selectedAssets.every((a) => a.favorite) ? 'Unstar' : 'Star',
      action: () => void setStarFor(selectedAssets)
    });
    entries.push({ label: 'Add tag…', action: () => tagAssets(selectedAssets) });
    entries.push({
      label: 'Set role',
      submenu: [...new Set([...roles, 'keyart', 'background', 'sprite', 'ui', 'icon', 'logo', 'sfx', 'music', 'video', 'font', 'other'])].map((r) => ({
        label: roleLabel(r),
        checked: selectedAssets.every((a) => a.role === r),
        action: () => void setRoleFor(selectedAssets, r)
      }))
    });
    entries.push({ separator: true });
    const pngs = selectedAssets.filter((a) => a.extension === 'png');
    if (pngs.length > 0) {
      entries.push({
        label: 'Max size',
        submenu: MAX_SIZES.map((n) => ({ label: `${n} px`, action: () => void downscale(pngs, n) }))
      });
    }
    entries.push({ label: many ? 'Copy paths' : 'Copy path', action: () => copyText(selectedAssets.map((a) => a.path).join('\n')) });
    if (one?.uid) entries.push({ label: 'Copy uid:// reference', action: () => copyText(`uid://${one.uid}`) });
    if (one) {
      entries.push({ label: isMac ? 'Reveal in Finder' : 'Show in Explorer', action: () => revealInOS(one.path) });
      if (one.ai?.prompt) entries.push({ label: 'Regenerate with the chat', action: () => regenerate(one) });
    }
    entries.push({ separator: true });
    entries.push({ label: many ? `Delete ${selectedAssets.length}` : 'Delete', hint: isMac ? '⌘⌫' : 'Del', danger: true, action: () => void deleteAssets(selectedAssets) });
    return entries;
  }, [selectedAssets, roles, duplicateAssets, setStarFor, tagAssets, setRoleFor, regenerate, deleteAssets, downscale]);

  // ─── OS file drop ───────────────────────────────────────────────────────────

  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types || []).includes('Files');

  // ─── render ─────────────────────────────────────────────────────────────────

  if (status === 'error') {
    return (
      <div className={css.Root}>
        <div className={css.Error}>
          <div>Could not read this project&rsquo;s assets.</div>
          <div className={css.Meta}>{error}</div>
          <button type="button" className={css.Retry} onClick={() => refresh('retry')}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (status === 'loading' && !index) {
    return (
      <div className={css.Root}>
        <div className={css.Loading}>Reading project assets…</div>
      </div>
    );
  }

  const total = index?.assets.length ?? 0;
  const selectedBytes = selectedAssets.reduce((n, a) => n + (a.size || 0), 0);
  const chip = (active: boolean) => (active ? `${css.Chip} ${css.ChipActive}` : css.Chip);

  return (
    <div
      ref={rootRef}
      className={dropActive ? `${css.Root} ${css.RootDrop}` : css.Root}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDropActive(true);
      }}
      onDragLeave={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget as Node)) setDropActive(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDropActive(false);
        void doImport(e.dataTransfer.files);
      }}
    >
      <AssetToolbar
        searchRef={searchRef}
        text={query.text}
        onText={(text) => setQuery((q) => ({ ...q, text }))}
        prefs={prefs}
        onPrefs={setPrefs}
        onImport={() => void doImport()}
        onNewFolder={() => void newFolder()}
        onSaveSearch={saveSearch}
        onOpenBoard={
          index && index.assets.some((a) => a.placement)
            ? () => setBoard({ root: focused?.lineage?.rootPath ?? (focused?.pieces.length ? focused.path : null), selection: [...selection.paths] })
            : undefined
        }
        savedSearches={saved}
        destFolder={destFolder}
      />

      <div className={css.Roles} role="tablist" aria-label="Asset roles">
        <button type="button" role="tab" aria-selected={query.role === null} className={chip(query.role === null)} onClick={() => setQuery((q) => ({ ...q, role: null }))}>
          All<span className={css.Count}>{total}</span>
        </button>
        {roles.map((r) => (
          <button
            key={r}
            type="button"
            role="tab"
            aria-selected={query.role === r}
            className={chip(query.role === r)}
            onClick={() => setQuery((q) => ({ ...q, role: q.role === r ? null : r }))}
          >
            {roleLabel(r)}
            <span className={css.Count}>{counts[r] || 0}</span>
          </button>
        ))}
        <button type="button" className={chip(query.unusedOnly)} aria-pressed={query.unusedOnly} onClick={() => setQuery((q) => ({ ...q, unusedOnly: !q.unusedOnly }))} title="Assets no node in any graph references">
          Unused
        </button>
        <button type="button" className={chip(query.favoritesOnly)} aria-pressed={query.favoritesOnly} onClick={() => setQuery((q) => ({ ...q, favoritesOnly: !q.favoritesOnly }))}>
          Starred
        </button>
        {saved.map((s) => (
          <button
            key={s}
            type="button"
            className={`${chip(query.text === s)} ${css.SavedChip}`}
            onClick={() => setQuery((q) => ({ ...q, text: q.text === s ? '' : s }))}
            title={`Saved search: ${s}`}
          >
            {s}
            <span
              className={css.ChipX}
              role="button"
              aria-label={`Forget saved search ${s}`}
              onClick={(e) => {
                e.stopPropagation();
                forgetSearch(s);
              }}
            >
              ×
            </span>
          </button>
        ))}
        {broken.length > 0 && (
          <button
            type="button"
            className={`${chip(showBroken)} ${css.ChipDanger}`}
            onClick={() => setShowBroken((v) => !v)}
            title="Node references to assets that do not exist"
          >
            Broken<span className={css.Count}>{broken.length}</span>
          </button>
        )}
        {lostCount > 0 && (
          <button
            type="button"
            className={`${chip(query.text.includes('is:lost-placement'))} ${css.ChipWarn}`}
            onClick={() => setQuery((q) => ({ ...q, text: q.text.includes('is:lost-placement') ? q.text.replace(/\s*is:lost-placement/, '') : `${q.text} is:lost-placement`.trim() }))}
            title="Files that lost their split placement when they were re-saved; an earlier version still has it"
          >
            Lost placement<span className={css.Count}>{lostCount}</span>
          </button>
        )}
      </div>

      <div className={css.Body}>
        {prefs.folders && (
          <AssetFolderTree
            tree={tree}
            selected={query.folder}
            onSelect={(folder) => setQuery((q) => ({ ...q, folder }))}
            onContextMenu={(e, folder) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, folder });
            }}
            onDropAsset={(dest, draggedPath) => {
              // Dragging one item of a selection moves the whole selection, as in Finder.
              const paths = selection.paths.has(draggedPath) ? [...selection.paths] : [draggedPath];
              void moveAssets(paths, dest);
            }}
          />
        )}

        <div className={css.Browser}>
          {query.folder && (
            <div className={css.Crumbs}>
              {query.folder.split('/').map((seg, i, all) => {
                const path = all.slice(0, i + 1).join('/');
                return (
                  <React.Fragment key={path}>
                    {i > 0 && <span className={css.CrumbSep}>/</span>}
                    <button type="button" className={css.Crumb} onClick={() => setQuery((q) => ({ ...q, folder: path === 'assets' ? null : path }))}>
                      {seg}
                    </button>
                  </React.Fragment>
                );
              })}
            </div>
          )}

          {showBroken ? (
            <AssetBrokenRefs
              broken={broken}
              selected={focused}
              onFixed={() => setBrokenCheck((n) => n + 1)}
              onClose={() => setShowBroken(false)}
            />
          ) : total === 0 ? (
            <div className={css.Empty}>
              <div>This project has no assets yet.</div>
              <div className={css.Meta}>Ask the chat for art, drop files here, or import.</div>
              <button type="button" className={css.Retry} onClick={() => void doImport()}>
                Import…
              </button>
            </div>
          ) : shown.length === 0 ? (
            <div className={css.Empty}>
              <div>Nothing matches.</div>
              <button type="button" className={css.Retry} onClick={() => setQuery(EMPTY_QUERY)}>
                Clear filters
              </button>
            </div>
          ) : (
            <div
              ref={gridRef}
              className={prefs.view === 'grid' ? css.Grid : css.List}
              style={prefs.view === 'grid' ? ({ '--thumb': `${prefs.thumb}px` } as React.CSSProperties) : undefined}
              onClick={(e) => {
                if (e.target === e.currentTarget) setSelection(EMPTY_SELECTION);
              }}
              onMouseMove={onItemMouseMove}
              onMouseUp={() => (dragArmed.current = null)}
              role="listbox"
              aria-multiselectable
            >
              {shown.map((a) =>
                prefs.view === 'grid' ? (
                  <AssetGridItem
                    key={a.path}
                    asset={a}
                    version={lastRunAt}
                    selected={selection.paths.has(a.path)}
                    focused={selection.focus === a.path}
                    renaming={renaming === a.path}
                    dims={dims.get(a.path)}
                    onDims={dims.set}
                    onMouseDown={onItemMouseDown}
                    onClick={onItemClick}
                    onDoubleClick={() => setQuickLook(true)}
                    onContextMenu={onItemContextMenu}
                    onRename={commitRename}
                    onCancelRename={() => setRenaming(null)}
                  />
                ) : (
                  <AssetListRow
                    key={a.path}
                    asset={a}
                    version={lastRunAt}
                    selected={selection.paths.has(a.path)}
                    focused={selection.focus === a.path}
                    renaming={renaming === a.path}
                    dims={dims.get(a.path)}
                    onDims={dims.set}
                    onMouseDown={onItemMouseDown}
                    onClick={onItemClick}
                    onDoubleClick={() => setQuickLook(true)}
                    onContextMenu={onItemContextMenu}
                    onRename={commitRename}
                    onCancelRename={() => setRenaming(null)}
                  />
                )
              )}
            </div>
          )}
        </div>
      </div>

      {selectedAssets.length > 1 && (
        <div className={css.BulkBar}>
          <span className={css.BulkCount}>
            {selectedAssets.length} selected{selectedBytes ? ` · ${formatBytes(selectedBytes)}` : ''}
          </span>
          <select
            className={css.BulkSelect}
            value=""
            onChange={(e) => e.target.value && void setRoleFor(selectedAssets, e.target.value)}
            aria-label="Set role for the selection"
          >
            <option value="">Role…</option>
            {[...new Set([...roles, 'keyart', 'background', 'sprite', 'ui', 'icon', 'logo', 'sfx', 'music', 'video', 'font', 'other'])].map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </select>
          <button type="button" className={css.Action} onClick={() => tagAssets(selectedAssets)}>
            Tag
          </button>
          <button type="button" className={css.Action} onClick={() => void setStarFor(selectedAssets)}>
            {selectedAssets.every((a) => a.favorite) ? 'Unstar' : 'Star'}
          </button>
          <button type="button" className={css.Action} onClick={() => setMoving(selectedAssets.map((a) => a.path))}>
            Move
          </button>
          <button type="button" className={`${css.Action} ${css.ActionDanger}`} onClick={() => void deleteAssets(selectedAssets)}>
            Delete
          </button>
          <button type="button" className={css.BulkClear} onClick={() => setSelection(EMPTY_SELECTION)} aria-label="Clear selection">
            ×
          </button>
        </div>
      )}

      {focused && selectedAssets.length === 1 && index && (
        <InspectorDock height={prefs.inspectorHeight} onHeight={(h) => setPrefs({ inspectorHeight: h })}>
          <AssetLibraryInspector
            asset={focused}
            index={index}
            screen={screen}
            projectRoles={roles}
            allTags={allTags}
            version={lastRunAt}
            dims={dims.get(focused.path)}
            onRefresh={refresh}
            onRename={(a) => setRenaming(a.path)}
            onDelete={(a) => void deleteAssets([a])}
            onDuplicate={(a) => void duplicateAssets([a])}
            onMove={(a) => setMoving([a.path])}
            onRegenerate={regenerate}
            onRestoreVersion={restore}
            onSelect={(path) => setSelection({ paths: new Set([path]), anchor: path, focus: path })}
            onQuickLook={() => setQuickLook(true)}
            onCompareVersion={(a, v) => setComparing({ path: a.path, versionPath: v.path })}
            onOpenBoard={(root, paths) => setBoard({ root, selection: paths })}
            onDownscale={(a) => {
              const r = (document.activeElement as HTMLElement | null)?.getBoundingClientRect();
              setMenu({ x: r ? r.left : 40, y: r ? r.bottom : 40, maxSizeFor: [a] });
            }}
          />
        </InspectorDock>
      )}

      <div className={css.Footer}>
        <span>{shown.length === total ? `${total} assets` : `${shown.length} of ${total}`}</span>
        <span className={css.FooterGrow} />
        {screen && (
          <span title={screen.source === 'bible' ? 'Target screen declared in the project bible' : 'Target screen from the device pinned in the top bar'}>
            {screen.width}×{screen.height}
          </span>
        )}
        <span title={`Last scan: ${lastReason}`}>{lastReason}</span>
        <button type="button" className={css.Retry} onClick={() => refresh('manual')}>
          Refresh
        </button>
      </div>

      {menu && (() => {
        const entries = menu.folder
          ? folderEntries(menu.folder)
          : menu.maxSizeFor
            ? MAX_SIZES.map((n) => ({ label: `Fit within ${n} px`, action: () => void downscale(menu.maxSizeFor!, n) }))
            : menuEntries;
        return entries.length > 0 ? <AssetContextMenu x={menu.x} y={menu.y} entries={entries} onClose={() => setMenu(null)} /> : null;
      })()}

      {moving && (
        <FolderPicker
          tree={tree}
          title={moving.length === 1 ? `Move ${moving[0].split('/').pop()} to…` : `Move ${moving.length} assets to…`}
          onPick={(dest) => void moveAssets(moving, dest)}
          onClose={() => setMoving(null)}
        />
      )}

      {board && index && (
        <AssetPlacementBoard
          index={index}
          screen={screen}
          version={lastRunAt}
          initialRoot={board.root}
          initialSelection={board.selection}
          onClose={() => {
            setBoard(null);
            rootRef.current?.focus({ preventScroll: true });
          }}
          onSaved={() => refresh('placement board')}
        />
      )}

      {comparing && index && (() => {
        const asset = index.byPath.get(comparing.path);
        const v = asset?.versions.find((x) => x.path === comparing.versionPath);
        if (!asset || !v) return null;
        return (
          <AssetVersionCompare
            asset={asset}
            version={v}
            cacheBust={lastRunAt}
            onClose={() => setComparing(null)}
            onRestore={() => {
              setComparing(null);
              void restore(asset, v.path, v.n);
            }}
            onUsePlacement={async () => {
              // Into ai.layout, where the AI's placement tools read it; a hand-set placement is
              // cleared so the chosen record is the one in force.
              await editAssetMeta(`use v${v.n} placement for ${asset.name}`, [asset.path], () =>
                mergeAssetMeta(asset.path, { ai: { ...(asset.ai || {}), layout: v.layout } as any, placement: undefined })
              );
              setComparing(null);
              refresh('placement from version');
              ToastLayer.showSuccess(`${asset.name} now uses v${v.n}’s placement`);
            }}
            onReveal={() => revealInOS(v.path)}
          />
        );
      })()}

      {quickLook && focused && (
        <AssetQuickLook
          asset={focused}
          version={lastRunAt}
          dims={dims.get(focused.path)}
          onClose={() => {
            setQuickLook(false);
            rootRef.current?.focus({ preventScroll: true });
          }}
          onStep={(dir) => {
            const next = moveFocus(order, selection.focus, dir < 0 ? 'ArrowLeft' : 'ArrowRight', 1);
            if (next) setSelection({ paths: new Set([next]), anchor: next, focus: next });
          }}
        />
      )}
    </div>
  );
}

/** The inspector, docked under the browser with a drag handle to trade height between them. */
function InspectorDock({ height, onHeight, children }: { height: number; onHeight: (h: number) => void; children: React.ReactNode }) {
  const [live, setLive] = useState(height);
  const drag = useRef<{ y: number; h: number } | null>(null);
  useEffect(() => setLive(height), [height]);

  return (
    <>
      <div
        className={css.Splitter}
        role="separator"
        aria-orientation="horizontal"
        title="Drag to resize the inspector"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { y: e.clientY, h: live };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          setLive(Math.max(140, Math.min(window.innerHeight * 0.8, drag.current.h + (drag.current.y - e.clientY))));
        }}
        onPointerUp={() => {
          if (!drag.current) return;
          drag.current = null;
          onHeight(Math.round(live));
        }}
      />
      <div className={css.InspectorDock} style={{ height: live }}>
        {children}
      </div>
    </>
  );
}
