// The preview's share of the document when the split has never been dragged (EditorDocument).

/** How much of the graph shows under the game on the simple layout: enough to see it is there. */
const GRAPH_STRIP = 150;

export function defaultPreviewSize(totalSize: number | undefined, horizontal: boolean, showAllTools: boolean): number | undefined {
  if (!totalSize || !horizontal) return undefined;
  const size = showAllTools ? Math.round(totalSize * 0.5) : totalSize - GRAPH_STRIP;
  return Math.max(343, Math.min(size, totalSize - 100));
}
