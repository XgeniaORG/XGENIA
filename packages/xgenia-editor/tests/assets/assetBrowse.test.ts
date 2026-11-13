import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterAssets, sortAssets, EMPTY_QUERY, parseSearch } from '../../src/editor/src/views/panels/AssetPanel/assetFilter';
import { selectionClick, selectAll, pruneSelection, EMPTY_SELECTION } from '../../src/editor/src/views/panels/AssetPanel/assetSelection';
import { buildFolderTree } from '../../src/editor/src/views/panels/AssetPanel/assetFolders';

const asset = (over: Partial<any> = {}): any => ({
  path: 'assets/symbols/cherry.png',
  name: 'cherry.png',
  extension: 'png',
  kind: 'image',
  role: 'sprite',
  roleInferred: false,
  tags: [],
  favorite: false,
  versions: [],
  used: true,
  placement: null,
  previousPlacement: null,
  pieces: [],
  ...over
});
const q = (over: Partial<any> = {}) => ({ ...EMPTY_QUERY, ...over });
const names = (list: any[]) => list.map((a) => a.name);

// ─── search syntax ───────────────────────────────────────────────────────────

test('parseSearch splits filters from free words and keeps quoted phrases whole', () => {
  const p = parseSearch('t:image role:ui "spin button" -tag:old gold');
  assert.deepEqual(p.words, ['spin button', 'gold']);
  assert.deepEqual(
    p.filters.map((f) => [f.key, f.value, f.negate]),
    [
      ['t', 'image', false],
      ['role', 'ui', false],
      ['tag', 'old', true]
    ]
  );
});

test('an unknown key is searched as a plain word, not silently dropped', () => {
  assert.deepEqual(parseSearch('foo:bar').words, ['foo:bar']);
});

test('t: filters by kind, r:/role: by role slug or label', () => {
  const list = [asset(), asset({ name: 'hit.wav', path: 'assets/sfx/hit.wav', kind: 'audio', role: 'sfx' })];
  assert.deepEqual(names(filterAssets(list, q({ text: 't:audio' }))), ['hit.wav']);
  assert.deepEqual(names(filterAssets(list, q({ text: 'role:sprite' }))), ['cherry.png']);
  assert.deepEqual(names(filterAssets(list, q({ text: 'r:sprites' }))), ['cherry.png'], 'label works too');
});

test('l:/tag: matches a tag exactly, and negation excludes', () => {
  const list = [asset({ tags: ['hero'] }), asset({ name: 'b.png', path: 'assets/b.png', tags: ['hero-old'] })];
  assert.deepEqual(names(filterAssets(list, q({ text: 'l:hero' }))), ['cherry.png']);
  assert.deepEqual(names(filterAssets(list, q({ text: '-tag:hero' }))), ['b.png']);
});

test('is: flags', () => {
  const placed = { source: 'split', rect: { x: 0, y: 0, width: 0.1, height: 0.1 } };
  const list = [
    asset({ name: 'a.png', used: false }),
    asset({ name: 'b.png', favorite: true, lineage: { sourcePath: 'k' }, placement: placed }),
    asset({ name: 'c.png', roleInferred: true, versions: [{ n: 1 }] }),
    asset({ name: 'd.png', previousPlacement: { versionPath: 'x', layout: {} } })
  ];
  assert.deepEqual(names(filterAssets(list, q({ text: 'is:unused' }))), ['a.png']);
  assert.deepEqual(names(filterAssets(list, q({ text: 'is:starred' }))), ['b.png']);
  assert.deepEqual(names(filterAssets(list, q({ text: 'is:cut' }))), ['b.png']);
  assert.deepEqual(names(filterAssets(list, q({ text: 'is:placed' }))), ['b.png']);
  assert.deepEqual(names(filterAssets(list, q({ text: 'is:guessed' }))), ['c.png']);
  assert.deepEqual(names(filterAssets(list, q({ text: 'is:versioned' }))), ['c.png']);
  assert.deepEqual(names(filterAssets(list, q({ text: 'is:lost-placement' }))), ['d.png']);
});

test('ext: and in: (folder prefix) and from: (the art it was cut from)', () => {
  const list = [
    asset({ name: 'a.png', path: 'assets/ui/a.png', lineage: { rootPath: 'assets/keyart/key-art.png', sourcePath: 'assets/keyart/key-art.png' } }),
    asset({ name: 'b.jpg', path: 'assets/uix/b.jpg', extension: 'jpg' })
  ];
  assert.deepEqual(names(filterAssets(list, q({ text: 'ext:jpg' }))), ['b.jpg']);
  assert.deepEqual(names(filterAssets(list, q({ text: 'in:assets/ui' }))), ['a.png'], 'prefix is a folder, not a string prefix');
  assert.deepEqual(names(filterAssets(list, q({ text: 'from:key-art' }))), ['a.png']);
});

test('the folder scope limits to that folder and below', () => {
  const list = [asset({ path: 'assets/ui/a.png', name: 'a.png' }), asset({ path: 'assets/ui/btn/b.png', name: 'b.png' }), asset()];
  assert.deepEqual(names(filterAssets(list, q({ folder: 'assets/ui' }))), ['a.png', 'b.png']);
});

// ─── sort ────────────────────────────────────────────────────────────────────

test('sort modes: modified and size newest/largest first, unknowns last; role groups', () => {
  const list = [
    asset({ name: 'a.png', path: 'assets/a.png', mtime: 1, size: 30, role: 'ui' }),
    asset({ name: 'b.png', path: 'assets/b.png', mtime: 3, size: 10, role: 'background' }),
    asset({ name: 'c.png', path: 'assets/c.png', role: 'background' })
  ];
  assert.deepEqual(names(sortAssets(list, 'modified')), ['b.png', 'a.png', 'c.png']);
  assert.deepEqual(names(sortAssets(list, 'size')), ['a.png', 'b.png', 'c.png']);
  assert.deepEqual(names(sortAssets(list, 'role')), ['b.png', 'c.png', 'a.png']);
  assert.deepEqual(names(sortAssets(list)), ['a.png', 'b.png', 'c.png']);
});

// ─── selection ───────────────────────────────────────────────────────────────

const order = ['a', 'b', 'c', 'd', 'e'];

test('plain click selects one and sets the anchor', () => {
  const s = selectionClick(EMPTY_SELECTION, 'c', {}, order);
  assert.deepEqual([...s.paths], ['c']);
  assert.equal(s.anchor, 'c');
  assert.equal(s.focus, 'c');
});

test('cmd/ctrl-click toggles without losing the rest', () => {
  let s = selectionClick(EMPTY_SELECTION, 'a', {}, order);
  s = selectionClick(s, 'c', { toggle: true }, order);
  assert.deepEqual([...s.paths].sort(), ['a', 'c']);
  s = selectionClick(s, 'a', { toggle: true }, order);
  assert.deepEqual([...s.paths], ['c']);
});

test('shift-click selects the range from the anchor, in either direction', () => {
  let s = selectionClick(EMPTY_SELECTION, 'd', {}, order);
  s = selectionClick(s, 'b', { range: true }, order);
  assert.deepEqual([...s.paths].sort(), ['b', 'c', 'd']);
  assert.equal(s.anchor, 'd', 'the anchor stays put so the range can be re-dragged');
});

test('selectAll and prune', () => {
  const all = selectAll(order);
  assert.equal(all.paths.size, 5);
  const pruned = pruneSelection(all, new Set(['a', 'e', 'zz']));
  assert.deepEqual([...pruned.paths].sort(), ['a', 'e']);
  assert.equal(pruneSelection(selectionClick(EMPTY_SELECTION, 'b', {}, order), new Set(['a'])).anchor, null);
});

// ─── folders ─────────────────────────────────────────────────────────────────

test('folder tree counts files recursively and sorts children by name', () => {
  const tree = buildFolderTree(['assets/ui/b.png', 'assets/ui/btn/c.png', 'assets/a.png', 'assets/keyart/k.png']);
  assert.equal(tree.path, 'assets');
  assert.equal(tree.count, 4);
  assert.deepEqual(tree.children.map((c) => [c.name, c.count]), [
    ['keyart', 1],
    ['ui', 2]
  ]);
  assert.deepEqual(tree.children[1].children.map((c) => c.path), ['assets/ui/btn']);
});
