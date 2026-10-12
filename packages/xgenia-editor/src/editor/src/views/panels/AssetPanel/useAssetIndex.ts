import { useCallback, useEffect, useRef, useState } from 'react';

import { filesystem } from '@xgenia/platform';

import { ProjectModel } from '../../../models/projectmodel';
import { EventDispatcher } from '../../../../../shared/utils/EventDispatcher';

import { buildIndex, type AssetIndex } from './assetIndex';
import { collectGraphRefs } from './graphRefs';
import {
  loadAssetMeta,
  getAssetMeta,
  getOrAssignUid,
  mergeAssetMeta,
  subscribeAssetMeta,
  type AssetMetaEntry
} from './assetMeta';
import { loadProjectScreen, type ProjectScreen } from './projectScreen';

/** Size and mtime for each file. Best-effort: a file that cannot be stat'ed simply has none. */
async function statFiles(root: string, paths: string[]): Promise<Map<string, { size: number; mtime: number }>> {
  const out = new Map<string, { size: number; mtime: number }>();
  let fsp: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    fsp = require('fs').promises;
  } catch {
    return out;
  }
  await Promise.all(
    paths.map(async (p) => {
      try {
        const st = await fsp.stat(filesystem.join(root, p));
        out.set(p, { size: st.size, mtime: st.mtimeMs });
      } catch {
        /* vanished between list and stat */
      }
    })
  );
  return out;
}

export type AssetIndexStatus = 'loading' | 'ok' | 'error';

export interface AssetIndexState {
  index: AssetIndex | null;
  status: AssetIndexStatus;
  error: string | null;
  /** Why the last scan ran, shown in the panel so a stale view is explicable. */
  lastReason: string;
  lastRunAt: number;
  /** Every folder under assets/, including empty ones. */
  folders: string[];
  /** The target screen placements resolve against; null when the project has not declared one. */
  screen: ProjectScreen | null;
  refresh: (reason: string) => void;
}

/**
 * The one refresh path for the asset index.
 *
 * Every trigger — project open, an AI write reported over the bridge, a metadata edit —
 * runs THIS. Two components running two different walks is how the old browser came to
 * disagree with itself about what existed.
 *
 * Failure is a STATE, never a silent empty list. "No assets" and "could not look" mean
 * opposite things to someone deciding whether to regenerate art they already have, so the
 * panel is given the difference and must render it.
 */
export function useAssetIndex(): AssetIndexState {
  const [index, setIndex] = useState<AssetIndex | null>(null);
  const [status, setStatus] = useState<AssetIndexStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [lastReason, setLastReason] = useState('open');
  const [lastRunAt, setLastRunAt] = useState(0);
  const [folders, setFolders] = useState<string[]>([]);
  const [screen, setScreen] = useState<ProjectScreen | null>(null);

  const runningRef = useRef(false);
  const queuedRef = useRef<string | null>(null);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const run = useCallback(async (reason: string): Promise<void> => {
    // Coalesce: one AI turn writes a burst of files, and a full walk per file thrashes a
    // panel that lists the whole project. The last reason wins.
    if (runningRef.current) {
      queuedRef.current = reason;
      return;
    }
    runningRef.current = true;

    try {
      const pm = ProjectModel.instance;
      const root = pm?._retainedProjectDirectory ? String(pm._retainedProjectDirectory) : null;
      if (!pm || !root) {
        if (aliveRef.current) {
          setIndex(null);
          setStatus('ok');
          setError(null);
        }
        return;
      }

      await loadAssetMeta();

      const rootNorm = root.replace(/\\/g, '/').replace(/\/+$/, '');
      const folderPaths: string[] = [];
      const filePaths = await new Promise<string[]>((resolve, reject) => {
        try {
          pm.listProjectAssets((files: any[]) => {
            const out: string[] = [];
            for (const f of files || []) {
              if (!f || !f.fullPath) continue;
              let rel = String(f.fullPath).replace(/\\/g, '/');
              if (rel.startsWith(rootNorm + '/')) rel = rel.slice(rootNorm.length + 1);
              if (!rel) continue;
              if (f.isDirectory) folderPaths.push(rel);
              else out.push(rel);
            }
            resolve(out);
          });
        } catch (e) {
          reject(e);
        }
      });

      // `.trash` is read for history and NEVER written here: it is also the undo buffer for
      // the AI's manage_asset delete. Losing the history is a smaller failure than losing
      // the index, so this is best-effort.
      let trashNames: string[] = [];
      try {
        const trashDir = filesystem.join(rootNorm, '.trash');
        if (filesystem.exists(trashDir)) {
          const listed = await filesystem.listDirectory(trashDir);
          trashNames = (listed || []).filter((e) => e && !e.isDirectory).map((e) => e.name).filter(Boolean);
        }
      } catch (e) {
        console.warn('[assetIndex] .trash unreadable, version history omitted', e);
      }

      const refs = collectGraphRefs(Array.isArray(pm.components) ? pm.components : []);

      // .trash rows are read too: they carry the placement a re-save used to strip from the live
      // file, which the index offers back.
      const meta: Record<string, AssetMetaEntry> = {};
      for (const p of filePaths) meta[p] = getAssetMeta(p);
      for (const n of trashNames) meta[`.trash/${n}`] = getAssetMeta(`.trash/${n}`);

      const [stats, projectScreen] = await Promise.all([
        statFiles(rootNorm, filePaths),
        loadProjectScreen().catch(() => null)
      ]);

      const built = buildIndex({
        filePaths,
        trashNames,
        meta,
        referencedPaths: refs.paths,
        referencedUids: refs.uids,
        stats
      });

      // Persist what the scan derived: inferred roles and promoted lineage only. An authored
      // field is never in pendingWrites, so this cannot overwrite a user's choice.
      for (const [path, patch] of built.pendingWrites) {
        // roleInferred travels with role so mergeAssetMeta does not read this as authored.
        await mergeAssetMeta(path, patch);
      }

      // getOrAssignUid owns uniqueness and self-guards against an unloaded cache, so it is
      // the only uid writer in the codebase.
      for (const path of built.needsUid) {
        const uid = getOrAssignUid(path);
        const asset = built.byPath.get(path);
        if (asset && uid) asset.uid = uid;
      }

      if (aliveRef.current) {
        setIndex(built);
        setFolders(folderPaths);
        setScreen(projectScreen);
        setStatus('ok');
        setError(null);
      }
    } catch (e: any) {
      console.error('[assetIndex] scan failed', e);
      if (aliveRef.current) {
        setError(e?.message || 'Failed to read project assets');
        setStatus('error');
      }
    } finally {
      if (aliveRef.current) {
        setLastReason(reason);
        setLastRunAt(Date.now());
      }
      runningRef.current = false;
      const queued = queuedRef.current;
      queuedRef.current = null;
      if (queued) void run(queued);
    }
  }, []);

  const refresh = useCallback((reason: string) => void run(reason), [run]);

  useEffect(() => {
    void run('open');
  }, [run]);

  // The bridge emits this after every AI-driven write. Debounced for the same reason the
  // in-run coalescing exists: one turn can write many files.
  useEffect(() => {
    const group = {};
    let t: ReturnType<typeof setTimeout> | null = null;
    EventDispatcher.instance.on(
      'project-assets-changed',
      () => {
        if (t) clearTimeout(t);
        t = setTimeout(() => {
          t = null;
          void run('ai write');
        }, 300);
      },
      group
    );
    return () => {
      EventDispatcher.instance.off(group);
      if (t) clearTimeout(t);
    };
  }, [run]);

  // Tag, favourite and role edits change the index without touching a file. Debounced so the
  // scanner's OWN writes above do not each trigger another scan.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeAssetMeta(() => {
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        t = null;
        void run('metadata');
      }, 400);
    });
    return () => {
      unsubscribe();
      if (t) clearTimeout(t);
    };
  }, [run]);

  return { index, status, error, lastReason, lastRunAt, folders, screen, refresh };
}
