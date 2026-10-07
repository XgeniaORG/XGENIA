import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrollTopToReveal, visibleWindow } from '../../src/editor/src/views/panels/HierarchyPanel/virtualRows';

test('window covers the viewport plus overscan, clamped to the list', () => {
  // 24px rows, 240px viewport -> rows 0..10 visible; overscan 2
  assert.deepEqual(visibleWindow(0, 240, 24, 1000, 2), { start: 0, end: 13 });
  // scrolled to row 100
  assert.deepEqual(visibleWindow(2400, 240, 24, 1000, 2), { start: 98, end: 113 });
  // near the end
  assert.deepEqual(visibleWindow(2400, 240, 24, 105, 2), { start: 98, end: 105 });
});

test('window for empty lists and a hidden (0px) viewport', () => {
  assert.deepEqual(visibleWindow(0, 240, 24, 0), { start: 0, end: 0 });
  assert.deepEqual(visibleWindow(0, 0, 24, 50, 3), { start: 0, end: 4 });
});

test('reveal scrolls the least distance and leaves visible rows alone', () => {
  // viewport shows rows 10..19 (scrollTop 240, height 240)
  assert.equal(scrollTopToReveal(12, 24, 240, 240), null);
  assert.equal(scrollTopToReveal(5, 24, 240, 240), 120);
  assert.equal(scrollTopToReveal(25, 24, 240, 240), 25 * 24 + 24 - 240);
  assert.equal(scrollTopToReveal(5, 24, 240, 240, 24), 96);
});

test('reveal does nothing without a viewport or a row', () => {
  assert.equal(scrollTopToReveal(-1, 24, 0, 240), null);
  assert.equal(scrollTopToReveal(3, 24, 0, 0), null);
});
