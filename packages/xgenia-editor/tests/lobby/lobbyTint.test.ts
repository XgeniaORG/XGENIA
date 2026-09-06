import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  conditionTint,
  tintColor,
  backdropFor,
  dominantPair,
  DEFAULT_TINT,
  TINT_MAX_ALPHA
} from '../../src/editor/src/models/lobby/lobbyTint';

/** Build a pixel buffer of solid colours, the shape getImageData returns. */
function pixels(colors: Array<[number, number, number]>, each = 100): Uint8ClampedArray {
  const out = new Uint8ClampedArray(colors.length * each * 4);
  let i = 0;
  for (const [r, g, b] of colors) {
    for (let n = 0; n < each; n++) {
      out[i++] = r;
      out[i++] = g;
      out[i++] = b;
      out[i++] = 255;
    }
  }
  return out;
}

test('alpha can never exceed the clamp, however it is asked for', () => {
  assert.ok(tintColor({ r: 255, g: 0, b: 0 }, 1).endsWith(`${TINT_MAX_ALPHA})`));
  assert.ok(tintColor({ r: 255, g: 0, b: 0 }, -5).endsWith('0)'));
});

test('channels are clamped and rounded into a legal rgba string', () => {
  assert.equal(tintColor({ r: 300, g: -20, b: 127.6 }, 0.1), 'rgba(255, 0, 128, 0.1)');
});

test('a grey sample is pushed to a real colour rather than to dirt', () => {
  const out = conditionTint({ r: 128, g: 128, b: 128 });
  const spread = Math.max(out.r, out.g, out.b) - Math.min(out.r, out.g, out.b);
  assert.ok(spread > 40, `expected saturation, got ${JSON.stringify(out)}`);
});

test('a blown-out neon sample is brought down, not left as a lamp', () => {
  const out = conditionTint({ r: 255, g: 255, b: 240 });
  const lightness = (Math.max(out.r, out.g, out.b) + Math.min(out.r, out.g, out.b)) / 2 / 255;
  assert.ok(lightness <= 0.61, `expected a ceiling, got ${lightness}`);
});

test('a near-black sample is lifted so the ground is visible', () => {
  const out = conditionTint({ r: 4, g: 2, b: 9 });
  const lightness = (Math.max(out.r, out.g, out.b) + Math.min(out.r, out.g, out.b)) / 2 / 255;
  assert.ok(lightness >= 0.31, `expected a floor, got ${lightness}`);
});

test('conditioning keeps the hue it was given', () => {
  // A violet stays violet: blue is the dominant channel before and after.
  const out = conditionTint({ r: 120, g: 80, b: 200 });
  assert.ok(out.b > out.r && out.r > out.g, JSON.stringify(out));
});

test('the backdrop has the same three-gradient shape as the editor token', () => {
  const css = backdropFor();
  assert.equal(css.match(/radial-gradient/g)?.length, 3);
  assert.ok(!css.includes('NaN'));
});

test('dominant pair ignores greys and near-blacks', () => {
  // Mostly dark background with a small area of vivid magenta: the magenta must win.
  const data = pixels([[8, 8, 10], [200, 30, 180]], 40);
  const [first] = dominantPair(data);
  assert.ok(first.r > 120 && first.b > 100 && first.g < 90, JSON.stringify(first));
});

test('an image with no usable hue falls back to the default pair', () => {
  assert.deepEqual(dominantPair(pixels([[0, 0, 0], [10, 10, 10]])), DEFAULT_TINT);
  assert.deepEqual(dominantPair(new Uint8ClampedArray(0)), DEFAULT_TINT);
});

test('the second colour is a different hue, not the first one again', () => {
  const data = pixels([[220, 40, 40], [40, 80, 220]], 60);
  const [a, b] = dominantPair(data);

  const hueish = (c: { r: number; g: number; b: number }) => (c.r > c.b ? 'warm' : 'cool');
  assert.notEqual(hueish(a), hueish(b));
});

test('a single-hue image still yields a usable pair', () => {
  const [a, b] = dominantPair(pixels([[200, 30, 180]]));
  assert.ok(a.r > 0);
  assert.deepEqual(b, DEFAULT_TINT[1], 'no second hue available, so the default green is used');
});
