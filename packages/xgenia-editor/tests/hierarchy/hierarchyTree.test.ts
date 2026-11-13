import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ancestorIds,
  defaultExpanded,
  flattenHierarchy,
  HierarchyItem,
  indexTree,
  isInSubtree,
  soloToggle
} from '../../src/editor/src/views/panels/HierarchyPanel/hierarchyTree';

function n(id: string, children: HierarchyItem[] = [], extra: Partial<HierarchyItem> = {}): HierarchyItem {
  return { id, label: id, typeName: 'Group', isVisual: true, children, ...extra };
}

// page
//   header
//     logo (Image)
//     title (Text)
//   reels
//     reel1
//     reel2
// spinLogic (Expression, not visual)
function scene(): HierarchyItem[] {
  return [
    n('page', [
      n('header', [n('logo', [], { typeName: 'Image' }), n('title', [], { typeName: 'Text', label: 'Big Title' })]),
      n('reels', [n('reel1'), n('reel2')])
    ]),
    n('spinLogic', [], { typeName: 'Expression', isVisual: false })
  ];
}

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

test('collapsed tree shows only the roots', () => {
  const rows = flattenHierarchy(scene(), { expanded: new Set() });
  assert.deepEqual(ids(rows), ['page', 'spinLogic']);
  assert.equal(rows[0].hasChildren, true);
  assert.equal(rows[0].isExpanded, false);
  assert.equal(rows[1].hasChildren, false);
});

test('expansion opens one level per expanded id, with depth and parent', () => {
  const rows = flattenHierarchy(scene(), { expanded: new Set(['page', 'reels']) });
  assert.deepEqual(ids(rows), ['page', 'header', 'reels', 'reel1', 'reel2', 'spinLogic']);
  const reel1 = rows.find((r) => r.id === 'reel1')!;
  assert.equal(reel1.depth, 2);
  assert.equal(reel1.parentId, 'reels');
  // header is collapsed: it has children but they are not emitted
  const header = rows.find((r) => r.id === 'header')!;
  assert.equal(header.hasChildren, true);
  assert.equal(header.isExpanded, false);
});

test('an expanded id under a collapsed parent stays hidden', () => {
  const rows = flattenHierarchy(scene(), { expanded: new Set(['header']) });
  assert.deepEqual(ids(rows), ['page', 'spinLogic']);
});

test('search shows matches with their ancestors, expanded, ignoring stored expansion', () => {
  const rows = flattenHierarchy(scene(), { expanded: new Set(), query: 'big' });
  assert.deepEqual(ids(rows), ['page', 'header', 'title']);
  assert.deepEqual(
    rows.map((r) => r.isMatch),
    [false, false, true]
  );
  assert.ok(rows[0].isExpanded && rows[1].isExpanded);
});

test('search matches the type name too, case-insensitively', () => {
  const rows = flattenHierarchy(scene(), { expanded: new Set(), query: '  IMAGE ' });
  assert.deepEqual(ids(rows), ['page', 'header', 'logo']);
});

test('a matching parent does not drag in its non-matching children', () => {
  const rows = flattenHierarchy(scene(), { expanded: new Set(['reels', 'page']), query: 'reels' });
  assert.deepEqual(ids(rows), ['page', 'reels']);
  assert.equal(rows[1].hasChildren, false);
});

test('search with no match gives no rows', () => {
  assert.deepEqual(flattenHierarchy(scene(), { expanded: new Set(), query: 'zzz' }), []);
});

test('visual-only drops non-visual nodes that have no visual descendants', () => {
  const rows = flattenHierarchy(scene(), { expanded: new Set(['page']), visualOnly: true });
  assert.deepEqual(ids(rows), ['page', 'header', 'reels']);
});

test('hidden marks the row and dims its whole subtree', () => {
  const rows = flattenHierarchy(scene(), {
    expanded: new Set(['page', 'header', 'reels']),
    hidden: new Set(['header']),
    locked: new Set(['reel2'])
  });
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(by.header.isHidden, true);
  assert.equal(by.header.isHiddenByAncestor, false);
  assert.equal(by.logo.isHidden, false);
  assert.equal(by.logo.isHiddenByAncestor, true);
  assert.equal(by.title.isHiddenByAncestor, true);
  assert.equal(by.reels.isHiddenByAncestor, false);
  assert.equal(by.reel2.isLocked, true);
  assert.equal(by.reel1.isLocked, false);
});

test('indexTree, ancestorIds and isInSubtree', () => {
  const index = indexTree(scene());
  assert.deepEqual(index.get('title'), { item: index.get('title')!.item, parentId: 'header', index: 1 });
  assert.equal(index.get('spinLogic')!.index, 1);
  assert.deepEqual(ancestorIds(index, 'title'), ['header', 'page']);
  assert.deepEqual(ancestorIds(index, 'page'), []);
  assert.deepEqual(ancestorIds(index, 'nope'), []);
  assert.equal(isInSubtree(index, 'reel1', 'page'), true);
  assert.equal(isInSubtree(index, 'reel1', 'reels'), true);
  assert.equal(isInSubtree(index, 'reel1', 'reel1'), true);
  assert.equal(isInSubtree(index, 'reel1', 'header'), false);
});

test('defaultExpanded opens the roots that have children', () => {
  assert.deepEqual([...defaultExpanded(scene())], ['page']);
});

test('solo hides the visual siblings along the path and shows the path', () => {
  const roots = [...scene(), n('overlay', [n('popup')])];
  const result = soloToggle(roots, 'reel1', new Set(['reels']));
  // reel2 (sibling), header (sibling of reels), overlay (visual root). spinLogic is not visual.
  assert.deepEqual(result.hide.sort(), ['header', 'overlay', 'reel2']);
  assert.deepEqual(result.show, ['reels']);
});

test('solo again on a soloed node shows the siblings back', () => {
  const roots = [...scene(), n('overlay')];
  const result = soloToggle(roots, 'reel1', new Set(['reel2', 'header', 'overlay']));
  assert.deepEqual(result.hide, []);
  assert.deepEqual(result.show.sort(), ['header', 'overlay', 'reel2']);
});

test('solo on an unknown id does nothing', () => {
  assert.deepEqual(soloToggle(scene(), 'ghost', new Set()), { hide: [], show: [] });
});
