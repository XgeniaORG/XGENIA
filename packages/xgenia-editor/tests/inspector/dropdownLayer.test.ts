import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computePlacement } from '../../src/editor/src/views/panels/propertyeditor/dropdownLayer';

/** A 35px-tall field 200px wide, the shape every property row uses. */
function field(top: number, left = 130) {
  return { left, top, width: 200, height: 35 };
}

const VIEWPORT = { width: 1440, height: 900 };

test('opens under the field when there is room', () => {
  const p = computePlacement(field(200), VIEWPORT, { contentHeight: 150 });

  assert.equal(p.direction, 'down');
  assert.equal(p.top, 235);
  assert.equal(p.left, 130);
  assert.equal(p.width, 200);
  assert.equal(p.maxHeight, 150);
});

test('flips above the field when the list would run off the bottom', () => {
  // 820 + 35 leaves 45px below: this is the row in the bug report, the one whose
  // list was cut off at the group edge and painted over the row underneath.
  const p = computePlacement(field(820), VIEWPORT, { contentHeight: 150 });

  assert.equal(p.direction, 'up');
  assert.equal(p.top, 670);
  assert.equal(p.top + p.maxHeight, 820, 'sits flush on top of the field');
  assert.equal(p.maxHeight, 150);
});

test('stays below when neither side fits but below is roomier', () => {
  const p = computePlacement(field(120), { width: 1440, height: 400 }, { contentHeight: 600 });

  assert.equal(p.direction, 'down');
  assert.equal(p.top, 155);
  assert.equal(p.maxHeight, 237, 'scrolls in what is left, clear of the edge');
});

test('a long list scrolls instead of running the height of the screen', () => {
  const p = computePlacement(field(100), VIEWPORT, { contentHeight: 2000 });

  assert.equal(p.direction, 'down');
  assert.equal(p.maxHeight, 320);
});

test('never shrinks below the minimum: overlaps the field rather than showing a sliver', () => {
  // 20px above, 25px below - both useless. It opens at minHeight and is pushed
  // back inside the viewport, over the field, where the options can still be clicked.
  const p = computePlacement(field(20), { width: 1440, height: 80 }, { contentHeight: 150 });

  assert.equal(p.maxHeight, 64);
  assert.ok(p.top >= 8, 'inside the top edge');
  assert.ok(p.top + p.maxHeight <= 72, 'inside the bottom edge');
});

test('an unmeasurable list opens at full allowance rather than collapsing to nothing', () => {
  // scrollHeight can come back 0 when there is nothing laid out to measure. Capping
  // to that would set max-height:0 and the list would open invisible.
  const p = computePlacement(field(200), VIEWPORT, { contentHeight: 0 });

  assert.equal(p.maxHeight, 320);
  assert.equal(p.direction, 'down');
});

test('keeps the list inside the left and right edges', () => {
  const narrow = { width: 300, height: 900 };

  assert.equal(computePlacement(field(100, 260), narrow, { contentHeight: 100 }).left, 92);
  assert.equal(computePlacement(field(100, -40), narrow, { contentHeight: 100 }).left, 8);
});

test('matches the field width, so the list lines up with the value column', () => {
  const p = computePlacement({ left: 300, top: 100, width: 33, height: 35 }, VIEWPORT, { contentHeight: 60 });

  assert.equal(p.width, 33);
  assert.equal(p.left, 300);
});
