// Click-to-select rules for the Hierarchy panel's rows. Pure; unit-tested.

export interface SelectionClick {
  /** Shift: select the run of visible rows from the anchor to the clicked row. */
  range?: boolean;
  /** Cmd (mac) / Ctrl: add or remove the clicked row. */
  toggle?: boolean;
}

export interface SelectionResult {
  ids: string[];
  /** The row a later Shift-click measures its range from. */
  anchor: string | null;
}

/** Visible rows from `anchorId` to `targetId`, inclusive, in display order. */
export function rangeSelection(visibleIds: readonly string[], anchorId: string | null, targetId: string): string[] {
  const to = visibleIds.indexOf(targetId);
  if (to === -1) return [];
  const from = anchorId === null ? -1 : visibleIds.indexOf(anchorId);
  if (from === -1) return [targetId];
  const [a, b] = from <= to ? [from, to] : [to, from];
  return visibleIds.slice(a, b + 1);
}

export function toggleSelection(selected: readonly string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
}

export function selectionForClick(
  visibleIds: readonly string[],
  selected: readonly string[],
  anchorId: string | null,
  targetId: string,
  mods: SelectionClick
): SelectionResult {
  if (mods.range) {
    // A range keeps its anchor, so Shift-clicking again re-measures from the same row.
    const anchor = anchorId !== null && visibleIds.includes(anchorId) ? anchorId : targetId;
    return { ids: rangeSelection(visibleIds, anchor, targetId), anchor };
  }
  if (mods.toggle) {
    const ids = toggleSelection(selected, targetId);
    return { ids, anchor: ids.includes(targetId) ? targetId : anchorId };
  }
  return { ids: [targetId], anchor: targetId };
}

/** Same members, ignoring order. */
export function sameSelection(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}
