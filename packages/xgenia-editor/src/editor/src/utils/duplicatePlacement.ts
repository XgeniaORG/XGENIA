/** How far a duplicate of a freely placed node is offset, so it is visibly a second one. */
export const DUPLICATE_OFFSET = 10;

const FREE_POSITIONS = new Set(['absolute', 'fixed']);

/** A px offset param, or null when it is a % or unreadable (those are left alone). */
function pxValue(v: any): { value: number; asObject: boolean; source: any } | null {
  if (v === undefined || v === null || v === '') return { value: 0, asObject: true, source: v };
  if (typeof v === 'number') return { value: v, asObject: false, source: v };
  if (typeof v === 'object' && typeof v.value === 'number') {
    return v.unit && v.unit !== 'px' ? null : { value: v.value, asObject: true, source: v };
  }
  const m = String(v).trim().match(/^(-?[\d.]+)\s*(px)?$/);
  return m ? { value: parseFloat(m[1]), asObject: true, source: v } : null;
}

function bumped(p: { value: number; asObject: boolean; source: any }) {
  const value = p.value + DUPLICATE_OFFSET;
  if (!p.asObject) return value;
  const src = p.source && typeof p.source === 'object' ? p.source : {};
  return { ...src, value, unit: 'px' };
}

/**
 * The parameter writes that place a duplicate next to its original. A node layout owns
 * (in a flex row or column) lands in the next slot by itself; a freely placed one would sit
 * exactly on top of the original, so it moves down-right by DUPLICATE_OFFSET.
 */
export function duplicateOffsetWrites(
  parameters: Record<string, any>,
  typename: string,
  parentLayout?: string
): Array<{ param: string; value: any }> {
  const params = parameters || {};
  const writes: Array<{ param: string; value: any }> = [];

  if (String(typename || '').startsWith('pixi.')) {
    for (const param of ['x', 'y']) {
      const v = params[param];
      writes.push({ param, value: (typeof v === 'number' ? v : 0) + DUPLICATE_OFFSET });
    }
    return writes;
  }

  const position = String(params.position || 'relative').toLowerCase();
  if (!FREE_POSITIONS.has(position) && parentLayout !== 'none') return writes;

  for (const param of ['transformX', 'transformY']) {
    const p = pxValue(params[param]);
    if (p) writes.push({ param, value: bumped(p) });
  }
  return writes;
}
