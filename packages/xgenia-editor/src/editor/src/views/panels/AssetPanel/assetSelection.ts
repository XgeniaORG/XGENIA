// Multi-selection over the visible, ordered asset list — the Finder / Unity project-window model.
// Pure so the click rules are testable.

export interface AssetSelection {
  paths: Set<string>;
  /** Where a shift-click range starts. Stays put across shift-clicks. */
  anchor: string | null;
  /** The item keyboard navigation moves from and the inspector shows. */
  focus: string | null;
}

export const EMPTY_SELECTION: AssetSelection = { paths: new Set(), anchor: null, focus: null };

export function selectionClick(
  sel: AssetSelection,
  path: string,
  mods: { toggle?: boolean; range?: boolean },
  order: string[]
): AssetSelection {
  if (mods.range && sel.anchor && order.includes(sel.anchor) && order.includes(path)) {
    const a = order.indexOf(sel.anchor);
    const b = order.indexOf(path);
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const paths = new Set(mods.toggle ? sel.paths : []);
    for (let i = lo; i <= hi; i++) paths.add(order[i]);
    return { paths, anchor: sel.anchor, focus: path };
  }
  if (mods.toggle) {
    const paths = new Set(sel.paths);
    if (paths.has(path)) {
      paths.delete(path);
      const focus = sel.focus === path ? [...paths].pop() ?? null : sel.focus;
      return { paths, anchor: path, focus };
    }
    paths.add(path);
    return { paths, anchor: path, focus: path };
  }
  return { paths: new Set([path]), anchor: path, focus: path };
}

export function selectAll(order: string[]): AssetSelection {
  return { paths: new Set(order), anchor: order[0] ?? null, focus: order[0] ?? null };
}

/** Drop paths that no longer exist (after a delete, a rename, a rescan). */
export function pruneSelection(sel: AssetSelection, existing: Set<string>): AssetSelection {
  const paths = new Set([...sel.paths].filter((p) => existing.has(p)));
  if (paths.size === sel.paths.size && (!sel.anchor || existing.has(sel.anchor))) return sel;
  return {
    paths,
    anchor: sel.anchor && existing.has(sel.anchor) ? sel.anchor : null,
    focus: sel.focus && existing.has(sel.focus) ? sel.focus : [...paths].pop() ?? null
  };
}

/** Arrow-key movement within a grid of `columns` (1 for a list). */
export function moveFocus(order: string[], focus: string | null, key: string, columns: number): string | null {
  if (order.length === 0) return null;
  const i = focus ? order.indexOf(focus) : -1;
  if (i < 0) return order[0];
  const step: Record<string, number> = {
    ArrowLeft: -1,
    ArrowRight: 1,
    ArrowUp: -Math.max(1, columns),
    ArrowDown: Math.max(1, columns),
    Home: -Infinity,
    End: Infinity
  };
  const d = step[key];
  if (d === undefined) return focus;
  const next = Math.max(0, Math.min(order.length - 1, i + (Number.isFinite(d) ? d : d > 0 ? order.length : -order.length)));
  return order[next];
}
