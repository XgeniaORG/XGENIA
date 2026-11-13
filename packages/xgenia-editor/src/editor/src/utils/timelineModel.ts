/**
 * Timeline track model — the editor side of the Timeline node (net.xgenia.timeline).
 *
 * Pure: no editor imports, so the dock, the record hook and the tests share it. The runtime
 * evaluates the same JSON in packages/xgenia-viewer-react/src/nodes/std-library/timeline-eval.js;
 * tests/timeline/parity.test.ts runs both on the same tracks, so change them together.
 *
 * JSON (v1):
 *   { "v": 1, "tracks": [ { "id", "nodeId", "param", "unit": "px"|"%"|"deg"|null,
 *       "keys": [ { "t": seconds, "v": number, "ease": "linear"|"easeIn"|"easeOut"|"easeInOut"|
 *                   "step"|[x1,y1,x2,y2] } ] } ] }
 * A key's ease shapes the segment that ENDS at that key. Before the first key the first value
 * holds; after the last, the last value holds.
 *
 * Every edit returns a new document; inputs are never mutated (undo keeps the old JSON).
 */

export const TIMELINE_VERSION = 1;
export const TIMELINE_NODE_TYPE = 'net.xgenia.timeline';
/** Two keys closer than this on one track are the same key. */
export const KEY_EPSILON = 1 / 120;

export type TimelineEaseName = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'step';
export type TimelineEase = TimelineEaseName | [number, number, number, number];

export interface TimelineKey {
  t: number;
  v: number;
  ease?: TimelineEase;
}

export interface TimelineTrack {
  id: string;
  nodeId: string;
  param: string;
  unit: string | null;
  keys: TimelineKey[];
}

export interface TimelineDoc {
  v: number;
  tracks: TimelineTrack[];
}

export type TimelineValue = number | { value: number; unit: string };

export const EASE_NAMES: TimelineEaseName[] = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'step'];

export function emptyTimeline(): TimelineDoc {
  return { v: TIMELINE_VERSION, tracks: [] };
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function normalizeEase(ease: unknown): TimelineEase | undefined {
  if (typeof ease === 'string' && (EASE_NAMES as string[]).includes(ease)) return ease as TimelineEaseName;
  if (Array.isArray(ease) && ease.length === 4 && ease.every(isFiniteNumber)) {
    return [ease[0], ease[1], ease[2], ease[3]];
  }
  return undefined;
}

function sortKeys(keys: TimelineKey[]): TimelineKey[] {
  return keys.sort((a, b) => a.t - b.t);
}

function normalizeKeys(keys: unknown): TimelineKey[] {
  if (!Array.isArray(keys)) return [];
  const out: TimelineKey[] = [];
  for (const k of keys) {
    if (!k || typeof k !== 'object') continue;
    const t = Number((k as any).t);
    const v = Number((k as any).v);
    if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
    const key: TimelineKey = { t: Math.max(0, t), v };
    const ease = normalizeEase((k as any).ease);
    if (ease !== undefined) key.ease = ease;
    out.push(key);
  }
  return sortKeys(out);
}

/** Tracks JSON (string or object) to a clean document; malformed input reads as empty. */
export function parseTimeline(input: unknown): TimelineDoc {
  let raw: any = input;
  if (typeof raw === 'string') {
    if (!raw.trim()) return emptyTimeline();
    try {
      raw = JSON.parse(raw);
    } catch {
      return emptyTimeline();
    }
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.tracks)) return emptyTimeline();

  const tracks: TimelineTrack[] = [];
  for (const tr of raw.tracks) {
    if (!tr || typeof tr !== 'object') continue;
    if (typeof tr.nodeId !== 'string' || !tr.nodeId) continue;
    if (typeof tr.param !== 'string' || !tr.param) continue;
    tracks.push({
      id: typeof tr.id === 'string' && tr.id ? tr.id : `${tr.nodeId}:${tr.param}`,
      nodeId: tr.nodeId,
      param: tr.param,
      unit: typeof tr.unit === 'string' && tr.unit ? tr.unit : null,
      keys: normalizeKeys(tr.keys)
    });
  }
  return { v: TIMELINE_VERSION, tracks };
}

/** Times are stored to the microsecond so float drift does not grow the JSON. */
function roundTime(t: number): number {
  return Math.round(t * 1e6) / 1e6;
}

export function serializeTimeline(doc: TimelineDoc): string {
  return JSON.stringify({
    v: TIMELINE_VERSION,
    tracks: doc.tracks.map((tr) => ({
      id: tr.id,
      nodeId: tr.nodeId,
      param: tr.param,
      unit: tr.unit,
      keys: tr.keys.map((k) => (k.ease !== undefined ? { t: roundTime(k.t), v: k.v, ease: k.ease } : { t: roundTime(k.t), v: k.v }))
    }))
  });
}

// ---- evaluation (mirrors timeline-eval.js) -------------------------------------------------

function bezierProgress(x1: number, y1: number, x2: number, y2: number, u: number): number {
  x1 = Math.min(1, Math.max(0, x1));
  x2 = Math.min(1, Math.max(0, x2));
  if (x1 === y1 && x2 === y2) return u;

  const coord = (p1: number, p2: number, s: number) => {
    const inv = 1 - s;
    return 3 * inv * inv * s * p1 + 3 * inv * s * s * p2 + s * s * s;
  };
  const slope = (p1: number, p2: number, s: number) => {
    const inv = 1 - s;
    return 3 * inv * inv * p1 + 6 * inv * s * (p2 - p1) + 3 * s * s * (1 - p2);
  };

  let s = u;
  for (let i = 0; i < 8; i++) {
    const x = coord(x1, x2, s) - u;
    if (Math.abs(x) < 1e-7) return coord(y1, y2, s);
    const d = slope(x1, x2, s);
    if (Math.abs(d) < 1e-6) break;
    s -= x / d;
    if (s < 0 || s > 1) break;
  }
  let lo = 0;
  let hi = 1;
  s = u;
  for (let j = 0; j < 40; j++) {
    const xs = coord(x1, x2, s);
    if (Math.abs(xs - u) < 1e-7) break;
    if (xs < u) lo = s;
    else hi = s;
    s = (lo + hi) / 2;
  }
  return coord(y1, y2, s);
}

/** Eased progress 0..1 for a segment at linear progress u. */
export function easeProgress(ease: TimelineEase | undefined, u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  if (Array.isArray(ease)) return bezierProgress(ease[0], ease[1], ease[2], ease[3], u);
  switch (ease) {
    case 'step':
      return 0;
    case 'easeIn':
      return u * u * u;
    case 'easeOut': {
      const a = 1 - u;
      return 1 - a * a * a;
    }
    case 'easeInOut': {
      if (u < 0.5) return 4 * u * u * u;
      const b = 2 - 2 * u;
      return 1 - (b * b * b) / 2;
    }
    default:
      return u;
  }
}

export function evaluateKeys(keys: TimelineKey[] | undefined, t: number): number | undefined {
  if (!keys || keys.length === 0) return undefined;
  const first = keys[0];
  if (!(t > first.t)) return first.v;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.v;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (t >= a.t && t < b.t) {
      const span = b.t - a.t;
      if (span <= 0) return b.v;
      return a.v + (b.v - a.v) * easeProgress(b.ease, (t - a.t) / span);
    }
  }
  return last.v;
}

/** The track's raw number at t, or undefined when it has no keys. */
export function evaluateTrack(track: TimelineTrack | undefined, t: number): number | undefined {
  return track ? evaluateKeys(track.keys, t) : undefined;
}

export function trackValue(track: Pick<TimelineTrack, 'unit'>, v: number): TimelineValue {
  return track.unit ? { value: v, unit: track.unit } : v;
}

/** Every keyed param of one node at time t, in the shape its input takes. */
export function valuesAt(doc: TimelineDoc, nodeId: string, t: number): Record<string, TimelineValue> {
  const out: Record<string, TimelineValue> = {};
  for (const track of doc.tracks) {
    if (track.nodeId !== nodeId) continue;
    const v = evaluateTrack(track, t);
    if (v !== undefined) out[track.param] = trackValue(track, v);
  }
  return out;
}

export function lastKeyTime(doc: TimelineDoc): number {
  let max = 0;
  for (const tr of doc.tracks) if (tr.keys.length) max = Math.max(max, tr.keys[tr.keys.length - 1].t);
  return max;
}

// ---- edits --------------------------------------------------------------------------------

export function trackFor(doc: TimelineDoc, nodeId: string, param: string): TimelineTrack | undefined {
  return doc.tracks.find((tr) => tr.nodeId === nodeId && tr.param === param);
}

export function trackById(doc: TimelineDoc, trackId: string): TimelineTrack | undefined {
  return doc.tracks.find((tr) => tr.id === trackId);
}

function cloneTrack(tr: TimelineTrack): TimelineTrack {
  return { ...tr, keys: tr.keys.map((k) => ({ ...k })) };
}

function withTrack(doc: TimelineDoc, track: TimelineTrack): TimelineDoc {
  const i = doc.tracks.findIndex((tr) => tr.id === track.id);
  const tracks = doc.tracks.slice();
  if (i === -1) tracks.push(track);
  else tracks[i] = track;
  return { v: TIMELINE_VERSION, tracks };
}

function uniqueTrackId(doc: TimelineDoc, nodeId: string, param: string): string {
  const base = `${nodeId}:${param}`;
  if (!doc.tracks.some((tr) => tr.id === base)) return base;
  let n = 2;
  while (doc.tracks.some((tr) => tr.id === `${base}:${n}`)) n++;
  return `${base}:${n}`;
}

/** Add an empty track for nodeId.param (no-op when one exists). */
export function addTrack(doc: TimelineDoc, args: { nodeId: string; param: string; unit?: string | null }): TimelineDoc {
  if (trackFor(doc, args.nodeId, args.param)) return doc;
  return withTrack(doc, {
    id: uniqueTrackId(doc, args.nodeId, args.param),
    nodeId: args.nodeId,
    param: args.param,
    unit: args.unit || null,
    keys: []
  });
}

export function removeTrack(doc: TimelineDoc, trackId: string): TimelineDoc {
  return { v: TIMELINE_VERSION, tracks: doc.tracks.filter((tr) => tr.id !== trackId) };
}

/** Index of the key nearest t within KEY_EPSILON, or -1. */
function keyIndexAt(keys: TimelineKey[], t: number): number {
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < keys.length; i++) {
    const d = Math.abs(keys[i].t - t);
    if (d <= KEY_EPSILON + 1e-9 && d < bestDist) {
      best = i;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Set a key on nodeId.param at t, creating the track if needed. A key already within
 * KEY_EPSILON of t is replaced (its ease kept unless a new one is given).
 */
export function upsertKey(
  doc: TimelineDoc,
  args: { nodeId: string; param: string; unit?: string | null; t: number; v: number; ease?: TimelineEase }
): TimelineDoc {
  if (!Number.isFinite(args.t) || !Number.isFinite(args.v)) return doc;
  const t = Math.max(0, args.t);
  const existing = trackFor(doc, args.nodeId, args.param);
  const track: TimelineTrack = existing
    ? cloneTrack(existing)
    : { id: uniqueTrackId(doc, args.nodeId, args.param), nodeId: args.nodeId, param: args.param, unit: args.unit || null, keys: [] };
  if (args.unit !== undefined && args.unit !== null && args.unit !== '') track.unit = args.unit;

  const i = keyIndexAt(track.keys, t);
  const ease = args.ease !== undefined ? args.ease : i !== -1 ? track.keys[i].ease : undefined;
  const key: TimelineKey = ease !== undefined ? { t, v: args.v, ease } : { t, v: args.v };
  if (i !== -1) track.keys[i] = key;
  else track.keys.push(key);
  sortKeys(track.keys);
  return withTrack(doc, track);
}

/** Remove the key at t (within KEY_EPSILON) from a track. */
export function removeKey(doc: TimelineDoc, trackId: string, t: number): TimelineDoc {
  const existing = trackById(doc, trackId);
  if (!existing) return doc;
  const i = keyIndexAt(existing.keys, t);
  if (i === -1) return doc;
  const track = cloneTrack(existing);
  track.keys.splice(i, 1);
  return withTrack(doc, track);
}

export interface KeyRef {
  trackId: string;
  t: number;
}

export function removeKeys(doc: TimelineDoc, refs: KeyRef[]): TimelineDoc {
  let out = doc;
  for (const r of refs) out = removeKey(out, r.trackId, r.t);
  return out;
}

/** Move the key at fromT to toT on a track; a key already at toT is replaced. */
export function moveKey(doc: TimelineDoc, trackId: string, fromT: number, toT: number): TimelineDoc {
  return moveKeys(doc, [{ trackId, t: fromT }], toT - fromT);
}

/**
 * Shift several keys by dt together (a multi-key drag). Moved keys land on, and replace,
 * any unmoved key within KEY_EPSILON. Times clamp at 0.
 */
export function moveKeys(doc: TimelineDoc, refs: KeyRef[], dt: number): TimelineDoc {
  if (!Number.isFinite(dt) || dt === 0 || refs.length === 0) return doc;
  let out = doc;
  const byTrack = new Map<string, number[]>();
  for (const r of refs) {
    const list = byTrack.get(r.trackId) || [];
    list.push(r.t);
    byTrack.set(r.trackId, list);
  }
  for (const [trackId, times] of byTrack) {
    const existing = trackById(out, trackId);
    if (!existing) continue;
    const track = cloneTrack(existing);
    const moving: TimelineKey[] = [];
    for (const t of times) {
      const i = keyIndexAt(track.keys, t);
      if (i === -1) continue;
      moving.push(track.keys[i]);
      track.keys.splice(i, 1);
    }
    for (const key of moving) {
      const nt = Math.max(0, key.t + dt);
      const clash = keyIndexAt(track.keys, nt);
      if (clash !== -1) track.keys.splice(clash, 1);
      track.keys.push({ ...key, t: nt });
    }
    sortKeys(track.keys);
    out = withTrack(out, track);
  }
  return out;
}

/** Set the ease of the key at t on a track (the curve INTO that key). */
export function setKeyEase(doc: TimelineDoc, trackId: string, t: number, ease: TimelineEase | undefined): TimelineDoc {
  const existing = trackById(doc, trackId);
  if (!existing) return doc;
  const i = keyIndexAt(existing.keys, t);
  if (i === -1) return doc;
  const track = cloneTrack(existing);
  const { ease: _old, ...rest } = track.keys[i];
  track.keys[i] = ease !== undefined ? { ...rest, ease } : rest;
  return withTrack(doc, track);
}

// ---- values -------------------------------------------------------------------------------

/**
 * A parameter value as a number plus unit: {value, unit} objects, numbers and '12px'/'50%'
 * strings. null for anything that is not a number (enums, colours, booleans).
 */
export function numericValue(value: unknown): { value: number; unit: string | null } | null {
  if (isFiniteNumber(value)) return { value, unit: null };
  if (value && typeof value === 'object' && isFiniteNumber((value as any).value)) {
    const unit = (value as any).unit;
    return { value: (value as any).value, unit: typeof unit === 'string' && unit ? unit : null };
  }
  if (typeof value === 'string') {
    const m = value.trim().match(/^(-?\d+(?:\.\d+)?|-?\.\d+)\s*(px|%|deg|vw|vh)?$/);
    if (m) return { value: parseFloat(m[1]), unit: m[2] || null };
  }
  return null;
}
