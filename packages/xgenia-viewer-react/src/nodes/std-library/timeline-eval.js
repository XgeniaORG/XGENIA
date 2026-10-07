'use strict';

// Pure keyframe evaluation for the Timeline node (net.xgenia.timeline). No runtime or DOM
// dependencies, so a node:test parity test can load it next to the editor's
// timelineModel.ts and check both give the same value for the same tracks.
//
// Track JSON (v1):
//   { "v": 1, "tracks": [ { "id", "nodeId", "param", "unit": "px"|"%"|"deg"|null,
//       "keys": [ { "t": seconds, "v": number, "ease": "linear"|"easeIn"|"easeOut"|
//                   "easeInOut"|"step"|[x1,y1,x2,y2] } ] } ] }
// A key's ease shapes the segment that ENDS at that key; the first key's ease is unused.
// Before the first key the first value holds, after the last key the last value holds.

var VERSION = 1;

function emptyDoc() {
  return { v: VERSION, tracks: [] };
}

function isFiniteNumber(n) {
  return typeof n === 'number' && isFinite(n);
}

function normalizeEase(ease) {
  if (ease === 'linear' || ease === 'easeIn' || ease === 'easeOut' || ease === 'easeInOut' || ease === 'step') {
    return ease;
  }
  if (Array.isArray(ease) && ease.length === 4 && ease.every(isFiniteNumber)) {
    return [ease[0], ease[1], ease[2], ease[3]];
  }
  return undefined;
}

function normalizeKeys(keys) {
  if (!Array.isArray(keys)) return [];
  var out = [];
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (!k || typeof k !== 'object') continue;
    var t = Number(k.t);
    var v = Number(k.v);
    if (!isFinite(t) || !isFinite(v)) continue;
    var key = { t: Math.max(0, t), v: v };
    var ease = normalizeEase(k.ease);
    if (ease !== undefined) key.ease = ease;
    out.push(key);
  }
  out.sort(function (a, b) {
    return a.t - b.t;
  });
  return out;
}

/** Tracks JSON (string or object) to a clean document. Anything malformed reads as empty. */
function parseTimeline(input) {
  var raw = input;
  if (typeof raw === 'string') {
    if (!raw.trim()) return emptyDoc();
    try {
      raw = JSON.parse(raw);
    } catch (e) {
      return emptyDoc();
    }
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.tracks)) return emptyDoc();

  var tracks = [];
  for (var i = 0; i < raw.tracks.length; i++) {
    var tr = raw.tracks[i];
    if (!tr || typeof tr !== 'object') continue;
    if (typeof tr.nodeId !== 'string' || !tr.nodeId) continue;
    if (typeof tr.param !== 'string' || !tr.param) continue;
    var unit = typeof tr.unit === 'string' && tr.unit ? tr.unit : null;
    tracks.push({
      id: typeof tr.id === 'string' && tr.id ? tr.id : tr.nodeId + ':' + tr.param,
      nodeId: tr.nodeId,
      param: tr.param,
      unit: unit,
      keys: normalizeKeys(tr.keys)
    });
  }
  return { v: VERSION, tracks: tracks };
}

// Cubic bezier ease with fixed endpoints (0,0) and (1,1), CSS cubic-bezier semantics.
function bezierProgress(x1, y1, x2, y2, u) {
  x1 = Math.min(1, Math.max(0, x1));
  x2 = Math.min(1, Math.max(0, x2));
  if (x1 === y1 && x2 === y2) return u;

  function coord(p1, p2, s) {
    var inv = 1 - s;
    return 3 * inv * inv * s * p1 + 3 * inv * s * s * p2 + s * s * s;
  }
  function slope(p1, p2, s) {
    var inv = 1 - s;
    return 3 * inv * inv * p1 + 6 * inv * s * (p2 - p1) + 3 * s * s * (1 - p2);
  }

  // Newton first, bisection when the slope flattens out.
  var s = u;
  for (var i = 0; i < 8; i++) {
    var x = coord(x1, x2, s) - u;
    if (Math.abs(x) < 1e-7) return coord(y1, y2, s);
    var d = slope(x1, x2, s);
    if (Math.abs(d) < 1e-6) break;
    s -= x / d;
    if (s < 0 || s > 1) break;
  }
  var lo = 0;
  var hi = 1;
  s = u;
  for (var j = 0; j < 40; j++) {
    var xs = coord(x1, x2, s);
    if (Math.abs(xs - u) < 1e-7) break;
    if (xs < u) lo = s;
    else hi = s;
    s = (lo + hi) / 2;
  }
  return coord(y1, y2, s);
}

/** Eased progress 0..1 for a segment at linear progress u (0..1). */
function easeProgress(ease, u) {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  if (Array.isArray(ease)) return bezierProgress(ease[0], ease[1], ease[2], ease[3], u);
  switch (ease) {
    case 'step':
      return 0;
    case 'easeIn':
      return u * u * u;
    case 'easeOut': {
      var a = 1 - u;
      return 1 - a * a * a;
    }
    case 'easeInOut': {
      if (u < 0.5) return 4 * u * u * u;
      var b = 2 - 2 * u;
      return 1 - (b * b * b) / 2;
    }
    default:
      return u;
  }
}

/** Value of sorted keys at time t (seconds); undefined when there are no keys. */
function evaluateKeys(keys, t) {
  if (!keys || keys.length === 0) return undefined;
  var first = keys[0];
  if (!(t > first.t)) return first.v;
  var last = keys[keys.length - 1];
  if (t >= last.t) return last.v;
  for (var i = 0; i < keys.length - 1; i++) {
    var a = keys[i];
    var b = keys[i + 1];
    if (t >= a.t && t < b.t) {
      var span = b.t - a.t;
      if (span <= 0) return b.v;
      var e = easeProgress(b.ease, (t - a.t) / span);
      return a.v + (b.v - a.v) * e;
    }
  }
  return last.v;
}

function evaluateTrack(track, t) {
  return track ? evaluateKeys(track.keys, t) : undefined;
}

/** The value a target input receives: {value, unit} for unit params, a number otherwise. */
function valueForTrack(track, v) {
  return track && track.unit ? { value: v, unit: track.unit } : v;
}

/** Last key time across all tracks (0 when empty). */
function lastKeyTime(doc) {
  var max = 0;
  var tracks = (doc && doc.tracks) || [];
  for (var i = 0; i < tracks.length; i++) {
    var keys = tracks[i].keys;
    if (keys && keys.length) max = Math.max(max, keys[keys.length - 1].t);
  }
  return max;
}

module.exports = {
  VERSION: VERSION,
  emptyDoc: emptyDoc,
  parseTimeline: parseTimeline,
  easeProgress: easeProgress,
  evaluateKeys: evaluateKeys,
  evaluateTrack: evaluateTrack,
  valueForTrack: valueForTrack,
  lastKeyTime: lastKeyTime
};
