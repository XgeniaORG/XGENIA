// Reading asset references out of node graphs.
//
// Deliberately DEPENDENCY-FREE: it takes the components array instead of reaching for
// ProjectModel, so it can be unit-tested. assetGraphRefs.ts, which does the same job for the
// old panel, imports ProjectModel and therefore drags in NodeLibrary, which touches `window`
// and cannot be loaded outside a browser at all.

export interface GraphAssetRefs {
  /** Raw `assets/...` values found in node parameters. */
  paths: Set<string>;
  /** Ids found in `uid://<id>` parameters. */
  uids: Set<string>;
}

/**
 * Every asset reference in a set of components, split into raw paths and `uid://` ids.
 *
 * A parameter getter can throw when a node's type is unresolved, which is normal in a
 * half-loaded project, so each node is walked defensively: one bad node must not silently
 * truncate the reference set and make every remaining asset read as unused.
 *
 * Only `assets/`-prefixed values count as paths. The older `getReferencedAssetPaths` accepts
 * anything containing a slash or an extension-looking suffix, which also sweeps in remote
 * URLs — harmless for its "is anything using this" question, wrong for an index that tells
 * the user which nodes use an asset.
 */
export function collectGraphRefs(components: unknown[]): GraphAssetRefs {
  const paths = new Set<string>();
  const uids = new Set<string>();
  if (!Array.isArray(components)) return { paths, uids };

  for (const comp of components) {
    const graph: any = (comp as any)?.graph;
    if (!graph || typeof graph.forEachNodeRecursive !== 'function') continue;
    try {
      graph.forEachNodeRecursive((node: any) => {
        let params: Record<string, unknown> | undefined;
        try {
          params = node?.parameters;
        } catch {
          return; // unresolved node type — skip it, never abort the walk
        }
        if (!params) return;
        for (const key of Object.keys(params)) {
          const val = params[key];
          if (typeof val !== 'string' || !val) continue;
          if (val.startsWith('uid://')) {
            const id = val.slice('uid://'.length).trim();
            if (id) uids.add(id);
          } else if (val.startsWith('assets/')) {
            paths.add(val);
          }
        }
      });
    } catch {
      // A whole graph that refuses to walk is skipped; the rest still counts.
    }
  }
  return { paths, uids };
}

/**
 * Should graph parameters holding `oldRel` be rewritten to `newRel`? A rename or a move, yes. A
 * move into `.trash` is a deletion (or an overwrite's backup), and following it re-points every
 * sprite at the discarded bytes — so never.
 */
export function shouldFollowInGraph(oldRel: string, newRel: string): boolean {
  if (!oldRel || !newRel || oldRel === newRel) return false;
  const target = newRel.replace(/^\/+/, '');
  return !(target === '.trash' || target.startsWith('.trash/'));
}

export interface GraphRefEntry {
  component: string;
  node: string;
  key: string;
  value: string;
  componentModel: unknown;
  nodeModel: any;
}

/** Every asset-looking parameter value, with where it lives — for finding and fixing broken refs. */
export function collectGraphRefEntries(components: unknown[]): GraphRefEntry[] {
  const out: GraphRefEntry[] = [];
  if (!Array.isArray(components)) return out;
  for (const comp of components) {
    const graph: any = (comp as any)?.graph;
    if (!graph || typeof graph.forEachNodeRecursive !== 'function') continue;
    try {
      graph.forEachNodeRecursive((node: any) => {
        let params: Record<string, unknown> | undefined;
        try {
          params = node?.parameters;
        } catch {
          return;
        }
        if (!params) return;
        for (const key of Object.keys(params)) {
          const value = params[key];
          if (typeof value !== 'string') continue;
          if (!(value.startsWith('assets/') || value.startsWith('uid://') || value.startsWith('.trash/'))) continue;
          let label = 'Node';
          try {
            label = node?.label || node?.type?.name || 'Node';
          } catch {
            /* unresolved type */
          }
          out.push({ component: (comp as any)?.name || 'Component', node: label, key, value, componentModel: comp, nodeModel: node });
        }
      });
    } catch {
      /* skip a graph that will not walk */
    }
  }
  return out;
}

export interface BrokenRef extends GraphRefEntry {
  reason: 'missing' | 'unknown-uid' | 'in-trash';
  /** A live asset this most likely meant, when exactly one candidate exists. */
  suggestion?: string;
}

const TRASH_NAME = /^(.*)\.(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)(\.[^.]+)$/;

/**
 * References that render nothing: a path with no file, a uid no asset has, a uid whose file is
 * gone, or a path into `.trash`. Suggests a relink only when there is exactly one candidate: the
 * live file a trashed copy was a version of, or a unique file with the same name elsewhere (a file
 * moved outside the editor).
 */
export function findBrokenRefs(
  entries: GraphRefEntry[],
  livePaths: Set<string>,
  uidToPath: Record<string, string>,
  /** The last word on "missing": the scan skips some folders (build, dist, deep trees), the disk does not. */
  existsOnDisk: (relPath: string) => boolean = () => false
): BrokenRef[] {
  const present = (p: string) => livePaths.has(p) || existsOnDisk(p);
  const byName = new Map<string, string[]>();
  for (const p of livePaths) {
    const name = (p.split('/').pop() || '').toLowerCase();
    byName.set(name, [...(byName.get(name) || []), p]);
  }
  const unique = (name: string) => {
    const hits = byName.get(name.toLowerCase()) || [];
    return hits.length === 1 ? hits[0] : undefined;
  };

  const out: BrokenRef[] = [];
  for (const e of entries) {
    if (e.value.startsWith('uid://')) {
      const path = uidToPath[e.value.slice(6)];
      if (!path) out.push({ ...e, reason: 'unknown-uid' });
      else if (!present(path)) out.push({ ...e, reason: 'missing', suggestion: unique(path.split('/').pop() || '') });
    } else if (e.value.startsWith('.trash/')) {
      const file = e.value.slice('.trash/'.length);
      const m = TRASH_NAME.exec(file);
      let suggestion: string | undefined;
      if (m) {
        const baseName = `${m[1]}${m[3]}`;
        // `<folder_slug>_<name>`: the candidate whose slugged path equals the head.
        const bySlug = [...livePaths].filter((p) => p.replace(/\//g, '_').replace(/\.[^.]+$/, '') === m[1] && p.endsWith(m[3]));
        suggestion = bySlug.length === 1 ? bySlug[0] : unique(baseName);
      }
      out.push({ ...e, reason: 'in-trash', suggestion });
    } else if (!present(e.value)) {
      out.push({ ...e, reason: 'missing', suggestion: unique(e.value.split('/').pop() || '') });
    }
  }
  return out;
}
