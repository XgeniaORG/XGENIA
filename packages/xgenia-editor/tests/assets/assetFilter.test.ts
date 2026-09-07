import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterAssets, sortAssets, EMPTY_QUERY } from '../../src/editor/src/views/panels/AssetPanel/assetFilter';

const asset = (over: Partial<any> = {}): any => ({
  path: 'assets/symbols/cherry.png',
  name: 'cherry.png',
  extension: 'png',
  kind: 'image',
  role: 'sprite',
  roleInferred: true,
  tags: [],
  favorite: false,
  versions: [],
  used: true,
  ...over
});

const q = (over: Partial<any> = {}) => ({ ...EMPTY_QUERY, ...over });

test('empty query returns everything', () => {
  const list = [asset(), asset({ path: 'assets/ui/bar.png', name: 'bar.png', role: 'ui' })];
  assert.equal(filterAssets(list, q()).length, 2);
});

test('role filter is exact', () => {
  const list = [asset(), asset({ path: 'assets/ui/bar.png', name: 'bar.png', role: 'ui' })];
  assert.deepEqual(filterAssets(list, q({ role: 'ui' })).map((a) => a.name), ['bar.png']);
});

test('text matches the name', () => {
  assert.equal(filterAssets([asset()], q({ text: 'cher' })).length, 1);
  assert.equal(filterAssets([asset()], q({ text: 'zzz' })).length, 0);
});

test('text matches the AI prompt, which is the whole point of storing it', () => {
  const a = asset({ name: 'a1b2.png', ai: { prompt: 'art-deco fedora, brushed brass' } });
  assert.equal(filterAssets([a], q({ text: 'fedora' })).length, 1);
});

test('text matches a tag and the role label', () => {
  assert.equal(filterAssets([asset({ tags: ['hero'] })], q({ text: 'hero' })).length, 1);
  assert.equal(filterAssets([asset()], q({ text: 'sprite' })).length, 1);
});

test('text search is case-insensitive and ignores surrounding space', () => {
  assert.equal(filterAssets([asset()], q({ text: '  CHERRY ' })).length, 1);
});

test('unusedOnly keeps only unreferenced assets', () => {
  const list = [asset(), asset({ path: 'assets/x.png', name: 'x.png', used: false })];
  assert.deepEqual(filterAssets(list, q({ unusedOnly: true })).map((a) => a.name), ['x.png']);
});

test('favoritesOnly and a role filter combine', () => {
  const list = [
    asset({ favorite: true }),
    asset({ path: 'assets/ui/bar.png', name: 'bar.png', role: 'ui', favorite: true }),
    asset({ path: 'assets/ui/baz.png', name: 'baz.png', role: 'ui' })
  ];
  assert.deepEqual(filterAssets(list, q({ role: 'ui', favoritesOnly: true })).map((a) => a.name), ['bar.png']);
});

test('sort is by name then path, and does not mutate the input', () => {
  const list = [asset({ name: 'b.png', path: 'assets/b.png' }), asset({ name: 'a.png', path: 'assets/a.png' })];
  assert.deepEqual(sortAssets(list).map((a) => a.name), ['a.png', 'b.png']);
  assert.equal(list[0].name, 'b.png');
});
