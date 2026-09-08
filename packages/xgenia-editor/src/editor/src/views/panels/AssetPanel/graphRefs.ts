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
