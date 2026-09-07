import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isWeakCapture,
  monogramFor,
  monogramHue,
  WEAK_VARIANCE_MAX,
  WEAK_LUMINANCE_LIGHT,
  WEAK_LUMINANCE_DARK
} from '../../src/editor/src/utils/thumbnails/thumbnail-weak';

test('a capture that was never measured is not weak', () => {
  // The distinction that matters: "no measurement" must not render as "empty art".
  assert.equal(isWeakCapture(null), false);
  assert.equal(isWeakCapture(undefined), false);
});

test('flat, near-white and near-black captures are weak', () => {
  assert.ok(isWeakCapture({ luminance: 0.5, variance: WEAK_VARIANCE_MAX }));
  assert.ok(isWeakCapture({ luminance: WEAK_LUMINANCE_LIGHT, variance: 0.3 }));
  assert.ok(isWeakCapture({ luminance: WEAK_LUMINANCE_DARK, variance: 0.3 }));
});

test('real key art is not weak', () => {
  // Measured range on the development profile: variance 0.17-0.31 at mid luminance.
  assert.ok(!isWeakCapture({ luminance: 0.34, variance: 0.22 }));
  // A dark cabinet on black is still busy, so luminance alone must not condemn it.
  assert.ok(!isWeakCapture({ luminance: 0.12, variance: 0.19 }));
});

test('a busy form screenshot survives despite being bright', () => {
  assert.ok(!isWeakCapture({ luminance: 0.88, variance: 0.16 }));
});

test('monogram prefers initials, falls back to two letters of one word', () => {
  assert.equal(monogramFor('Neon Reels'), 'NR');
  assert.equal(monogramFor('sdsds'), 'Sd');
  assert.equal(monogramFor('amazingSlot.'), 'Am');
  assert.equal(monogramFor('Amazing Slot System'), 'AS');
  assert.equal(monogramFor('X'), 'X');
});

test('monogram handles punctuation, digits and nothing at all', () => {
  assert.equal(monogramFor('777 Test'), '7T');
  assert.equal(monogramFor('  '), '?');
  assert.equal(monogramFor(''), '?');
  assert.equal(monogramFor('---'), '?');
});

test('monogram hue is stable and inside the teal-violet arc', () => {
  const a = monogramHue('Amazing');
  assert.equal(a, monogramHue('Amazing'));
  assert.notEqual(a, monogramHue('sdsds'));

  for (const name of ['Amazing', 'sdsds', 'mmmmmmmm', '', 'Neon Reels V2']) {
    const h = monogramHue(name);
    assert.ok(h >= 160 && h <= 280, `${name} produced ${h}`);
  }
});
