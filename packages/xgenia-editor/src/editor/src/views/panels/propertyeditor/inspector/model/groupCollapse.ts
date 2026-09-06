/**
 * Which inspector groups are collapsed, remembered across sessions.
 *
 * The legacy port list had the shape of this feature and none of the behaviour:
 * `Ports.onGroupClicked` was an empty function with its body commented out, the
 * `groupExpansions` map it would have written to was never assigned, and the caret
 * that would have shown the state was commented out of the template. Every group was
 * permanently expanded. This module is the missing half.
 *
 * Keyed by group NAME alone, not by node type. Group names are a small shared
 * vocabulary across node types ("General", "Layout", "Style"), so a user who collapses
 * "Style" means it for styling in general; re-collapsing it once per node type would
 * be the annoying reading of the same gesture.
 */

const STORAGE_KEY = 'xgenia.inspector.collapsedGroups';

/**
 * Groups that start collapsed the first time a user ever sees them. Everything else
 * starts open — a node whose ports are hidden behind closed headers looks broken.
 */
const DEFAULT_COLLAPSED: readonly string[] = [];

function readStorage(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_COLLAPSED.slice();
    const parsed = JSON.parse(raw);
    // A hand-edited or half-written value must not take the panel down with it.
    if (!Array.isArray(parsed)) return DEFAULT_COLLAPSED.slice();
    return parsed.filter((entry): entry is string => typeof entry === 'string');
  } catch (e) {
    return DEFAULT_COLLAPSED.slice();
  }
}

function writeStorage(names: readonly string[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(names));
  } catch (e) {
    // Private mode, quota, a locked-down profile: the panel still works for this
    // session, it just forgets. Never let persistence failure break a click.
  }
}

export function loadCollapsedGroups(): Set<string> {
  return new Set(readStorage());
}

export function saveCollapsedGroups(collapsed: ReadonlySet<string>): void {
  writeStorage(Array.from(collapsed));
}

/**
 * Returns a NEW set with `groupName` toggled. The caller owns persisting it —
 * React state updates and storage writes stay separable so the reducer is testable.
 */
export function toggleGroup(collapsed: ReadonlySet<string>, groupName: string): Set<string> {
  const next = new Set(collapsed);
  if (next.has(groupName)) next.delete(groupName);
  else next.add(groupName);
  return next;
}

export interface GroupVisibilityOptions {
  /** A search is running. */
  isSearching: boolean;
  /** The "Changed" filter is on. */
  isFiltering: boolean;
}

/**
 * Whether a group renders collapsed right now.
 *
 * A collapsed group is force-opened while a search or the Changed filter is active:
 * the filter has already decided these rows are the ones worth showing, and hiding
 * them behind a closed header would report "3 results" above three invisible rows.
 * The stored state is untouched, so closing the search restores what the user chose.
 */
export function isGroupCollapsed(
  collapsed: ReadonlySet<string>,
  groupName: string,
  options: GroupVisibilityOptions
): boolean {
  if (options.isSearching || options.isFiltering) return false;
  return collapsed.has(groupName);
}
