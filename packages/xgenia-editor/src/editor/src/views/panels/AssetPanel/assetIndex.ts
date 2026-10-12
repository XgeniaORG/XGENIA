// The project's asset index: one entry per live asset, carrying what it IS (role), where it
// came from (lineage, provenance), what it used to be (versions) and whether the game uses it.
//
// buildIndex is PURE — it takes the file list, the .trash list, the stored metadata and the
// graph's reference sets, and returns the index plus the set of entries whose stored metadata
// is now out of date. The caller decides whether to persist. That keeps every rule here
// testable without a project, a filesystem or React.

import { classifyAssetType } from './asset-classification';
import { inferRole, BUILT_IN_ROLES, type AssetRole } from './assetRoles';
import { deriveTrashVersions, splitVersionSibling } from './assetVersions';
import { resolvePlacement, type AssetSpriteSettings, type ResolvedPlacement } from './assetPlacement';
import type { AssetLineage, AssetMetaEntry } from './assetMeta';

/** A previous version of a live asset. */
export interface IndexedVersion {
  /** 1-based, oldest first. */
  n: number;
  /** Where the bytes are: a path under `.trash/`, or a project-relative `.vN` sibling. */
  path: string;
  source: 'trash' | 'file';
  /** ms epoch, 0 when unknown (a `.vN` sibling carries no timestamp in its name). */
  timestamp: number;
  /** The split rectangle this version's own record carries, if any. */
  layout?: AssetLineage;
  /** What made this version, from its own record. */
  ai?: AssetMetaEntry['ai'];
}

export interface IndexedAsset {
  path: string;
  name: string;
  extension: string;
  kind: ReturnType<typeof classifyAssetType>;
  role: AssetRole;
  /** True when `role` is the scanner's guess and the user has not corrected it. */
  roleInferred: boolean;
  uid?: string;
  tags: string[];
  favorite: boolean;
  ai?: AssetMetaEntry['ai'];
  lineage?: AssetLineage;
  /** Oldest first. Empty when the asset has no recorded history. */
  versions: IndexedVersion[];
  /** True when some node-graph parameter references this asset by path or by uid. */
  used: boolean;
  /** Where it goes on the target screen: authored, else from the split. null when unknown. */
  placement: ResolvedPlacement | null;
  /**
   * A placement the live file lost but an earlier version still carries. Offered, never applied:
   * the new pixels may be a different cut. (Re-saves used to move the whole record into .trash.)
   */
  previousPlacement: { versionPath: string; layout: AssetLineage } | null;
  sprite?: AssetSpriteSettings;
  /** Live assets cut out of this one. */
  pieces: string[];
  /** Bytes, when the scan could stat the file. */
  size?: number;
  /** ms epoch of the last write, when the scan could stat the file. */
  mtime?: number;
}

export interface AssetIndex {
  assets: IndexedAsset[];
  byPath: Map<string, IndexedAsset>;
  /** Entries whose stored metadata differs from what the scan derived. */
  pendingWrites: Map<string, Partial<AssetMetaEntry>>;
  /** Paths that still need a uid assigned. The caller owns uid uniqueness. */
  needsUid: Set<string>;
}

export interface BuildIndexInput {
  /** Project-relative paths of every file under `assets/`. */
  filePaths: string[];
  /** Filenames directly inside `<project>/.trash`. */
  trashNames: string[];
  /** The parsed `.xgenia-assets.json`, keyed by project-relative path. */
  meta: Record<string, AssetMetaEntry>;
  /** Raw path values found in node-graph parameters. */
  referencedPaths: Set<string>;
  /** uids found in `uid://` node-graph parameters. */
  referencedUids: Set<string>;
  /** Optional per-path file stats. */
  stats?: Map<string, { size: number; mtime: number }>;
}

export function buildIndex(input: BuildIndexInput): AssetIndex {
  const { filePaths, trashNames, meta, referencedPaths, referencedUids } = input;
  const allFiles = new Set(filePaths);

  // 1. Split `.vN` siblings out of the live set. They are history, not assets in their own
  //    right, and listing them as peers is exactly the clutter this panel exists to remove.
  const livePaths: string[] = [];
  const siblingVersions = new Map<string, IndexedVersion[]>();
  for (const path of filePaths) {
    const sibling = splitVersionSibling(path);
    if (sibling && allFiles.has(sibling.of)) {
      const list = siblingVersions.get(sibling.of) || [];
      list.push({ n: sibling.n, path, source: 'file', timestamp: 0 });
      siblingVersions.set(sibling.of, list);
    } else {
      livePaths.push(path);
    }
  }

  // 2. Recover history from `.trash`.
  const trashVersions = deriveTrashVersions(trashNames, livePaths);

  const assets: IndexedAsset[] = [];
  const byPath = new Map<string, IndexedAsset>();
  const pendingWrites = new Map<string, Partial<AssetMetaEntry>>();
  const needsUid = new Set<string>();

  for (const path of livePaths) {
    const stored: AssetMetaEntry = meta[path] || {};
    const name = path.split('/').pop() || path;
    const extension = (name.includes('.') ? name.split('.').pop() || '' : '').toLowerCase();
    const kind = classifyAssetType(extension);

    // ai.layout is the splitter's record and is rewritten on every split and every edit. The
    // top-level `lineage` was only ever a snapshot COPY of it made by this scanner, so it goes
    // stale the moment a piece is re-cut. The live record wins; a copy is read only when it is
    // all there is. A person's own position lives in `placement`, not here.
    const lineage: AssetLineage | undefined =
      (stored.ai as { layout?: AssetLineage } | undefined)?.layout ?? stored.lineage ?? undefined;

    // An authored role is final. A role still flagged inferred is re-derived, so an asset
    // indexed before its lineage was known picks up the better answer later.
    let role: AssetRole;
    let roleInferred: boolean;
    if (stored.role && stored.roleInferred === false) {
      role = stored.role;
      roleInferred = false;
    } else {
      role = inferRole({
        path,
        kind,
        lineage: lineage
          ? {
              depth: lineage.depth,
              layerName: lineage.layerName ?? null,
              boxInRoot: lineage.boxInRoot,
              canvasInRoot: lineage.canvasInRoot
            }
          : undefined
      }).role;
      roleInferred = true;
    }

    const versions = [
      ...(trashVersions.get(path) || []).map((v) => ({
        n: v.n,
        path: `.trash/${v.trashName}`,
        source: 'trash' as const,
        timestamp: v.timestamp
      })),
      ...(siblingVersions.get(path) || [])
    ]
      .sort((a, b) => a.n - b.n || a.timestamp - b.timestamp)
      .map((v): IndexedVersion => {
        const row = meta[v.path];
        const layout = (row?.ai as { layout?: AssetLineage } | undefined)?.layout ?? row?.lineage;
        return { ...v, ...(layout ? { layout } : {}), ...(row?.ai ? { ai: row.ai } : {}) };
      });

    const used = referencedPaths.has(path) || (!!stored.uid && referencedUids.has(stored.uid));
    const placement = resolvePlacement({ placement: stored.placement, lineage });

    let previousPlacement: IndexedAsset['previousPlacement'] = null;
    if (!placement) {
      for (let i = versions.length - 1; i >= 0; i--) {
        const layout = versions[i].layout;
        if (layout && resolvePlacement({ lineage: layout })) {
          previousPlacement = { versionPath: versions[i].path, layout };
          break;
        }
      }
    }
    const stat = input.stats?.get(path);

    const asset: IndexedAsset = {
      path,
      name,
      extension,
      kind,
      role,
      roleInferred,
      uid: stored.uid,
      tags: stored.tags || [],
      favorite: !!stored.favorite,
      ai: stored.ai,
      lineage,
      versions,
      used,
      placement,
      previousPlacement,
      ...(stored.sprite ? { sprite: stored.sprite } : {}),
      pieces: [],
      ...(stat ? { size: stat.size, mtime: stat.mtime } : {})
    };
    assets.push(asset);
    byPath.set(path, asset);

    // 3. What needs writing back. Only ever inferred data: authored fields are never
    //    touched by the scanner.
    const patch: Partial<AssetMetaEntry> = {};
    if (stored.role !== role || stored.roleInferred !== roleInferred) {
      patch.role = role;
      patch.roleInferred = roleInferred;
    }
    if (Object.keys(patch).length > 0) pendingWrites.set(path, patch);
    if (!stored.uid) needsUid.add(path);
  }

  for (const asset of assets) {
    const source = asset.lineage?.sourcePath;
    if (source && source !== asset.path) byPath.get(source)?.pieces.push(asset.path);
  }

  return { assets, byPath, pendingWrites, needsUid };
}

/** Roles actually present, built-ins in vocabulary order first, then custom roles sorted. */
export function rolesInIndex(index: AssetIndex): string[] {
  const present = new Set(index.assets.map((a) => a.role));
  const builtIn = (BUILT_IN_ROLES as readonly string[]).filter((r) => present.has(r));
  const custom = [...present]
    .filter((r) => !(BUILT_IN_ROLES as readonly string[]).includes(r))
    .sort();
  return [...builtIn, ...custom];
}

/** How many assets carry each role. Drives the role-strip counts. */
export function roleCounts(index: AssetIndex): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const a of index.assets) counts[a.role] = (counts[a.role] || 0) + 1;
  return counts;
}
