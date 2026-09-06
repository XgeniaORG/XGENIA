/**
 * lobbyGrouping.ts — turning a flat list of projects into a lobby.
 *
 * The projects screen has always rendered `LocalProjectsModel.projectEntries` in one flat,
 * last-accessed-first list. On a real profile that is 319 tiles in a single run, and the only
 * way to find anything is to recognise a cropped thumbnail. Grouping by when you last touched
 * a game is what makes that list scannable: the four you worked on today sit together, and the
 * 295 from before are one section you can skip past.
 *
 * Deliberately free of react, electron, node and DOM imports. `LocalProjectsModel` cannot be
 * loaded in a test — it pulls in electron-store, GitStore and the platform layer — so every
 * decision that shapes the grid lives here, where it can be run directly.
 */

/** The subset of `ProjectItem` this module needs. Kept structural so tests need no fixtures. */
export interface LobbyEntry {
  id: string;
  name: string;
  latestAccessed: number;
}

/** Metadata joined in from disk. Every field is optional: a read may not have landed yet. */
export interface LobbyMeta {
  /** One line describing the game, from its newest chat conversation's title. */
  tagline?: string;
  /** Total messages across the project's conversations. */
  messageCount?: number;
  /** Components in project.json. Read for the hero only. */
  componentCount?: number;
  /** Whether the cover art is a near-empty capture (a blank canvas, a config screen). */
  weakThumb?: boolean;
}

export type LobbyItem = LobbyEntry & { meta: LobbyMeta; pinned: boolean };

export type SortKey = 'recent' | 'name' | 'messages';

export const SORT_LABELS: Record<SortKey, string> = {
  recent: 'Last opened',
  name: 'Name',
  messages: 'Most discussed'
};

/**
 * Group ids, in the order they are shown.
 *
 * `pinned` is a real group rather than a sort tweak: a pinned game is one you have said you
 * care about, and it should not move just because you opened something else this morning.
 */
export type GroupId = 'pinned' | 'today' | 'yesterday' | 'week' | 'earlier';

export const GROUP_LABELS: Record<GroupId, string> = {
  pinned: 'Pinned',
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'This week',
  earlier: 'Earlier'
};

export const GROUP_ORDER: GroupId[] = ['pinned', 'today', 'yesterday', 'week', 'earlier'];

export interface LobbyGroup {
  id: GroupId;
  label: string;
  items: LobbyItem[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Start of the local day containing `at`.
 *
 * Buckets are calendar days, not rolling 24-hour windows: something opened at 23:50 last night
 * belongs under Yesterday at 00:10, not under Today for another twenty-three hours. `setHours`
 * works in the host's timezone, which is the one the user is reading the screen in.
 */
function startOfDay(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Which time bucket a timestamp falls in, relative to `now`.
 *
 * A timestamp in the future — a clock change, a file copied from another machine — reads as
 * Today rather than falling through every bucket to Earlier.
 */
export function timeBucketOf(latestAccessed: number, now: number): Exclude<GroupId, 'pinned'> {
  const today = startOfDay(now);

  if (latestAccessed >= today) return 'today';
  if (latestAccessed >= today - DAY_MS) return 'yesterday';
  // "This week" is the six days before yesterday, so the three buckets together cover the last
  // seven calendar days and nothing is double-counted.
  if (latestAccessed >= today - 6 * DAY_MS) return 'week';
  return 'earlier';
}

/** Case- and punctuation-insensitive haystack for search. */
function haystack(item: LobbyItem): string {
  return `${item.name} ${item.meta.tagline || ''}`.toLowerCase();
}

/**
 * Whether an item matches a query.
 *
 * Every whitespace-separated term must appear somewhere in the name or the tagline. Terms
 * rather than a substring because the names are what they are — searching "neon slot" should
 * find "NeonReels Slot" even though that exact string never occurs.
 */
export function matchesQuery(item: LobbyItem, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;

  const hay = haystack(item);
  return terms.every((t) => hay.includes(t));
}

function compare(a: LobbyItem, b: LobbyItem, sort: SortKey): number {
  if (sort === 'name') {
    // localeCompare so "Ámazing" sorts with the A's, and numeric so "Slot 2" precedes "Slot 10".
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  }
  if (sort === 'messages') {
    const diff = (b.meta.messageCount || 0) - (a.meta.messageCount || 0);
    // Ties on message count fall back to recency rather than to insertion order, which would
    // otherwise make the whole "0 messages" tail reshuffle every time a read lands.
    if (diff !== 0) return diff;
  }
  return b.latestAccessed - a.latestAccessed;
}

export interface ArrangeArgs {
  entries: LobbyEntry[];
  metaById?: Record<string, LobbyMeta>;
  pinnedIds?: string[];
  query?: string;
  sort?: SortKey;
  now?: number;
}

export interface ArrangeResult {
  groups: LobbyGroup[];
  /** Every item in render order, flattened. Drives keyboard navigation and the deal-in cap. */
  flat: LobbyItem[];
  /** Counts for every group, including the empty ones, for the jump strip. */
  counts: Record<GroupId, number>;
  /** How many entries existed before the query was applied. */
  total: number;
}

/**
 * The whole grid, in one pure function.
 *
 * Empty groups are dropped from `groups` but kept in `counts`, so the jump strip can show
 * "Yesterday 0" greyed rather than silently reflowing as the day rolls over.
 */
export function arrangeLobby(args: ArrangeArgs): ArrangeResult {
  const { entries, metaById = {}, pinnedIds = [], query = '', sort = 'recent', now = Date.now() } = args;

  const pinned = new Set(pinnedIds);

  const items: LobbyItem[] = entries.map((e) => ({
    ...e,
    meta: metaById[e.id] || {},
    pinned: pinned.has(e.id)
  }));

  const matching = query.trim() ? items.filter((i) => matchesQuery(i, query)) : items;

  const counts: Record<GroupId, number> = { pinned: 0, today: 0, yesterday: 0, week: 0, earlier: 0 };
  const buckets: Record<GroupId, LobbyItem[]> = { pinned: [], today: [], yesterday: [], week: [], earlier: [] };

  for (const item of matching) {
    const id: GroupId = item.pinned ? 'pinned' : timeBucketOf(item.latestAccessed, now);
    buckets[id].push(item);
    counts[id]++;
  }

  // Pinned is always ordered by recency regardless of the sort. Sorting it by name would mean
  // the row of games you deliberately kept at the top reorders under you when you rename one.
  buckets.pinned.sort((a, b) => b.latestAccessed - a.latestAccessed);
  for (const id of GROUP_ORDER) {
    if (id !== 'pinned') buckets[id].sort((a, b) => compare(a, b, sort));
  }

  const groups = GROUP_ORDER.filter((id) => buckets[id].length > 0).map((id) => ({
    id,
    label: GROUP_LABELS[id],
    items: buckets[id]
  }));

  return { groups, flat: groups.flatMap((g) => g.items), counts, total: entries.length };
}

/**
 * Whether a query looks like a description of a game to build rather than a search.
 *
 * The omnibox offers a "Create" row underneath the matches. Offering it for every keystroke
 * would put a build button under the word "n"; requiring a sentence-shaped query means it
 * appears when someone has actually typed an intent.
 */
export function looksLikeCreateIntent(query: string): boolean {
  const words = query.trim().split(/\s+/).filter(Boolean);
  return words.length >= 3;
}
