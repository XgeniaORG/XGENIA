// Pure tree logic for the Hierarchy panel: no editor imports, so it is unit-tested directly
// (packages/xgenia-editor/tests/hierarchy). The panel snapshots the active component's
// NodeGraphModel into `HierarchyItem`s and everything below works on that snapshot.

export interface HierarchyItem {
  id: string;
  label: string;
  /** Short type name, e.g. "Group", "Text", or a component's local name. */
  typeName: string;
  /** A visual node: the preview draws it, so the eye and lock apply to it. */
  isVisual: boolean;
  /** Every child, in model order. Filters are applied when flattening, never here. */
  children: HierarchyItem[];
}

export interface FlatRow {
  id: string;
  depth: number;
  parentId: string | null;
  label: string;
  typeName: string;
  isVisual: boolean;
  /** Has children that survive the current filters, so it draws a caret. */
  hasChildren: boolean;
  isExpanded: boolean;
  /** With a search query: this row matched itself (it is not only an ancestor of a match). */
  isMatch: boolean;
  isHidden: boolean;
  /** An ancestor is hidden — the preview hides the whole subtree with it. */
  isHiddenByAncestor: boolean;
  isLocked: boolean;
}

export interface FlattenOptions {
  expanded: ReadonlySet<string>;
  query?: string;
  /** Leave out nodes that are not visual and have no visual descendant. */
  visualOnly?: boolean;
  hidden?: ReadonlySet<string>;
  locked?: ReadonlySet<string>;
}

interface Kept {
  item: HierarchyItem;
  children: Kept[];
  isMatch: boolean;
}

const EMPTY: ReadonlySet<string> = new Set();

function matches(item: HierarchyItem, q: string): boolean {
  return item.label.toLowerCase().includes(q) || item.typeName.toLowerCase().includes(q);
}

/**
 * The rows the panel draws, in display order. With a query, a row is kept when it or a
 * descendant matches, and every kept row is shown expanded so the matches are visible with
 * their ancestors; the stored expansion is left alone and comes back when the query clears.
 */
export function flattenHierarchy(roots: readonly HierarchyItem[], opts: FlattenOptions): FlatRow[] {
  const q = (opts.query ?? '').trim().toLowerCase();
  const hidden = opts.hidden ?? EMPTY;
  const locked = opts.locked ?? EMPTY;

  const keep = (item: HierarchyItem): Kept | null => {
    const children: Kept[] = [];
    for (const child of item.children) {
      const k = keep(child);
      if (k) children.push(k);
    }
    const passesVisual = !opts.visualOnly || item.isVisual || children.length > 0;
    if (!passesVisual) return null;
    const isMatch = q.length > 0 && matches(item, q);
    if (q.length > 0 && !isMatch && children.length === 0) return null;
    return { item, children, isMatch };
  };

  const rows: FlatRow[] = [];
  const emit = (k: Kept, depth: number, parentId: string | null, ancestorHidden: boolean) => {
    const { item } = k;
    const hasChildren = k.children.length > 0;
    const isExpanded = hasChildren && (q.length > 0 || opts.expanded.has(item.id));
    const isHidden = hidden.has(item.id);
    rows.push({
      id: item.id,
      depth,
      parentId,
      label: item.label,
      typeName: item.typeName,
      isVisual: item.isVisual,
      hasChildren,
      isExpanded,
      isMatch: k.isMatch,
      isHidden,
      isHiddenByAncestor: ancestorHidden,
      isLocked: locked.has(item.id)
    });
    if (isExpanded) {
      for (const c of k.children) emit(c, depth + 1, item.id, ancestorHidden || isHidden);
    }
  };

  for (const root of roots) {
    const k = keep(root);
    if (k) emit(k, 0, null, false);
  }
  return rows;
}

export interface TreeIndexEntry {
  item: HierarchyItem;
  parentId: string | null;
  /** Position among the parent's children, or among the roots. */
  index: number;
}

export function indexTree(roots: readonly HierarchyItem[]): Map<string, TreeIndexEntry> {
  const map = new Map<string, TreeIndexEntry>();
  const walk = (items: readonly HierarchyItem[], parentId: string | null) => {
    items.forEach((item, index) => {
      map.set(item.id, { item, parentId, index });
      walk(item.children, item.id);
    });
  };
  walk(roots, null);
  return map;
}

/** Ancestor ids of `id`, nearest first. Empty for a root or an unknown id. */
export function ancestorIds(index: ReadonlyMap<string, TreeIndexEntry>, id: string): string[] {
  const out: string[] = [];
  let parentId = index.get(id)?.parentId ?? null;
  while (parentId !== null) {
    out.push(parentId);
    parentId = index.get(parentId)?.parentId ?? null;
  }
  return out;
}

/** Whether `id` is `ancestorId` or lies anywhere inside its subtree. */
export function isInSubtree(index: ReadonlyMap<string, TreeIndexEntry>, id: string, ancestorId: string): boolean {
  if (id === ancestorId) return true;
  return ancestorIds(index, id).includes(ancestorId);
}

/** Expansion for a component seen for the first time: every root that has children. */
export function defaultExpanded(roots: readonly HierarchyItem[]): Set<string> {
  return new Set(roots.filter((r) => r.children.length > 0).map((r) => r.id));
}

/**
 * Alt-click on an eye: show only this node. Hides every visual sibling along its path from the
 * root (other visual roots included) and shows the node and its ancestors. Alt-clicking it
 * again while it is soloed — every one of those siblings already hidden and the path shown —
 * undoes it by showing the siblings again.
 */
export function soloToggle(
  roots: readonly HierarchyItem[],
  id: string,
  hidden: ReadonlySet<string>
): { hide: string[]; show: string[] } {
  const index = indexTree(roots);
  if (!index.has(id)) return { hide: [], show: [] };

  const path = [id, ...ancestorIds(index, id)];
  const siblings: string[] = [];
  for (const nodeId of path) {
    const entry = index.get(nodeId)!;
    const level = entry.parentId === null ? roots : index.get(entry.parentId)!.item.children;
    for (const s of level) {
      if (s.id !== nodeId && s.isVisual) siblings.push(s.id);
    }
  }

  const isSoloed = siblings.length > 0 && siblings.every((s) => hidden.has(s)) && path.every((p) => !hidden.has(p));
  if (isSoloed) return { hide: [], show: siblings };
  return { hide: siblings, show: path.filter((p) => hidden.has(p)) };
}
