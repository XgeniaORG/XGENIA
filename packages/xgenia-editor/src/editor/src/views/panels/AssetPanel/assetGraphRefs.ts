import { ProjectModel } from '../../../models/projectmodel';
import { getAssetUid, buildUidToPathMap } from './assetMeta';

/**
 * When an asset is renamed or moved, node-graph parameters that referenced the old path
 * (e.g. a pixi.Sprite's `image` param, set when the asset was dragged onto the canvas)
 * would otherwise orphan and the sprite would fail to load. This walks every component's
 * graph and rewrites string parameter values that EXACTLY match the old path, or that
 * live UNDER it (so a folder rename carries every descendant reference). Returns the
 * number of references updated.
 *
 * This is the SAFE subset of "stable references": it keeps raw paths, so there is no
 * save-format change, no migration, and no runtime/viewer change — only the in-memory
 * graph of the open project is touched, and the rewrite persists on the next save via
 * setParameter()'s normal change notification. (Full `uid://` indirection is a separate,
 * format-changing phase.)
 */
export function reconcileGraphAssetRefs(oldRel: string, newRel: string): number {
  if (!oldRel || !newRel || oldRel === newRel) return 0;

  const pm = ProjectModel.instance;
  if (!pm || !Array.isArray(pm.components)) return 0;

  const prefix = oldRel + '/';
  let updated = 0;

  for (const comp of pm.components) {
    const graph: any = (comp as any)?.graph;
    if (!graph || typeof graph.forEachNodeRecursive !== 'function') continue;

    graph.forEachNodeRecursive((node: any) => {
      const params = node?.parameters;
      if (!params) return;
      for (const key of Object.keys(params)) {
        const val = params[key];
        if (typeof val !== 'string') continue;

        let next: string | null = null;
        if (val === oldRel) next = newRel;
        else if (val.startsWith(prefix)) next = newRel + '/' + val.slice(prefix.length);

        if (next !== null) {
          try {
            if (typeof node.setParameter === 'function') node.setParameter(key, next);
            else params[key] = next;
          } catch {
            params[key] = next;
          }
          updated++;
        }
      }
    });
  }

  return updated;
}

export interface AssetReference {
  component: string;
  node: string;
  paramKey: string;
}

function nodeLabel(node: any): string {
  try {
    if (node?.label && typeof node.label === 'string') return node.label;
  } catch {
    /* label getter can throw if the type is unresolved */
  }
  return node?.typename || node?.type?.name || 'Node';
}

/**
 * Find every node-graph parameter that references the given asset path (exact match, or a
 * descendant under it for a folder). Powers the Inspector's "Used by" section.
 */
export function getAssetReferences(rel: string): AssetReference[] {
  const out: AssetReference[] = [];
  if (!rel) return out;

  const pm = ProjectModel.instance;
  if (!pm || !Array.isArray(pm.components)) return out;

  const prefix = rel + '/';
  // An asset may be referenced by its raw path OR by a `uid://<id>` stable ref.
  const uid = getAssetUid(rel);
  const uidRef = uid ? `uid://${uid}` : null;

  for (const comp of pm.components) {
    const graph: any = (comp as any)?.graph;
    if (!graph || typeof graph.forEachNodeRecursive !== 'function') continue;

    graph.forEachNodeRecursive((node: any) => {
      const params = node?.parameters;
      if (!params) return;
      for (const key of Object.keys(params)) {
        const val = params[key];
        if (typeof val !== 'string') continue;
        if (val === rel || val.startsWith(prefix) || (uidRef && val === uidRef)) {
          out.push({ component: (comp as any)?.name || 'Component', node: nodeLabel(node), paramKey: key });
        }
      }
    });
  }

  return out;
}

/**
 * Collect every string parameter value across all graphs that looks like an asset path
 * reference. Used to compute "unused" assets (a file asset whose path is in no graph).
 */
export function getReferencedAssetPaths(): Set<string> {
  const set = new Set<string>();

  const pm = ProjectModel.instance;
  if (!pm || !Array.isArray(pm.components)) return set;

  // Resolve `uid://<id>` refs back to the current path so the set holds real asset paths
  // (otherwise a uid-referenced asset would falsely read as "unused").
  const uidToPath = buildUidToPathMap();

  for (const comp of pm.components) {
    const graph: any = (comp as any)?.graph;
    if (!graph || typeof graph.forEachNodeRecursive !== 'function') continue;

    graph.forEachNodeRecursive((node: any) => {
      const params = node?.parameters;
      if (!params) return;
      for (const key of Object.keys(params)) {
        const val = params[key];
        if (typeof val !== 'string') continue;
        if (val.indexOf('uid://') === 0) {
          const p = uidToPath[val.slice(6)];
          if (p) set.add(p);
        } else if (val.includes('/') || /\.[a-z0-9]{2,5}$/i.test(val)) {
          set.add(val);
        }
      }
    });
  }

  return set;
}
