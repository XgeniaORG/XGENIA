// frameSnap.ts — pure.
export type SnapPreset = { name: string; width: number | null; height: number | null };
export interface SnapResult { width: number; height: number; deviceName: string | null }

/** Which frame handle is being dragged: right edge, bottom edge, or corner. */
export type DragAxis = 'x' | 'y' | 'xy';

export const FRAME_MIN = 320;
export const FRAME_MAX_W = 3840;
// 3840 to match the tallest preset: a slot cabinet is a 4K panel stood on its end, and a
// clamp at 2160 would snap a portrait-4K frame back to landscape height the moment it was
// dragged.
export const FRAME_MAX_H = 3840;

// Math.min/Math.max propagate NaN, so a non-finite input would escape the clamp and
// return NaN for a value typed `number`. Fail to the low bound instead.
const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);

const clampW = (v: number) => clamp(Math.round(v), FRAME_MIN, FRAME_MAX_W);
const clampH = (v: number) => clamp(Math.round(v), FRAME_MIN, FRAME_MAX_H);

/** Bring a size from outside a drag (saved settings, an older build) inside the drag bounds. */
export function clampSize(width: number, height: number): { width: number; height: number } {
  return { width: clampW(width), height: clampH(height) };
}

/**
 * @param axis The handle being dragged. A single-axis drag only snaps to presets that
 *   share the dimension it holds fixed: otherwise dragging the right edge of an
 *   iPhone 15 Pro (393x852) two pixels inward snapped to iPhone 14 (390x844) and changed
 *   the HEIGHT, then flipped it back on the next move once the preset fell out of range.
 */
export function snapSize(
  width: number,
  height: number,
  presets: SnapPreset[],
  tolerance = 24,
  axis: DragAxis = 'xy'
): SnapResult {
  const w = clampW(width);
  const h = clampH(height);
  let best: { p: SnapPreset; d: number } | null = null;
  for (const p of presets) {
    if (p.width === null || p.height === null) continue;
    if (!Number.isFinite(p.width) || !Number.isFinite(p.height)) continue;
    if (axis === 'x' && clampH(p.height) !== h) continue;
    if (axis === 'y' && clampW(p.width) !== w) continue;
    const dw = Math.abs(p.width - w);
    const dh = Math.abs(p.height - h);
    if (dw <= tolerance && dh <= tolerance) {
      const d = dw + dh;
      if (!best || d < best.d) best = { p, d };
    }
  }
  if (best) {
    // A preset is data from elsewhere; run it through the same clamp and rounding as
    // a freehand size so the function cannot return a value outside its own bounds.
    return {
      width: clampW(best.p.width as number),
      height: clampH(best.p.height as number),
      deviceName: best.p.name
    };
  }
  return { width: w, height: h, deviceName: null };
}

export interface DragOrigin {
  axis: DragAxis;
  /** Device size at pointerdown. */
  w0: number;
  h0: number;
  /** Visual scale of the frame at pointerdown (CanvasView's fitScale). */
  scale: number;
}

/**
 * The size a handle drag of (dx, dy) screen pixels asks for.
 *
 * The frame is centred in its panel, so growing it by N visual pixels moves each edge by
 * only N/2. Mapping the pointer 1:1 left the handle trailing the cursor at half speed —
 * outward the cursor ran ahead of the handle, inward it ran onto the preview. A frame
 * shown at 100% therefore gets twice the delta, which keeps its edge under the cursor.
 *
 * A frame that is scaled down to fit keeps the 1:1 mapping on purpose: it re-fits to the
 * panel on every size change, so its edge cannot follow the cursor whatever the gain.
 */
export function dragSize(
  origin: DragOrigin,
  dx: number,
  dy: number,
  presets: SnapPreset[],
  tolerance = 24
): SnapResult {
  // fitScale is Math.min(1, ...), but the scale handed in is measured from the DOM, so
  // allow for float error rather than testing for exactly 1.
  const gain = origin.scale >= 0.999 ? 2 : 1;
  const scale = Math.max(origin.scale, 0.05);
  const w = origin.axis === 'y' ? origin.w0 : origin.w0 + (dx * gain) / scale;
  const h = origin.axis === 'x' ? origin.h0 : origin.h0 + (dy * gain) / scale;
  return snapSize(w, h, presets, tolerance, origin.axis);
}
