// What each rail item is called, which group it sits in, and which items a new user sees.
// Pure; no editor imports, so it runs under Node's test runner.

/** The rail's top-cluster groups, in the order they are drawn. Thin separators sit between them. */
export type RailGroupId = 'make' | 'look' | 'structure' | 'game' | 'advanced' | 'other';
export const RAIL_GROUPS: readonly RailGroupId[] = ['make', 'look', 'structure', 'game', 'advanced', 'other'];

export interface RailEntry {
  /** The one-line label under the icon. Short by design: it is never truncated. */
  label: string;
  /** Top-cluster group. Bottom-cluster items have none. */
  group?: RailGroupId;
  /** Position inside its group (or inside the bottom cluster). */
  rank: number;
  /** Shown on the simple rail a new user starts with. */
  simple?: boolean;
}

/**
 * Keyed by router id (router.setup.ts). The panel's `name` stays the long form used in its
 * tooltip and header; this is only what the rail prints under the icon.
 *
 * "Parts", not "Screens", for Components: the panel lists every component in the project —
 * pages, but also visual parts, logic-only components and folders — so "Screens" would promise
 * less than it shows. "Uses", not "Refs", for Node References: it counts how often each node
 * and component is used, and "Refs" is jargon.
 */
export const RAIL_ENTRIES: Readonly<Record<string, RailEntry>> = {
  // Two ids for the chat, depending on how it loaded (iframe vs. open-source shell).
  ChatPanel: { label: 'AI', group: 'make', rank: 0, simple: true },
  'chat-panel': { label: 'AI', group: 'make', rank: 0, simple: true },

  assets: { label: 'Assets', group: 'look', rank: 0, simple: true },
  'image-editor': { label: 'Images', group: 'look', rank: 1, simple: true },
  'web-plugin:character-studio': { label: 'Characters', group: 'look', rank: 2, simple: true },
  'project-styles': { label: 'Styles', group: 'look', rank: 3 },

  components: { label: 'Parts', group: 'structure', rank: 0 },
  hierarchy: { label: 'Layers', group: 'structure', rank: 1 },
  search: { label: 'Search', group: 'structure', rank: 2 },

  'maths-panel': { label: 'Maths', group: 'game', rank: 0, simple: true },

  'cloud-functions': { label: 'Functions', group: 'advanced', rank: 0 },
  'node-references': { label: 'Uses', group: 'advanced', rank: 1 },

  // Bottom cluster.
  history: { label: 'History', rank: 0, simple: true },
  versioncontrol: { label: 'Versions', rank: 1 },
  cloudservice: { label: 'Cloud', rank: 2 },
  settings: { label: 'Settings', rank: 3, simple: true }
};

/** The Add button (node picker) is not a sidebar item, but it is part of the "make" group. */
export const ADD_LABEL = 'Add';
/** The ⋯ button holding whatever the rail does not show. */
export const MORE_LABEL = 'More';

export interface RailLabelSource {
  id: string;
  name: string;
  shortLabel?: string;
}

/** The label under a rail icon: the item's own `shortLabel`, then the table, then its name. */
export function railLabelFor(item: RailLabelSource): string {
  return item.shortLabel || RAIL_ENTRIES[item.id]?.label || item.name;
}

export function railGroupFor(id: string): RailGroupId {
  return RAIL_ENTRIES[id]?.group ?? 'other';
}

export function isSimpleRailItem(id: string): boolean {
  return RAIL_ENTRIES[id]?.simple === true;
}

// ── Simple rail default ─────────────────────────────────────────────

/** EditorSettings key for "Show all tools". Absent until the user toggles it. */
export const SHOW_ALL_TOOLS_KEY = 'rail.showAllTools';
/** A profile that has opened at least this many projects gets the full rail by default. */
export const SHOW_ALL_TOOLS_MIN_PROJECTS = 3;

/**
 * Whether the rail shows every tool. A stored choice always wins. With none, a profile that has
 * opened fewer than three projects starts on the simple rail, everyone else on the full one.
 * The default is not written back, so a new user moves to the full rail by themselves once
 * they have opened a third project.
 */
export function resolveShowAllTools(stored: unknown, recentProjectCount: number): boolean {
  if (typeof stored === 'boolean') return stored;
  return recentProjectCount >= SHOW_ALL_TOOLS_MIN_PROJECTS;
}

// ── Arrangement ─────────────────────────────────────────────────────

/** One rail item: 46px tall (icon, gap, label) + 2px gap. */
export const RAIL_SLOT = 48;
/** A separator between groups (and before More): 9px (4px margin + 1px line + 4px margin) + the 2px gap after it. */
export const RAIL_SEPARATOR = 11;
/** Project chip: 10px margin + 28px chip + 8px gap to the first item. */
export const RAIL_HEADER = 46;
/** Bottom cluster: its separator (9px + 2px gap) + 8px bottom margin. */
export const RAIL_BOTTOM_CHROME = 19;
/** Space kept between the top and bottom clusters before anything folds into More. */
export const RAIL_MIN_GAP = 8;

export interface RailArrangeItem {
  id: string;
  name: string;
  order?: number;
  placement?: 'top' | 'bottom';
}

export interface RailGroupSlice<T> {
  id: RailGroupId;
  items: T[];
}

export interface GroupedRail<T> {
  /** Top-cluster groups in drawing order. Empty groups are dropped, except "make" (it holds Add). */
  groups: RailGroupSlice<T>[];
  bottom: T[];
  /** Everything the rail does not show, in rail order: top items first, then bottom items. */
  overflow: T[];
  /** Whether the More button is drawn. */
  hasMore: boolean;
}

export interface ArrangeOptions {
  /** "Show all tools". Off = the simple rail. */
  showAll: boolean;
  /** The panel currently open, if any. Never hidden by the simple rail. */
  openId?: string | null;
  /** Rail height in px; omit (or 0) before the first measurement and nothing folds for height. */
  railHeight?: number;
}

function rankOf(id: string): number {
  return RAIL_ENTRIES[id]?.rank ?? Number.POSITIVE_INFINITY;
}

/** Table rank, then registration order, then name. */
function byRank<T extends RailArrangeItem>(a: T, b: T): number {
  const ar = rankOf(a.id);
  const br = rankOf(b.id);
  if (ar !== br) return ar - br;
  const ao = a.order ?? Number.POSITIVE_INFINITY;
  const bo = b.order ?? Number.POSITIVE_INFINITY;
  if (ao !== bo) return ao - bo;
  return a.name.localeCompare(b.name);
}

/** Ids the user ordered by hand come first, in their order; the rest follow by rank. */
function sortWithUserOrder<T extends RailArrangeItem>(items: T[], userOrder: readonly string[]): T[] {
  const pinned: T[] = [];
  for (const id of userOrder) {
    const it = items.find((i) => i.id === id);
    if (it && !pinned.includes(it)) pinned.push(it);
  }
  const rest = items.filter((i) => !pinned.includes(i)).sort(byRank);
  return [...pinned, ...rest];
}

/** Height left for the top cluster (Add and More included) in a rail this tall. */
export function railTopBudget(railHeight: number, bottomCount: number): number {
  const bottom = bottomCount > 0 ? bottomCount * RAIL_SLOT - 2 + RAIL_BOTTOM_CHROME : 0;
  return railHeight - RAIL_HEADER - bottom - RAIL_MIN_GAP;
}

/**
 * Lay the rail out: groups in fixed order, user order inside a group, the simple-rail filter,
 * then fold the tail of the top cluster into More if the rail is too short for it.
 */
export function arrangeGroupedRail<T extends RailArrangeItem>(
  items: readonly T[],
  userOrder: readonly string[],
  opts: ArrangeOptions
): GroupedRail<T> {
  const openId = opts.openId ?? null;
  const shown = (i: T) => opts.showAll || isSimpleRailItem(i.id) || i.id === openId;

  const bottomAll = items.filter((i) => i.placement === 'bottom').sort(byRank);
  const bottom = bottomAll.filter(shown);
  const hiddenBottom = bottomAll.filter((i) => !shown(i));

  const topAll = items.filter((i) => i.placement !== 'bottom');
  const groups: RailGroupSlice<T>[] = [];
  const hiddenTop: T[] = [];
  for (const g of RAIL_GROUPS) {
    const inGroup = sortWithUserOrder(topAll.filter((i) => railGroupFor(i.id) === g), userOrder);
    const visible = inGroup.filter(shown);
    hiddenTop.push(...inGroup.filter((i) => !shown(i)));
    if (visible.length > 0 || g === 'make') groups.push({ id: g, items: visible });
  }

  const foldedForHeight = opts.railHeight ? foldForHeight(groups, opts.railHeight, bottom.length, hiddenTop.length + hiddenBottom.length > 0) : [];

  const overflow = [...foldedForHeight, ...hiddenTop, ...hiddenBottom];
  // Keep the "make" group even when empty; drop any other group the fold emptied.
  const kept = groups.filter((g) => g.items.length > 0 || g.id === 'make');
  return { groups: kept, bottom, overflow, hasMore: overflow.length > 0 };
}

/**
 * Remove (and return) the tail items that do not fit. Walks the groups in drawing order,
 * counting Add as a fixed slot in "make" and a separator before every later group; More gets a
 * slot reserved whenever it will be drawn.
 */
function foldForHeight<T>(groups: RailGroupSlice<T>[], railHeight: number, bottomCount: number, moreAlready: boolean): T[] {
  const budget = railTopBudget(railHeight, bottomCount);
  const tryFit = (reserveMore: boolean): number[] => {
    // Per group, how many of its items fit.
    let used = RAIL_SLOT; // Add
    if (reserveMore) used += RAIL_SLOT + RAIL_SEPARATOR;
    const fits: number[] = [];
    let full = false;
    groups.forEach((g, gi) => {
      let n = 0;
      if (!full && gi > 0 && g.items.length > 0) {
        if (used + RAIL_SEPARATOR + RAIL_SLOT > budget + 2) full = true;
        else used += RAIL_SEPARATOR;
      }
      for (let k = 0; k < g.items.length && !full; k++) {
        if (used + RAIL_SLOT > budget + 2) {
          full = true;
          break;
        }
        used += RAIL_SLOT;
        n++;
      }
      fits.push(n);
    });
    return fits;
  };

  let fits = tryFit(moreAlready);
  const overflows = (f: number[]) => f.some((n, gi) => n < groups[gi].items.length);
  if (!moreAlready && overflows(fits)) fits = tryFit(true);
  if (!overflows(fits)) return [];

  const folded: T[] = [];
  groups.forEach((g, gi) => {
    folded.push(...g.items.slice(fits[gi]));
    g.items = g.items.slice(0, fits[gi]);
  });
  return folded;
}

// ── Icons ───────────────────────────────────────────────────────────

/**
 * No icon twice on the rail. A server-provided web plugin may name an icon key that a built-in
 * panel already uses (Character Studio once asked for the Components grid); such a plugin falls
 * back to `fallback`. Built-in panels always keep theirs. Returns id → icon.
 */
export function dedupeRailIcons<I>(
  items: readonly { id: string; icon?: I }[],
  isPlugin: (id: string) => boolean,
  fallback: I
): Map<string, I | undefined> {
  const out = new Map<string, I | undefined>();
  const taken = new Set<I>();
  for (const it of items) if (!isPlugin(it.id) && it.icon !== undefined) taken.add(it.icon);
  for (const it of items) {
    if (isPlugin(it.id) && it.icon !== undefined && taken.has(it.icon)) {
      out.set(it.id, fallback);
    } else {
      out.set(it.id, it.icon);
      if (it.icon !== undefined) taken.add(it.icon);
    }
  }
  return out;
}
