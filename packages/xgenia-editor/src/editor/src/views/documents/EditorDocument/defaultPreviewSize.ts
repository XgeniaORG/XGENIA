// The preview's share of the document when the split has never been dragged (EditorDocument).

/** How much of the graph shows under the game on the simple layout: enough to see it is there. */
const GRAPH_STRIP = 150;

export function defaultPreviewSize(totalSize: number | undefined, horizontal: boolean, showAllTools: boolean): number | undefined {
  if (!totalSize || !horizontal) return undefined;
  const size = showAllTools ? Math.round(totalSize * 0.5) : totalSize - GRAPH_STRIP;
  return Math.max(343, Math.min(size, totalSize - 100));
}

/**
 * A split size saved for a project, or undefined when it was never really dragged. Until 2026-11 the
 * divider reported its 343px fallback on first paint and that was saved as the user's choice, so
 * every game opened with a small preview; a drag never lands on exactly 343.
 */
export function savedPreviewSize(stored: unknown): number | undefined {
  return typeof stored === 'number' && stored > 0 && stored !== 343 ? stored : undefined;
}
