import { useState, useEffect } from 'react';

import { filesystem } from '@xgenia/platform';

import { ProjectModel } from '../../../models/projectmodel';

// Saved "smart collections" — named snapshots of the panel's filter state (search +
// type kinds + tags + favorites). Project-level (NOT per-asset), stored in one file
// <project>/.xgenia-collections.json, sibling to .xgenia-assets.json and outside the
// scoped assets/ walk. Clicking a collection re-applies its filters.

export interface AssetCollection {
  id: string;
  name: string;
  query?: string;
  kinds?: string[];
  tags?: string[];
  favoritesOnly?: boolean;
}

const FILE = '.xgenia-collections.json';

let cache: AssetCollection[] = [];
let loadedRoot: string | null | undefined = undefined;
let loadingPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function projectRoot(): string | null {
  const root = ProjectModel.instance?._retainedProjectDirectory;
  return root ? String(root) : null;
}

function filePath(): string | null {
  const root = projectRoot();
  return root ? filesystem.join(root, FILE) : null;
}

function notify(): void {
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      /* ignore */
    }
  });
}

export function subscribeCollections(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export async function loadCollections(): Promise<void> {
  const root = projectRoot();
  if (loadedRoot === root && !loadingPromise) return;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    let next: AssetCollection[] = [];
    try {
      const p = filePath();
      if (p && filesystem.exists(p)) {
        const raw = await filesystem.readFile(p);
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) next = parsed;
      }
    } catch (e) {
      console.warn('[collections] load failed', e);
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
  const p = filePath();
  if (!p) return;
  try {
    await filesystem.writeFile(p, JSON.stringify(cache, null, 2));
  } catch (e) {
    console.warn('[collections] save failed', e);
  }
}

export function getCollections(): AssetCollection[] {
  return cache;
}

export function addCollection(c: Omit<AssetCollection, 'id'>): void {
  const id = `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  cache = [...cache, { ...c, id }];
  notify();
  persist();
}

export function removeCollection(id: string): void {
  if (!cache.some((c) => c.id === id)) return;
  cache = cache.filter((c) => c.id !== id);
  notify();
  persist();
}

/** Re-renders the caller when collections change; loads on mount. */
export function useCollectionsVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    loadCollections();
    return subscribeCollections(() => setVersion((n) => n + 1));
  }, []);
  return version;
}
