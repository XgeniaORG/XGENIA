import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapSize, dragSize, clampSize, FRAME_MIN, FRAME_MAX_W, FRAME_MAX_H } from '../../src/editor/src/views/VisualCanvas/frameSnap';

const presets = [
  { name: 'Fit viewport', width: null, height: null },
  { name: 'Full HD 1080p', width: 1920, height: 1080 },
  { name: 'iPhone 15', width: 393, height: 852 }
];

test('snaps within tolerance on both axes', () => {
  assert.deepEqual(snapSize(1900, 1095, presets, 24), { width: 1920, height: 1080, deviceName: 'Full HD 1080p' });
});
test('does not snap when one axis is outside tolerance', () => {
  assert.deepEqual(snapSize(1900, 1200, presets, 24), { width: 1900, height: 1200, deviceName: null });
});
test('exact match snaps with zero tolerance', () => {
  assert.equal(snapSize(393, 852, presets, 0).deviceName, 'iPhone 15');
});
test('null presets are ignored', () => {
  // A preset with a null axis is never a snap candidate, however wide the tolerance.
  assert.equal(snapSize(10, 10, [presets[0]], 1000).deviceName, null);
  assert.notEqual(snapSize(10, 10, presets, 1000).deviceName, 'Fit viewport');
});
test('clamps to bounds', () => {
  assert.deepEqual(snapSize(10, 10, [], 0), { width: FRAME_MIN, height: FRAME_MIN, deviceName: null });
  assert.deepEqual(snapSize(9999, 9999, [], 0), { width: FRAME_MAX_W, height: FRAME_MAX_H, deviceName: null });
});
test('rounds to integers', () => {
  assert.deepEqual(snapSize(1000.6, 700.2, [], 0), { width: 1001, height: 700, deviceName: null });
});
test('nearest preset wins when two are in tolerance', () => {
  const p = [{ name: 'A', width: 1000, height: 1000 }, { name: 'B', width: 1010, height: 1000 }];
  assert.equal(snapSize(1008, 1000, p, 24).deviceName, 'B');
});

// --- regression tests added after the adversarial review ---
test('a snapped preset is clamped and rounded like any other result', () => {
  assert.deepEqual(snapSize(10, 10, [{ name: 'Tiny', width: 300, height: 300 }], 24), { width: FRAME_MIN, height: FRAME_MIN, deviceName: 'Tiny' });
  const huge = snapSize(99999, 99999, [{ name: 'Huge', width: 3860, height: 2180 }], 24);
  assert.equal(huge.width, FRAME_MAX_W);
  assert.equal(huge.height, FRAME_MAX_H);
  const frac = snapSize(1000, 1000, [{ name: 'F', width: 1000.4, height: 1000.6 }], 24);
  assert.equal(frac.width, 1000);
  assert.equal(frac.height, 1001);
});

test('non-finite input never escapes as NaN', () => {
  for (const [w, h] of [[NaN, 500], [500, NaN], [Infinity, Infinity], [NaN, NaN]] as const) {
    const r = snapSize(w, h, presets, 24);
    assert.ok(Number.isFinite(r.width) && Number.isFinite(r.height), `NaN leaked for ${w}x${h}`);
    assert.ok(r.width >= FRAME_MIN && r.width <= FRAME_MAX_W);
    assert.ok(r.height >= FRAME_MIN && r.height <= FRAME_MAX_H);
  }
});

test('a preset with non-finite dimensions is skipped, not matched', () => {
  const r = snapSize(1000, 1000, [{ name: 'Bad', width: NaN, height: NaN }], 10_000);
  assert.equal(r.deviceName, null);
});

// --- single-axis drags must not change the axis they hold fixed ---
test('an x drag only snaps to presets with the same height', () => {
  const p = [{ name: 'iPhone 15 Pro', width: 393, height: 852 }, { name: 'iPhone 14', width: 390, height: 844 }];
  // 368x852: only iPhone 14 is within tolerance, and snapping to it would change the height.
  assert.deepEqual(snapSize(368, 852, p, 24, 'x'), { width: 368, height: 852, deviceName: null });
  assert.equal(snapSize(368, 852, p, 24, 'xy').deviceName, 'iPhone 14');
  // A preset that shares the fixed height still snaps.
  assert.deepEqual(snapSize(391, 852, p, 24, 'x'), { width: 393, height: 852, deviceName: 'iPhone 15 Pro' });
});
test('a y drag only snaps to presets with the same width', () => {
  const p = [{ name: 'Galaxy S24 Ultra', width: 412, height: 915 }, { name: 'iPhone 15 Pro Max', width: 430, height: 932 }];
  const r = snapSize(412, 930, p, 24, 'y');
  assert.equal(r.width, 412);
  assert.equal(r.deviceName, 'Galaxy S24 Ultra');
});
test('no single-axis drag across the real presets changes the fixed axis', async () => {
  const { screenSizesWithDividers } = await import('../../src/editor/src/views/EditorTopbar/ScreenSizes');
  const real = screenSizesWithDividers.filter((s) => typeof s !== 'string') as { name: string; width: number | null; height: number | null }[];
  for (const p of real) {
    if (p.width === null || p.height === null) continue;
    for (let d = -40; d <= 40; d++) {
      assert.equal(snapSize(p.width + d, p.height, real, 24, 'x').height, p.height, `${p.name} x${d}`);
      assert.equal(snapSize(p.width, p.height + d, real, 24, 'y').width, p.width, `${p.name} y${d}`);
    }
  }
});

// --- dragSize: pointer delta to device size ---
test('a frame at 100% gets twice the pointer delta, so its centred edge tracks the cursor', () => {
  const r = dragSize({ axis: 'x', w0: 1000, h0: 700, scale: 1 }, -60, 0, [], 24);
  assert.deepEqual(r, { width: 880, height: 700, deviceName: null });
  // Float error in the measured scale still counts as 100%.
  assert.equal(dragSize({ axis: 'y', w0: 1000, h0: 700, scale: 0.9995 }, 0, 30, [], 24).height, 760);
});
test('a scaled-down frame keeps the 1:1 mapping', () => {
  const r = dragSize({ axis: 'x', w0: 1920, h0: 1080, scale: 0.5 }, -100, 0, [], 24);
  assert.equal(r.width, 1720);
});
test('dragSize only moves the dragged axes', () => {
  assert.equal(dragSize({ axis: 'x', w0: 1000, h0: 700, scale: 1 }, 10, 500, [], 24).height, 700);
  assert.equal(dragSize({ axis: 'y', w0: 1000, h0: 700, scale: 1 }, 500, 10, [], 24).width, 1000);
  assert.deepEqual(dragSize({ axis: 'xy', w0: 1000, h0: 700, scale: 1 }, 10, 10, [], 24), { width: 1020, height: 720, deviceName: null });
});
test('clampSize brings an out-of-range saved size inside the bounds', () => {
  assert.deepEqual(clampSize(200, 9999), { width: FRAME_MIN, height: FRAME_MAX_H });
  assert.deepEqual(clampSize(393, 852), { width: 393, height: 852 });
});
