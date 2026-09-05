// frameSnap.ts — pure.
export type SnapPreset = { name: string; width: number | null; height: number | null };
export interface SnapResult { width: number; height: number; deviceName: string | null }

export const FRAME_MIN = 320;
export const FRAME_MAX_W = 3840;
export const FRAME_MAX_H = 2160;

// Math.min/Math.max propagate NaN, so a non-finite input would escape the clamp and
// return NaN for a value typed `number`. Fail to the low bound instead.
const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);

export function snapSize(width: number, height: number, presets: SnapPreset[], tolerance = 24): SnapResult {
  const w = clamp(Math.round(width), FRAME_MIN, FRAME_MAX_W);
  const h = clamp(Math.round(height), FRAME_MIN, FRAME_MAX_H);
  let best: { p: SnapPreset; d: number } | null = null;
  for (const p of presets) {
    if (p.width === null || p.height === null) continue;
    if (!Number.isFinite(p.width) || !Number.isFinite(p.height)) continue;
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
      width: clamp(Math.round(best.p.width as number), FRAME_MIN, FRAME_MAX_W),
      height: clamp(Math.round(best.p.height as number), FRAME_MIN, FRAME_MAX_H),
      deviceName: best.p.name
    };
  }
  return { width: w, height: h, deviceName: null };
}
