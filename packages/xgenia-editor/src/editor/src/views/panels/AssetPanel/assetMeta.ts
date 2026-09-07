import { useState, useEffect } from 'react';

import { filesystem } from '@xgenia/platform';

import { ProjectModel } from '../../../models/projectmodel';
import { atomicWriteText, createSerializedWriter, salvageJsonObject, type SalvageResult } from './assetMetaStore';
import type { AssetRole } from './assetRoles';

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

/** Where a cut-out piece sits in the art it came from. Mirrors AssetLayoutProvenance in
 *  private/xgenia-ai/.../utils/art-layout.ts; lifted to the top level so a hand-made asset
 *  can carry lineage too, not only one the splitter produced. */
export interface AssetLineage {
  sourcePath: string;
  rootPath: string;
  box: { x: number; y: number; width: number; height: number };
  boxInRoot: { x: number; y: number; width: number; height: number };
  canvasInRoot: { x: number; y: number; width: number; height: number };
  depth: number;
  layerName?: string | null;
  zIndex?: number | null;
}

/** This asset is a previous version of `of`. `n` is 1-based, oldest first. */
export interface AssetVersionRef {
  of: string;
  n: number;
}

export interface AssetMetaEntry {
  tags?: string[];
  favorite?: boolean;
  /** Stable per-asset id behind `uid://` graph refs, so renames/moves never orphan a
   *  reference (the uid travels with the asset via migrateAssetMeta; the param is unchanged). */
  uid?: string;
  /** Set when the asset was created by the AI (recorded at save time). */
  ai?: AIProvenance;
  /** What this asset IS in the game. See assetRoles.ts for the vocabulary. */
  role?: AssetRole;
  /** True when `role` was guessed by the scanner rather than authored. An authored role
   *  clears this, and the scanner must never overwrite a role without it. */
  roleInferred?: boolean;
  /** Present on a non-live historic file. Absent on the live asset. */
  version?: AssetVersionRef;
  /** Explicitly false marks a superseded file. Absent means live. */
  live?: boolean;
  /** Where this piece was cut from, when it was. */
  lineage?: AssetLineage;
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

/** One writer for the whole module: bursts coalesce, writes never overlap, each write is
 *  tmp + rename. The path travels with the snapshot so a project switch mid-burst can never
 *  write project B's cache into project A's file. (2026-09-07, export 1788803211511: the
 *  scanner's per-asset commits issued 17 overlapping writeFile calls and tore the file;
 *  see assetMetaStore.ts.) */
const writer = createSerializedWriter<{ path: string; text: string }>(
  ({ path, text }) => atomicWriteText(filesystem, path, text),
  (e) => console.warn('[assetMeta] save failed', e)
);

/** Resolves when every scheduled write has landed. */
export function flushAssetMeta(): Promise<void> {
  return writer.idle();
}

/** Keep the bytes of a file we could not fully parse next to it, and say so loudly. */
async function quarantineCorruptMeta(p: string, raw: string, s: SalvageResult): Promise<string | null> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = `${p}.corrupt-${stamp}`;
  try {
    await filesystem.writeFile(backup, raw);
  } catch (e) {
    console.error('[assetMeta] could not back up the corrupt metadata file', e);
    return null;
  }
  const count = Object.keys(s.value).length;
  const recovered =
    s.status === 'salvaged'
      ? `Recovered ${count} entr${count === 1 ? 'y' : 'ies'} from its valid prefix (${s.validPrefixChars} chars); anything written after that is lost.`
      : 'Nothing could be recovered from it.';
  console.error(
    `[assetMeta] ${META_FILENAME} is not valid JSON (${s.error}). ${recovered} The original bytes are kept at ${backup}.`
  );
  return backup;
}

/** Load (once per project). Re-loads if the open project changed.
 *
 *  A file that does not parse is NOT an empty project. This used to `JSON.parse` and fall
 *  through to `{}` on failure, and the next commit then rewrote the whole file from that
 *  empty cache — every AI record, split rectangle, authored role and uid gone. Now the
 *  longest valid prefix is adopted (a torn file's prefix is a complete earlier snapshot),
 *  the raw bytes are kept beside the file, and the salvaged snapshot is written back. */
export async function loadAssetMeta(): Promise<void> {
  const root = projectRoot();
  if (loadedRoot === root && !loadingPromise) return;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    let next: MetaMap = {};
    let rewrite = false;
    try {
      const p = metaPath();
      if (p && filesystem.exists(p)) {
        const raw = await filesystem.readFile(p);
        const s = salvageJsonObject(raw);
        next = s.value as MetaMap;
        if (s.status === 'salvaged' || s.status === 'unrecoverable') {
          await quarantineCorruptMeta(p, raw, s);
          rewrite = s.status === 'salvaged';
        }
      }
    } catch (e) {
      console.warn('[assetMeta] load failed', e);
    } finally {
      cache = next;
      loadedRoot = root;
      loadingPromise = null;
      notify();
    }
    // Put the salvaged snapshot back on disk as valid JSON so the salvage is not repeated on
    // every open. After `finally`, so a write failure cannot leave loadingPromise stuck.
    if (rewrite) await persist();
  })();
  return loadingPromise;
}

async function persist(): Promise<void> {
  const p = metaPath();
  if (!p) return;
  return writer.schedule({ path: p, text: JSON.stringify(cache, null, 2) });
}

export function getAssetMeta(path: string): AssetMetaEntry {
  return cache[path] || {};
}

export function getAllTags(): string[] {
  const s = new Set<string>();
  for (const k in cache) (cache[k].tags || []).forEach((t) => s.add(t));
  return Array.from(s).sort((a, b) => a.localeCompare(b));
}

/** Keep the file tidy: an entry carrying no information at all is removed entirely.
 *  Every field that can stand alone MUST be listed here — an omission silently deletes
 *  user or AI data on the next unrelated write to the same asset. Guarded by
 *  tests/assets/assetMetaKeepRule.test.ts. */
function commit(path: string, entry: AssetMetaEntry): Promise<void> {
  const hasTags = !!(entry.tags && entry.tags.length > 0);
  const isEmpty =
    !hasTags &&
    !entry.favorite &&
    !entry.ai &&
    !entry.uid &&
    !entry.role &&
    !entry.version &&
    !entry.lineage &&
    entry.live === undefined;
  if (isEmpty) delete cache[path];
  else cache[path] = entry;
  notify();
  return persist();
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
  await commit(path, { ...getAssetMeta(path), ai });
}

/**
 * Merge an arbitrary patch into an asset's entry (called by the editor bridge when the AI
 * saves an asset). Loads from disk first so existing tags/favorites survive, then merges,
 * persists and notifies.
 *
 * WHY THIS EXISTS: the bridge previously called recordAssetProvenance, which writes ONLY
 * `ai`. Every other field the caller sent — tags, and now role, version and lineage — was
 * accepted by the handler, reported as written, and silently dropped.
 *
 * A `role` arriving from a caller is AUTHORED, so it clears `roleInferred`: the scanner
 * must not later overwrite a role the AI or the user deliberately chose.
 */
export async function mergeAssetMeta(path: string, patch: Partial<AssetMetaEntry>): Promise<void> {
  await loadAssetMeta();
  const next: AssetMetaEntry = { ...getAssetMeta(path), ...patch };
  if (patch.role !== undefined && patch.roleInferred === undefined) next.roleInferred = false;
  await commit(path, next);
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
