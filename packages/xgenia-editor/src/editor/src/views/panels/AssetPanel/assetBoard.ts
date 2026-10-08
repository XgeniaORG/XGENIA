// Geometry for the placement board: moving, snapping, nudging and resizing pieces in 0..1 screen
// fractions. Pure.

import type { Rect, ScreenSize } from './assetPlacement';

export interface Guide {
  axis: 'x' | 'y';
  /** 0..1 along that axis. */
  at: number;
}

const edges = (r: Rect, axis: 'x' | 'y') =>
  axis === 'x' ? [r.x, r.x + r.width / 2, r.x + r.width] : [r.y, r.y + r.height / 2, r.y + r.height];

function bounds(rects: Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * The delta to move `moving` by: the drag delta, snapped so the group's left/center/right (top/
 * middle/bottom) meets an edge or center of another piece or of the screen when within
 * `thresholdPx` screen pixels, and never pushed further off screen than it already is.
 */
export function snapMove(moving: Rect[], others: Rect[], dx: number, dy: number, screen: ScreenSize, thresholdPx: number) {
  const guides: Guide[] = [];
  if (moving.length === 0) return { dx, dy, guides };
  const b = bounds(moving);

  const axis = (a: 'x' | 'y', delta: number, size: number) => {
    const moved = edges({ ...b, [a]: (b as any)[a] + delta } as Rect, a);
    const targets = [0, 0.5, 1, ...others.flatMap((o) => edges(o, a))];
    let best: { shift: number; at: number } | null = null;
    for (const m of moved) {
      for (const t of targets) {
        const shift = t - m;
        if (Math.abs(shift) * size <= thresholdPx && (!best || Math.abs(shift) < Math.abs(best.shift))) best = { shift, at: t };
      }
    }
    let d = delta + (best ? best.shift : 0);
    if (best) guides.push({ axis: a, at: best.at });
    const start = (b as any)[a] as number;
    const extent = a === 'x' ? b.width : b.height;
    const lo = Math.min(0, -start);
    const hi = Math.max(0, 1 - (start + extent));
    d = Math.max(lo, Math.min(hi, d));
    return d;
  };

  return { dx: axis('x', dx, screen.width), dy: axis('y', dy, screen.height), guides };
}

export function moveRects(rects: Rect[], dx: number, dy: number): Rect[] {
  return rects.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy }));
}

/** Arrow keys: whole screen pixels. */
export function nudgeRects(rects: Rect[], px: number, py: number, screen: ScreenSize): Rect[] {
  return moveRects(rects, px / screen.width, py / screen.height);
}

/** Bottom-right handle. `keepRatio` holds the aspect (Shift). Never below a sliver, never past the screen. */
export function resizeRect(r: Rect, dw: number, dh: number, keepRatio: boolean): Rect {
  const min = 0.002;
  let width = Math.max(min, Math.min(1 - r.x, r.width + dw));
  let height = Math.max(min, Math.min(1 - r.y, r.height + dh));
  if (keepRatio && r.width > 0) height = Math.max(min, Math.min(1 - r.y, width * (r.height / r.width)));
  if (keepRatio && height === 1 - r.y) width = height * (r.width / r.height);
  return { ...r, width, height };
}
