import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KEY_EPSILON,
  addTrack,
  easeProgress,
  emptyTimeline,
  evaluateTrack,
  lastKeyTime,
  moveKey,
  moveKeys,
  numericValue,
  parseTimeline,
  removeKey,
  removeKeys,
  removeTrack,
  serializeTimeline,
  setKeyEase,
  trackFor,
  upsertKey,
  valuesAt,
  type TimelineDoc,
  type TimelineTrack
} from '../../src/editor/src/utils/timelineModel';

const near = (a: number | undefined, b: number, eps = 1e-6) => {
  assert.ok(a !== undefined && Math.abs(a - b) <= eps, `expected ${a} ≈ ${b}`);
};

function track(keys: TimelineTrack['keys'], extra: Partial<TimelineTrack> = {}): TimelineTrack {
  return { id: 'n1:transformX', nodeId: 'n1', param: 'transformX', unit: 'px', keys, ...extra };
}

test('parse tolerates bad input as an empty timeline', () => {
  for (const bad of [undefined, null, '', '   ', '{nope', '[]', '42', { tracks: 'x' }, { v: 1 }]) {
    assert.deepEqual(parseTimeline(bad as any), emptyTimeline());
  }
});

test('parse drops malformed tracks and keys, sorts keys and clamps negative times', () => {
  const doc = parseTimeline(
    JSON.stringify({
      v: 1,
      tracks: [
        { nodeId: 'a', param: 'opacity', keys: [{ t: 1, v: 0 }, { t: -2, v: 1 }, { t: 'x', v: 2 }, null, { t: 0.5, v: 0.5, ease: 'bogus' }] },
        { nodeId: '', param: 'x', keys: [] },
        { nodeId: 'b', keys: [] },
        'junk'
      ]
    })
  );
  assert.equal(doc.tracks.length, 1);
  const tr = doc.tracks[0];
  assert.equal(tr.id, 'a:opacity');
  assert.equal(tr.unit, null);
  assert.deepEqual(tr.keys, [{ t: 0, v: 1 }, { t: 0.5, v: 0.5 }, { t: 1, v: 0 }]);
});

test('serialize round-trips through parse', () => {
  let doc = upsertKey(emptyTimeline(), { nodeId: 'n1', param: 'transformX', unit: 'px', t: 0, v: 0 });
  doc = upsertKey(doc, { nodeId: 'n1', param: 'transformX', t: 1, v: 100, ease: [0.4, 0, 0.2, 1] });
  doc = upsertKey(doc, { nodeId: 'n2', param: 'opacity', unit: null, t: 0.25, v: 0.5, ease: 'step' });
  const json = serializeTimeline(doc);
  assert.deepEqual(parseTimeline(json), doc);
  assert.equal(JSON.parse(json).v, 1);
});

test('evaluate clamps before the first and after the last key', () => {
  const tr = track([
    { t: 0.5, v: 10 },
    { t: 1.5, v: 30 }
  ]);
  assert.equal(evaluateTrack(tr, 0), 10);
  assert.equal(evaluateTrack(tr, 0.5), 10);
  assert.equal(evaluateTrack(tr, 1.5), 30);
  assert.equal(evaluateTrack(tr, 9), 30);
  near(evaluateTrack(tr, 1), 20);
  assert.equal(evaluateTrack(track([]), 1), undefined);
  assert.equal(evaluateTrack(undefined, 1), undefined);
  assert.equal(evaluateTrack(track([{ t: 2, v: 7 }]), 0), 7);
});

test('a key’s ease shapes the segment that ends at it', () => {
  const tr = track([
    { t: 0, v: 0, ease: 'step' }, // first key's ease is unused
    { t: 1, v: 100, ease: 'easeIn' },
    { t: 2, v: 0 }
  ]);
  near(evaluateTrack(tr, 0.5), 12.5); // 0.5^3 * 100
  near(evaluateTrack(tr, 1.5), 50); // linear back down
});

test('easing curves: linear, cubic in/out/in-out, step and bezier', () => {
  near(easeProgress('linear', 0.3), 0.3);
  near(easeProgress(undefined, 0.3), 0.3);
  near(easeProgress('easeIn', 0.5), 0.125);
  near(easeProgress('easeOut', 0.5), 0.875);
  near(easeProgress('easeInOut', 0.25), 0.0625);
  near(easeProgress('easeInOut', 0.75), 0.9375);
  near(easeProgress('easeInOut', 0.5), 0.5);
  assert.equal(easeProgress('step', 0.999), 0);
  assert.equal(easeProgress('step', 1), 1);
  // linear bezier is the identity; ease-in-out bezier is symmetric about 0.5
  near(easeProgress([0.25, 0.25, 0.75, 0.75], 0.37), 0.37);
  near(easeProgress([0.42, 0, 0.58, 1], 0.5), 0.5, 1e-5);
  const a = easeProgress([0.42, 0, 0.58, 1], 0.2);
  const b = easeProgress([0.42, 0, 0.58, 1], 0.8);
  near(a + b, 1, 1e-5);
  assert.ok(a < 0.2, 'ease-in-out starts slow');
  // CSS "ease" at x=0.5 is ~0.8024
  near(easeProgress([0.25, 0.1, 0.25, 1], 0.5), 0.8024, 1e-3);
});

test('step holds the previous value until the key time', () => {
  const tr = track([
    { t: 0, v: 1 },
    { t: 1, v: 5, ease: 'step' }
  ]);
  assert.equal(evaluateTrack(tr, 0.99), 1);
  assert.equal(evaluateTrack(tr, 1), 5);
});

test('valuesAt returns unit params as {value, unit} and unitless as numbers', () => {
  let doc = upsertKey(emptyTimeline(), { nodeId: 'n1', param: 'transformX', unit: 'px', t: 0, v: 0 });
  doc = upsertKey(doc, { nodeId: 'n1', param: 'transformX', t: 1, v: 100 });
  doc = upsertKey(doc, { nodeId: 'n1', param: 'opacity', unit: null, t: 0, v: 1 });
  doc = upsertKey(doc, { nodeId: 'n2', param: 'transformY', unit: '%', t: 0, v: 50 });
  assert.deepEqual(valuesAt(doc, 'n1', 0.5), { transformX: { value: 50, unit: 'px' }, opacity: 1 });
  assert.deepEqual(valuesAt(doc, 'n2', 3), { transformY: { value: 50, unit: '%' } });
  assert.deepEqual(valuesAt(doc, 'zz', 0), {});
  doc = addTrack(doc, { nodeId: 'n3', param: 'x' });
  assert.deepEqual(valuesAt(doc, 'n3', 0), {}, 'a track with no keys contributes nothing');
});

test('upsert creates the track, replaces a key within 1/120 s and does not mutate its input', () => {
  const d0 = emptyTimeline();
  const d1 = upsertKey(d0, { nodeId: 'n1', param: 'transformRotation', unit: 'deg', t: 0.5, v: 10 });
  assert.equal(d0.tracks.length, 0);
  assert.equal(d1.tracks.length, 1);
  assert.equal(trackFor(d1, 'n1', 'transformRotation')?.unit, 'deg');

  const d2 = upsertKey(d1, { nodeId: 'n1', param: 'transformRotation', t: 0.5 + KEY_EPSILON * 0.9, v: 20 });
  const keys = trackFor(d2, 'n1', 'transformRotation')!.keys;
  assert.equal(keys.length, 1, 'replaced, not added');
  assert.equal(keys[0].v, 20);
  assert.equal(trackFor(d1, 'n1', 'transformRotation')!.keys[0].v, 10, 'input untouched');

  // 1.6 windows from the (replaced, now later) key
  const d3 = upsertKey(d2, { nodeId: 'n1', param: 'transformRotation', t: 0.5 + KEY_EPSILON * 2.5, v: 30 });
  assert.equal(trackFor(d3, 'n1', 'transformRotation')!.keys.length, 2, 'outside the window adds a key');

  const d4 = upsertKey(d3, { nodeId: 'n1', param: 'transformRotation', t: 0.1, v: 0 });
  assert.deepEqual(
    trackFor(d4, 'n1', 'transformRotation')!.keys.map((k) => k.t),
    [0.1, 0.5 + KEY_EPSILON * 0.9, 0.5 + KEY_EPSILON * 2.5],
    'kept sorted'
  );
  assert.equal(upsertKey(d4, { nodeId: 'n1', param: 'transformRotation', t: NaN, v: 1 }), d4);
});

test('upsert keeps a replaced key’s ease unless a new one is given', () => {
  let doc = upsertKey(emptyTimeline(), { nodeId: 'n', param: 'x', t: 1, v: 1, ease: 'easeOut' });
  doc = upsertKey(doc, { nodeId: 'n', param: 'x', t: 1, v: 2 });
  assert.equal(trackFor(doc, 'n', 'x')!.keys[0].ease, 'easeOut');
  doc = upsertKey(doc, { nodeId: 'n', param: 'x', t: 1, v: 3, ease: 'step' });
  assert.equal(trackFor(doc, 'n', 'x')!.keys[0].ease, 'step');
});

function threeKeys(): TimelineDoc {
  let doc = emptyTimeline();
  for (const [t, v] of [
    [0, 0],
    [1, 10],
    [2, 20]
  ]) {
    doc = upsertKey(doc, { nodeId: 'n', param: 'x', t, v });
  }
  return doc;
}

test('moveKey moves in time, replaces a key it lands on, clamps at 0', () => {
  const doc = threeKeys();
  const id = doc.tracks[0].id;
  assert.deepEqual(moveKey(doc, id, 1, 1.5).tracks[0].keys, [
    { t: 0, v: 0 },
    { t: 1.5, v: 10 },
    { t: 2, v: 20 }
  ]);
  assert.deepEqual(moveKey(doc, id, 1, 2).tracks[0].keys, [
    { t: 0, v: 0 },
    { t: 2, v: 10 }
  ]);
  assert.deepEqual(moveKey(doc, id, 2, -5).tracks[0].keys, [
    { t: 0, v: 20 },
    { t: 1, v: 10 }
  ]);
  assert.deepEqual(moveKey(doc, id, 7, 8).tracks[0].keys, doc.tracks[0].keys, 'no key at 7: unchanged');
});

test('moveKeys shifts a multi-key selection together', () => {
  const doc = threeKeys();
  const id = doc.tracks[0].id;
  const moved = moveKeys(doc, [
    { trackId: id, t: 1 },
    { trackId: id, t: 2 }
  ], 0.5);
  assert.deepEqual(moved.tracks[0].keys, [
    { t: 0, v: 0 },
    { t: 1.5, v: 10 },
    { t: 2.5, v: 20 }
  ]);
  assert.equal(moveKeys(doc, [{ trackId: id, t: 1 }], 0), doc);
});

test('removeKey, removeKeys, removeTrack and setKeyEase', () => {
  const doc = threeKeys();
  const id = doc.tracks[0].id;
  assert.deepEqual(removeKey(doc, id, 1 + KEY_EPSILON / 2).tracks[0].keys.map((k) => k.t), [0, 2]);
  assert.equal(removeKey(doc, id, 1.5), doc, 'no key there');
  assert.equal(removeKey(doc, 'nope', 1), doc);
  assert.deepEqual(removeKeys(doc, [{ trackId: id, t: 0 }, { trackId: id, t: 2 }]).tracks[0].keys, [{ t: 1, v: 10 }]);
  assert.equal(removeTrack(doc, id).tracks.length, 0);
  const eased = setKeyEase(doc, id, 1, 'easeInOut');
  assert.equal(eased.tracks[0].keys[1].ease, 'easeInOut');
  assert.equal(setKeyEase(eased, id, 1, undefined).tracks[0].keys[1].ease, undefined);
  assert.equal(lastKeyTime(doc), 2);
  assert.equal(lastKeyTime(emptyTimeline()), 0);
});

test('addTrack is idempotent per node and param', () => {
  const d1 = addTrack(emptyTimeline(), { nodeId: 'n', param: 'x', unit: null });
  assert.equal(addTrack(d1, { nodeId: 'n', param: 'x' }), d1);
  assert.equal(d1.tracks[0].keys.length, 0);
});

test('numericValue reads dimension objects, numbers and unit strings only', () => {
  assert.deepEqual(numericValue(5), { value: 5, unit: null });
  assert.deepEqual(numericValue({ value: 12, unit: 'px', isFixed: true }), { value: 12, unit: 'px' });
  assert.deepEqual(numericValue({ value: 3 }), { value: 3, unit: null });
  assert.deepEqual(numericValue('50%'), { value: 50, unit: '%' });
  assert.deepEqual(numericValue('-12.5px'), { value: -12.5, unit: 'px' });
  assert.equal(numericValue('explicit'), null);
  assert.equal(numericValue(true), null);
  assert.equal(numericValue(NaN), null);
  assert.equal(numericValue({ value: 'x' }), null);
});
