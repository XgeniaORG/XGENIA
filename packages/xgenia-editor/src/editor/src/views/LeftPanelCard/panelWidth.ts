// Width rules for the left panel card. Pure; storage is injected so tests use a Map, and
// the viewport width (when the cap needs to flex with it) is passed in rather than read
// from `window` — no editor/DOM imports here.

export const PANEL_WIDTH_MIN = 280;
/** Fallback ceiling used whenever the caller has no viewport width in hand (e.g. the
 *  first render, before anything has measured the window). Panels that want to fill
 *  most of the window — the AI Image Editor — get a higher, viewport-relative ceiling
 *  from `maxPanelWidth` instead. */
export const PANEL_WIDTH_MAX = 720;
export const PANEL_WIDTH_DEFAULT = 380;
export const PANEL_WIDTH_SNAPS: readonly number[] = [320, 380, 450, 560];
export const PANEL_WIDTH_SNAP_TOL = 12;
/** Minimum canvas width left on screen when a panel is dragged as wide as it can go —
 *  the whole point of a maximum is to never strand the editor with no canvas at all. */
export const PANEL_MIN_CANVAS = 240;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * The real ceiling for a drag, given how much width is actually available (the window
 * minus whatever chrome the caller has already subtracted, e.g. the rail). Falls back to
 * the fixed `PANEL_WIDTH_MAX` when the available width is unknown or nonsensical, so a
 * panel can still be dragged out to nearly the full window — the behaviour the old
 * `FrameDivider`-based sidebar had with `sizeMin={0}` and no maximum — without ever being
 * able to exceed the window and leave no canvas visible.
 */
export function maxPanelWidth(availableWidth: number | undefined): number {
  if (!Number.isFinite(availableWidth as number) || (availableWidth as number) <= 0) return PANEL_WIDTH_MAX;
  return Math.max(PANEL_WIDTH_MIN, Math.round((availableWidth as number) - PANEL_MIN_CANVAS));
}

export function clampPanelWidth(w: number, max: number = PANEL_WIDTH_MAX): number {
  if (!Number.isFinite(w)) return PANEL_WIDTH_DEFAULT;
  return Math.max(PANEL_WIDTH_MIN, Math.min(max, Math.round(w)));
}

export function snapPanelWidth(
  w: number,
  stops: readonly number[] = PANEL_WIDTH_SNAPS,
  tol: number = PANEL_WIDTH_SNAP_TOL
): number {
  for (const stop of stops) {
    if (Math.abs(w - stop) <= tol) return stop;
  }
  return w;
}

export function panelWidthKey(id: string): string {
  return `xgenia.leftPanel.width:${id}`;
}

export function readPanelWidth(storage: StorageLike | null, id: string, fallback: number, max: number = PANEL_WIDTH_MAX): number {
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(panelWidthKey(id));
    if (raw === null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? clampPanelWidth(n, max) : fallback;
  } catch {
    return fallback;
  }
}

export function writePanelWidth(storage: StorageLike | null, id: string, w: number, max: number = PANEL_WIDTH_MAX): void {
  if (!storage) return;
  try {
    storage.setItem(panelWidthKey(id), String(clampPanelWidth(w, max)));
  } catch {
    /* storage unavailable: width lives in memory for the session */
  }
}
