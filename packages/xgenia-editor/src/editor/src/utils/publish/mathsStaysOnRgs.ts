/**
 * The maths stays on the RGS. (2026-10-05, Spin Cycle)
 *
 * A published game's Math Component instances are swapped for Aggregators that call the deployed script
 * on XGENIA RGS — but the components themselves still went into the web build, one public bundle each
 * (xgenia_bundles/<id>.json): the symbol weights, the reel-strip seeds, the paytable formula and the
 * evaluator's whole script, readable by anyone with the link. A Math Component that no node of the
 * publish copy uses any more is removed from the COPY before it is built. One the UI still uses (not
 * deployed: it runs in the player's browser, and the publish says so) stays. The user's project is
 * never touched — this runs on the throwaway copy.
 */
const MATHS_PREFIX = '/#__maths__/';

type ProjectLike = { components?: any[]; removeComponent?: (component: any) => void };

/** Removes, from `copy`, every Math Component nothing in it uses. Returns their names. */
export function dropUnusedMathsComponents(copy: ProjectLike): string[] {
  const dropped: string[] = [];
  if (!copy || typeof copy.removeComponent !== 'function') return dropped;
  const usesOf = (comp: any): Set<string> => {
    const out = new Set<string>();
    const walk = (n: any) => {
      if (n?.typename) out.add(String(n.typename));
      (n?.children || []).forEach(walk);
    };
    (comp?.graph?.roots || []).forEach(walk);
    return out;
  };
  // Until nothing changes: a Math Component used only by another that goes, goes too.
  for (let changed = true; changed; ) {
    changed = false;
    const components = [...(copy.components || [])];
    const used = new Set<string>();
    for (const c of components) for (const t of usesOf(c)) if (t !== c?.name) used.add(t);
    for (const c of components) {
      const name = String(c?.name || '');
      if (!name.startsWith(MATHS_PREFIX) || used.has(name)) continue;
      copy.removeComponent!(c);
      dropped.push(name);
      changed = true;
    }
  }
  return dropped;
}
