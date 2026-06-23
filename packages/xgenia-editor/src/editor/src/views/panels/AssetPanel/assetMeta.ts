import { useState, useEffect } from 'react';

import { filesystem } from '@xgenia/platform';

import { ProjectModel } from '../../../models/projectmodel';

// Per-asset tags & favorites, stored in ONE project file (<project>/.xgenia-assets.json),
// keyed by the project-relative asset path ('assets/...'). The file lives OUTSIDE the
// scoped assets/ walk, so it never appears in the grid or the AI's list_project_assets.
// Keys are migrated by the panel's rename/move/delete/duplicate handlers so tags survive
// in-app reorganization.

/** Provenance for an AI-generated asset ("what the AI did"). */
export interface AIProvenance {
  prompt?: string;
  model?: string;
  source?: string; // e.g. 'fal_generated' | 'fal_img2img'
  seed?: number;
  params?: { width?: number; height?: number; format?: string; strength?: number; [k: string]: any };
  timestamp?: number; // Date.now() at generation
  cost?: number;
}

export interface AssetMetaEntry {
  tags?: string[];
  favorite?: boolean;
  /** Stable per-asset id behind `uid://` graph refs, so renames/moves never orphan a
   *  reference (the uid travels with the asset via migrateAssetMeta; the param is unchanged). */
  uid?: string;
  /** Set when the asset was created by the AI (recorded at save time). */
  ai?: AIProvenance;
}

type MetaMap = Record<string, AssetMetaEntry>;

const META_FILENAME = '.xgenia-assets.json';

let cache: MetaMap = {};
let loadedRoot: string | null | undefined = undefined;
let loadingPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function projectRoot(): string | null {
  const root = ProjectModel.instance?._retainedProjectDirectory;
  return root ? String(root) : null;
}

function metaPath(): string | null {
  const root = projectRoot();
  return root ? filesystem.join(root, META_FILENAME) : null;
}

function notify(): void {
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      /* ignore listener errors */
    }
  });
}

export function subscribeAssetMeta(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Load (once per project). Re-loads if the open project changed. */
export async function loadAssetMeta(): Promise<void> {
  const root = projectRoot();
  if (loadedRoot === root && !loadingPromise) return;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    let next: MetaMap = {};
    try {
      const p = metaPath();
      if (p && filesystem.exists(p)) {
        const raw = await filesystem.readFile(p);
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') next = parsed;
      }
    } catch (e) {
      console.warn('[assetMeta] load failed', e);
    } finally {
      cache = next;
      loadedRoot = root;
      loadingPromise = null;
      notify();
    }
  })();
  return loadingPromise;
}

async function persist(): Promise<void> {
  const p = metaPath();
  if (!p) return;
  try {
    await filesystem.writeFile(p, JSON.stringify(cache, null, 2));
  } catch (e) {
    console.warn('[assetMeta] save failed', e);
  }
}

export function getAssetMeta(path: string): AssetMetaEntry {
  return cache[path] || {};
}

export function getAllTags(): string[] {
  const s = new Set<string>();
  for (const k in cache) (cache[k].tags || []).forEach((t) => s.add(t));
  return Array.from(s).sort((a, b) => a.localeCompare(b));
}

/** Keep the file tidy: an entry with no tags and no favorite is removed entirely. */
function commit(path: string, entry: AssetMetaEntry): void {
  const hasTags = !!(entry.tags && entry.tags.length > 0);
  if (!hasTags && !entry.favorite && !entry.ai && !entry.uid) delete cache[path];
  else cache[path] = entry;
  notify();
  persist();
}

function genUid(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 10; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/** Stable id for an asset path, or undefined if none assigned yet. */
export function getAssetUid(path: string): string | undefined {
  return cache[path]?.uid;
}

/**
 * Get the asset's stable id, assigning + persisting one on first use. Returns '' if the
 * metadata store hasn't loaded yet — callers MUST fall back to the raw path in that case,
 * because committing against an unloaded (empty) cache would clobber the on-disk file.
 */
export function getOrAssignUid(path: string): string {
  if (loadedRoot === undefined) return '';
  const existing = cache[path]?.uid;
  if (existing) return existing;
  const taken = new Set(Object.values(cache).map((e) => e.uid).filter(Boolean) as string[]);
  let uid = genUid();
  while (taken.has(uid)) uid = genUid();
  commit(path, { ...getAssetMeta(path), uid });
  return uid;
}

/** uid → current project-relative path, for the runtime resolver / export manifest. */
export function buildUidToPathMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const path in cache) {
    const uid = cache[path]?.uid;
    if (uid) map[uid] = path;
  }
  return map;
}

export function setAssetTags(path: string, tags: string[]): void {
  const cleaned = Array.from(new Set(tags.map((t) => t.trim()).filter(Boolean)));
  commit(path, { ...getAssetMeta(path), tags: cleaned });
}

export function addAssetTag(path: string, tag: string): void {
  const t = tag.trim();
  if (!t) return;
  const current = getAssetMeta(path).tags || [];
  if (current.includes(t)) return;
  setAssetTags(path, [...current, t]);
}

export function removeAssetTag(path: string, tag: string): void {
  setAssetTags(path, (getAssetMeta(path).tags || []).filter((t) => t !== tag));
}

export function toggleAssetFavorite(path: string): void {
  commit(path, { ...getAssetMeta(path), favorite: !getAssetMeta(path).favorite });
}

/**
 * Record AI generation provenance for an asset (called by the editor bridge when the
 * AI saves a generated image). Loads from disk first so existing tags/favorites are
 * preserved, then merges + persists + notifies (so the panel/Inspector update live).
 */
export async function recordAssetProvenance(path: string, ai: AIProvenance): Promise<void> {
  await loadAssetMeta();
  commit(path, { ...getAssetMeta(path), ai });
}

/**
 * Migrate metadata when an asset is renamed/moved. PREFIX-AWARE: migrates the exact
 * key (a file) AND every descendant key under `oldPath/` → `newPath/` (a folder
 * rename/move carries all its files' tags/provenance). Used by in-app ops and the
 * AI's manage_asset via the `assetMeta.migrate` bridge handler.
 */
export function migrateAssetMeta(oldPath: string, newPath: string): void {
  if (oldPath === newPath) return;
  let changed = false;

  if (cache[oldPath]) {
    cache[newPath] = cache[oldPath];
    delete cache[oldPath];
    changed = true;
  }

  const prefix = oldPath + '/';
  for (const k of Object.keys(cache)) {
    if (k.startsWith(prefix)) {
      cache[newPath + '/' + k.slice(prefix.length)] = cache[k];
      delete cache[k];
      changed = true;
    }
  }

  if (changed) {
    notify();
    persist();
  }
}

export function copyAssetMeta(srcPath: string, newPath: string): void {
  const src = cache[srcPath];
  if (!src) return;
  cache[newPath] = { ...src, tags: [...(src.tags || [])] };
  notify();
  persist();
}

export function removeAssetMeta(path: string): void {
  if (!cache[path]) return;
  delete cache[path];
  notify();
  persist();
}

/** Re-renders the calling component whenever any asset meta changes; loads on mount. */
export function useAssetMetaVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    loadAssetMeta();
    return subscribeAssetMeta(() => setVersion((n) => n + 1));
  }, []);
  return version;
}
