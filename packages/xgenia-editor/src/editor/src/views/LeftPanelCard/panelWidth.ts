// Width rules for the left panel card. Pure; storage is injected so tests use a Map.

export const PANEL_WIDTH_MIN = 280;
export const PANEL_WIDTH_MAX = 720;
export const PANEL_WIDTH_DEFAULT = 380;
export const PANEL_WIDTH_SNAPS: readonly number[] = [320, 380, 450, 560];
export const PANEL_WIDTH_SNAP_TOL = 12;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function clampPanelWidth(w: number): number {
  if (!Number.isFinite(w)) return PANEL_WIDTH_DEFAULT;
  return Math.max(PANEL_WIDTH_MIN, Math.min(PANEL_WIDTH_MAX, Math.round(w)));
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

export function readPanelWidth(storage: StorageLike | null, id: string, fallback: number): number {
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(panelWidthKey(id));
    if (raw === null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? clampPanelWidth(n) : fallback;
  } catch {
    return fallback;
  }
}

export function writePanelWidth(storage: StorageLike | null, id: string, w: number): void {
  if (!storage) return;
  try {
    storage.setItem(panelWidthKey(id), String(clampPanelWidth(w)));
  } catch {
    /* storage unavailable: width lives in memory for the session */
  }
}
