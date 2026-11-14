/**
 * Resizing a node in the viewport scales what is inside it: a button dragged twice as wide
 * takes its picture and label with it. Sizes and offsets written in % already follow the
 * parent, so only pixel values are touched. Pure: params in, parameter writes out.
 */

const HORIZONTAL = ['width', 'minWidth', 'maxWidth', 'transformX', 'marginLeft', 'marginRight', 'marginX', 'paddingLeft', 'paddingRight'];
const VERTICAL = ['height', 'minHeight', 'maxHeight', 'transformY', 'marginTop', 'marginBottom', 'marginY', 'paddingTop', 'paddingBottom'];
/** No axis of their own: they follow the smaller ratio, so widening a button alone leaves its text size be. */
const UNIFORM = ['fontSize', 'borderRadius', 'borderWidth'];

export interface ParamWrite {
  param: string;
  value: any;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** The value scaled, in the form it was written in; undefined when it is not a pixel value. */
function scaled(value: any, k: number): any {
  if (typeof value === 'number') return Number.isFinite(value) ? round2(value * k) : undefined;
  if (value && typeof value === 'object') {
    if (typeof value.value !== 'number' || !Number.isFinite(value.value)) return undefined;
    if (value.unit !== undefined && value.unit !== 'px' && value.unit !== '') return undefined;
    return { ...value, value: round2(value.value * k) };
  }
  if (typeof value === 'string') {
    const m = value.trim().match(/^(-?[\d.]+)\s*(px)?$/);
    if (!m) return undefined;
    const n = round2(parseFloat(m[1]) * k);
    return Number.isFinite(n) ? n + (m[2] || '') : undefined;
  }
  return undefined;
}

/** The writes that scale one descendant's pixel values by (sx, sy). Empty when nothing changes. */
export function scaleChildWrites(params: Record<string, any>, sx: number, sy: number): ParamWrite[] {
  if (!params || !(sx > 0) || !(sy > 0) || !Number.isFinite(sx) || !Number.isFinite(sy)) return [];
  const writes: ParamWrite[] = [];
  const add = (names: string[], k: number) => {
    if (Math.abs(k - 1) < 1e-6) return;
    for (const param of names) {
      if (!(param in params)) continue;
      const value = scaled(params[param], k);
      if (value === undefined || JSON.stringify(value) === JSON.stringify(params[param])) continue;
      writes.push({ param, value });
    }
  };
  add(HORIZONTAL, sx);
  add(VERTICAL, sy);
  add(UNIFORM, Math.min(sx, sy));
  return writes;
}

/** True when the axis follows the parent by itself (a % size), so a preview must not scale it again. */
export function followsParent(value: any): boolean {
  if (value && typeof value === 'object') return value.unit === '%';
  return typeof value === 'string' && /%\s*$/.test(value);
}
