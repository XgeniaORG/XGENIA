/**
 * Search and "Changed" filtering for the inspector's port list.
 *
 * Pure: takes the row descriptors the React layer builds from the legacy port views
 * and returns what should be on screen. No DOM, no model access — so the counts on
 * the filter bar and the rows below it can never disagree.
 */

export type InspectorFilterMode = 'all' | 'changed';

export interface FilterableRow {
  /** Port name — the model key. Always searchable, even when a display name exists. */
  name: string;
  /** What the row shows as its label. */
  label: string;
  /** `false` when the node carries an explicit parameter for this port. */
  isDefault: boolean;
}

export interface FilterableGroup<TRow extends FilterableRow> {
  name: string;
  rows: TRow[];
}

export interface FilterOptions {
  mode: InspectorFilterMode;
  query: string;
}

export interface FilterCounts {
  all: number;
  changed: number;
}

/**
 * Lower-cased and trimmed. An all-whitespace query is the same as no query — a stray
 * space typed into the search box must not empty the panel.
 */
export function normalizeQuery(query: string | undefined | null): string {
  return (query ?? '').trim().toLowerCase();
}

/**
 * Matches against the display label AND the raw port name. The two often differ
 * ("Fit Padding" vs `fitPadding`), and someone who knows the port name from the
 * graph or from the AI transcript should be able to type it.
 */
export function rowMatchesQuery<TRow extends FilterableRow>(row: TRow, normalizedQuery: string): boolean {
  if (normalizedQuery === '') return true;
  return (
    row.label.toLowerCase().indexOf(normalizedQuery) !== -1 ||
    row.name.toLowerCase().indexOf(normalizedQuery) !== -1
  );
}

/**
 * Counts are computed over the SEARCH result, not over the whole node. With a query
 * active, "All 6 / Changed 2" describes the six rows the search found — a Changed
 * count that silently included rows the search had hidden would send the user
 * looking for rows that are not there.
 */
export function countRows<TRow extends FilterableRow>(
  groups: readonly FilterableGroup<TRow>[],
  query: string
): FilterCounts {
  const normalized = normalizeQuery(query);
  let all = 0;
  let changed = 0;

  for (const group of groups) {
    const wholeGroupMatches = groupMatchesQuery(group, normalized);
    for (const row of group.rows) {
      if (!wholeGroupMatches && !rowMatchesQuery(row, normalized)) continue;
      all++;
      if (!row.isDefault) changed++;
    }
  }

  return { all, changed };
}

/**
 * A group name is a search term too. Typing "sitemap" should bring back the Sitemap
 * group whole, rather than only whichever of its rows happen to repeat the word — and
 * it is the only way to find the rows that have no name of their own, like the
 * margin/padding widget that fills its entire group.
 */
export function groupMatchesQuery<TRow extends FilterableRow>(
  group: FilterableGroup<TRow>,
  normalizedQuery: string
): boolean {
  if (normalizedQuery === '') return true;
  return group.name.toLowerCase().indexOf(normalizedQuery) !== -1;
}

/**
 * Applies search then mode. Groups left with no visible rows are dropped rather than
 * rendered as empty headers.
 */
export function filterGroups<TRow extends FilterableRow>(
  groups: readonly FilterableGroup<TRow>[],
  options: FilterOptions
): FilterableGroup<TRow>[] {
  const normalized = normalizeQuery(options.query);
  const wantsChangedOnly = options.mode === 'changed';

  const result: FilterableGroup<TRow>[] = [];
  for (const group of groups) {
    const wholeGroupMatches = groupMatchesQuery(group, normalized);
    const rows = group.rows.filter(
      (row) =>
        (wholeGroupMatches || rowMatchesQuery(row, normalized)) && (!wantsChangedOnly || !row.isDefault)
    );
    if (rows.length > 0) result.push({ name: group.name, rows });
  }
  return result;
}

/**
 * True when the panel would render nothing. Callers use this to pick which empty
 * state to show: an unproductive search reads differently from a node that simply
 * has nothing changed yet.
 */
export function isEmptyResult<TRow extends FilterableRow>(groups: readonly FilterableGroup<TRow>[]): boolean {
  return groups.length === 0;
}
