// Fixed-height row windowing shared by the Hierarchy and History panels. Pure; unit-tested.
// A slot component can hold a few thousand nodes and the undo queue grows all session, so
// both lists draw only the rows on screen.

/** Row range [start, end) to render for a scroll position, with `overscan` rows either side. */
export function visibleWindow(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  count: number,
  overscan = 6
): { start: number; end: number } {
  if (count <= 0 || rowHeight <= 0) return { start: 0, end: 0 };
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const visible = Math.ceil(Math.max(0, viewportHeight) / rowHeight) + 1;
  const start = Math.max(0, first - overscan);
  const end = Math.min(count, first + visible + overscan);
  return { start, end: Math.max(start, end) };
}

/**
 * The scrollTop that brings row `index` fully on screen, or null when it already is. Scrolls
 * the least distance, and keeps `margin` px between the row and the edge it comes in from.
 */
export function scrollTopToReveal(
  index: number,
  rowHeight: number,
  scrollTop: number,
  viewportHeight: number,
  margin = 0
): number | null {
  if (index < 0 || viewportHeight <= 0) return null;
  const top = index * rowHeight;
  const bottom = top + rowHeight;
  if (top < scrollTop) return Math.max(0, top - margin);
  if (bottom > scrollTop + viewportHeight) return Math.max(0, bottom - viewportHeight + margin);
  return null;
}
