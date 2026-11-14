/** Ruler and drag arithmetic for the Timeline dock (pure, unit-tested). */

export const MIN_PX_PER_SECOND = 20;
export const MAX_PX_PER_SECOND = 2400;
export const DEFAULT_PX_PER_SECOND = 160;
/** Keys snap to 60 fps frames unless Alt is held. */
export const SNAP_FPS = 60;

const TICK_STEPS = [1 / 60, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60];

export function clampZoom(pxPerSecond: number): number {
  if (!Number.isFinite(pxPerSecond)) return DEFAULT_PX_PER_SECOND;
  return Math.min(MAX_PX_PER_SECOND, Math.max(MIN_PX_PER_SECOND, pxPerSecond));
}

/** Labelled tick spacing: the smallest step at least `minPx` apart on screen. */
export function majorTickStep(pxPerSecond: number, minPx = 64): number {
  for (const step of TICK_STEPS) if (step * pxPerSecond >= minPx) return step;
  return TICK_STEPS[TICK_STEPS.length - 1];
}

export interface Tick {
  t: number;
  major: boolean;
}

/** Major and minor ticks from 0 to `total` seconds. */
export function rulerTicks(total: number, pxPerSecond: number): Tick[] {
  const major = majorTickStep(pxPerSecond);
  const minor = major / (major * pxPerSecond >= 160 ? 10 : major * pxPerSecond >= 80 ? 5 : 2);
  const ticks: Tick[] = [];
  const count = Math.floor(total / minor + 1e-9);
  const perMajor = Math.round(major / minor);
  for (let i = 0; i <= count && i < 5000; i++) {
    ticks.push({ t: i * minor, major: i % perMajor === 0 });
  }
  return ticks;
}

export function formatTime(t: number, step = 0.01): string {
  if (step >= 1 && Math.abs(t - Math.round(t)) < 1e-6) return `${Math.round(t)}s`;
  const decimals = step < 0.1 ? 2 : 1;
  return `${t.toFixed(decimals)}s`;
}

export function snapTime(t: number, enabled = true): number {
  const clamped = Math.max(0, t);
  if (!enabled) return Math.round(clamped * 1e4) / 1e4;
  return Math.round(clamped * SNAP_FPS) / SNAP_FPS;
}

/**
 * Time shift for a key drag: the grabbed key lands on a frame (when snapping) and no key in
 * the selection goes below 0.
 */
export function dragDelta(grabbedT: number, rawDt: number, earliestT: number, snap: boolean): number {
  let dt = snapTime(grabbedT + rawDt, snap) - grabbedT;
  if (earliestT + dt < 0) dt = -earliestT;
  return dt;
}

/** Scroll position that keeps time `t` under the cursor after a zoom. */
export function scrollForZoom(t: number, pxPerSecond: number, cursorOffset: number, laneOrigin: number): number {
  return Math.max(0, laneOrigin + t * pxPerSecond - cursorOffset);
}
