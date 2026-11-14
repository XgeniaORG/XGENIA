import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rangeSelection,
  sameSelection,
  selectionForClick,
  toggleSelection
} from '../../src/editor/src/views/panels/HierarchyPanel/hierarchySelection';

const rows = ['a', 'b', 'c', 'd', 'e'];

test('range runs from the anchor to the target in display order, either direction', () => {
  assert.deepEqual(rangeSelection(rows, 'b', 'd'), ['b', 'c', 'd']);
  assert.deepEqual(rangeSelection(rows, 'd', 'b'), ['b', 'c', 'd']);
  assert.deepEqual(rangeSelection(rows, 'c', 'c'), ['c']);
});

test('range without a visible anchor is just the target', () => {
  assert.deepEqual(rangeSelection(rows, null, 'c'), ['c']);
  assert.deepEqual(rangeSelection(rows, 'collapsed-away', 'c'), ['c']);
  assert.deepEqual(rangeSelection(rows, 'a', 'not-visible'), []);
});

test('toggle adds and removes', () => {
  assert.deepEqual(toggleSelection(['a'], 'c'), ['a', 'c']);
  assert.deepEqual(toggleSelection(['a', 'c'], 'a'), ['c']);
});

test('plain click selects one row and moves the anchor', () => {
  assert.deepEqual(selectionForClick(rows, ['a', 'b'], 'a', 'd', {}), { ids: ['d'], anchor: 'd' });
});

test('shift-click selects the range and keeps the anchor', () => {
  const first = selectionForClick(rows, ['b'], 'b', 'e', { range: true });
  assert.deepEqual(first, { ids: ['b', 'c', 'd', 'e'], anchor: 'b' });
  const second = selectionForClick(rows, first.ids, first.anchor, 'a', { range: true });
  assert.deepEqual(second, { ids: ['a', 'b'], anchor: 'b' });
});

test('cmd-click toggles; removing a row leaves the anchor where it was', () => {
  assert.deepEqual(selectionForClick(rows, ['a'], 'a', 'c', { toggle: true }), { ids: ['a', 'c'], anchor: 'c' });
  assert.deepEqual(selectionForClick(rows, ['a', 'c'], 'c', 'a', { toggle: true }), { ids: ['c'], anchor: 'c' });
});

test('sameSelection ignores order', () => {
  assert.equal(sameSelection(['a', 'b'], ['b', 'a']), true);
  assert.equal(sameSelection(['a'], ['a', 'b']), false);
  assert.equal(sameSelection([], []), true);
});
