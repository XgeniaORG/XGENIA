// Unity's "Max Size" import setting, as an explicit action: what a downscale would produce. Pure.

export function planDownscale(width: number, height: number, maxSide: number): { width: number; height: number; scale: number } | null {
  if (!(width > 0 && height > 0 && maxSide > 0)) return null;
  const longest = Math.max(width, height);
  if (longest <= maxSide) return null;
  const scale = maxSide / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
}

/** Nine-slice borders are source pixels, so they shrink with the image or the slicing breaks. */
export function scaleSlice<T extends { left: number; top: number; right: number; bottom: number }>(slice: T | undefined, scale: number): T | undefined {
  if (!slice) return undefined;
  const r = (n: number) => Math.round(n * scale);
  return { ...slice, left: r(slice.left), top: r(slice.top), right: r(slice.right), bottom: r(slice.bottom) };
}
