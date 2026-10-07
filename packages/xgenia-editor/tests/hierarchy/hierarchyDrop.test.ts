import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropPositionForOffset, resolveDrop } from '../../src/editor/src/views/panels/HierarchyPanel/hierarchyDrop';
import type { HierarchyItem } from '../../src/editor/src/views/panels/HierarchyPanel/hierarchyTree';

function n(id: string, children: HierarchyItem[] = [], extra: Partial<HierarchyItem> = {}): HierarchyItem {
  return { id, label: id, typeName: 'Group', isVisual: true, children, ...extra };
}

// page
//   a
//   b
//     b1
//   c
// loose (root)
// text (root, cannot take children)
const tree = () => [n('page', [n('a'), n('b', [n('b1')]), n('c')]), n('loose'), n('text', [], { typeName: 'Text' })];
const acceptAll = (parentId: string) => parentId !== 'text';

test('drop position: quarters for a row that can be a parent, halves otherwise', () => {
  assert.equal(dropPositionForOffset(2, 24, true), 'before');
  assert.equal(dropPositionForOffset(12, 24, true), 'inside');
  assert.equal(dropPositionForOffset(22, 24, true), 'after');
  assert.equal(dropPositionForOffset(11, 24, false), 'before');
  assert.equal(dropPositionForOffset(13, 24, false), 'after');
});

test('reorder down within a parent accounts for the node leaving its slot', () => {
  // a after c: a leaves index 0, c is then at 1, so a lands at 2 (the end)
  assert.deepEqual(resolveDrop(tree(), 'a', 'c', 'after', acceptAll), {
    ok: true,
    kind: 'reorder',
    parentId: 'page',
    index: 2
  });
  // a before c -> between b and c -> index 1 after removal
  assert.deepEqual(resolveDrop(tree(), 'a', 'c', 'before', acceptAll), {
    ok: true,
    kind: 'reorder',
    parentId: 'page',
    index: 1
  });
});

test('reorder up within a parent', () => {
  assert.deepEqual(resolveDrop(tree(), 'c', 'a', 'before', acceptAll), {
    ok: true,
    kind: 'reorder',
    parentId: 'page',
    index: 0
  });
});

test('dropping where it already is is a no-op', () => {
  assert.deepEqual(resolveDrop(tree(), 'b', 'a', 'after', acceptAll), { ok: false, reason: 'no-op' });
  assert.deepEqual(resolveDrop(tree(), 'b', 'c', 'before', acceptAll), { ok: false, reason: 'no-op' });
  // onto its own parent when it is already the last child
  assert.deepEqual(resolveDrop(tree(), 'c', 'page', 'inside', acceptAll), { ok: false, reason: 'no-op' });
});

test('onto a row makes it the last child', () => {
  assert.deepEqual(resolveDrop(tree(), 'a', 'b', 'inside', acceptAll), {
    ok: true,
    kind: 'reparent',
    parentId: 'b',
    index: 1
  });
  // onto its own parent: moves to the end (a reorder)
  assert.deepEqual(resolveDrop(tree(), 'a', 'page', 'inside', acceptAll), {
    ok: true,
    kind: 'reorder',
    parentId: 'page',
    index: 2
  });
});

test('a root moves into a parent at the drop index', () => {
  assert.deepEqual(resolveDrop(tree(), 'loose', 'b1', 'before', acceptAll), {
    ok: true,
    kind: 'reparent',
    parentId: 'b',
    index: 0
  });
  assert.deepEqual(resolveDrop(tree(), 'loose', 'a', 'after', acceptAll), {
    ok: true,
    kind: 'reparent',
    parentId: 'page',
    index: 1
  });
});

test('refuses dropping on itself or inside its own subtree', () => {
  assert.deepEqual(resolveDrop(tree(), 'b', 'b', 'inside', acceptAll), { ok: false, reason: 'self' });
  assert.deepEqual(resolveDrop(tree(), 'b', 'b1', 'inside', acceptAll), { ok: false, reason: 'descendant' });
  assert.deepEqual(resolveDrop(tree(), 'page', 'b1', 'after', acceptAll), { ok: false, reason: 'descendant' });
});

test('refuses a parent that cannot accept the child', () => {
  assert.deepEqual(resolveDrop(tree(), 'a', 'text', 'inside', acceptAll), { ok: false, reason: 'not-accepted' });
  const onlyPage = (parentId: string) => parentId === 'page';
  assert.deepEqual(resolveDrop(tree(), 'a', 'b1', 'before', onlyPage), { ok: false, reason: 'not-accepted' });
});

test('a child dropped at the root level is detached; roots cannot be reordered', () => {
  assert.deepEqual(resolveDrop(tree(), 'b1', 'loose', 'after', acceptAll), {
    ok: true,
    kind: 'reparent',
    parentId: null,
    index: -1
  });
  assert.deepEqual(resolveDrop(tree(), 'loose', 'page', 'before', acceptAll), { ok: false, reason: 'root-order' });
});

test('unknown ids are refused', () => {
  assert.deepEqual(resolveDrop(tree(), 'ghost', 'a', 'after', acceptAll), { ok: false, reason: 'unknown' });
  assert.deepEqual(resolveDrop(tree(), 'a', 'ghost', 'after', acceptAll), { ok: false, reason: 'unknown' });
});
