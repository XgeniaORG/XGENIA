import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, rolesInIndex, roleCounts } from '../../src/editor/src/views/panels/AssetPanel/assetIndex';

const base = () => ({
  filePaths: ['assets/keyart/hero.png', 'assets/symbols/cherry.png'],
  trashNames: [] as string[],
  meta: {} as Record<string, any>,
  referencedPaths: new Set<string>(),
  referencedUids: new Set<string>()
});

test('every live file gets an entry', () => {
  const idx = buildIndex(base());
  assert.equal(idx.assets.length, 2);
  assert.ok(idx.byPath.get('assets/keyart/hero.png'));
});

test('role is inferred when unset and marked as a guess', () => {
  const hero = buildIndex(base()).byPath.get('assets/keyart/hero.png')!;
  assert.equal(hero.role, 'keyart');
  assert.equal(hero.roleInferred, true);
});

test('an authored role is used as-is and never marked inferred', () => {
  const idx = buildIndex({
    ...base(),
    meta: { 'assets/symbols/cherry.png': { role: 'ui', roleInferred: false } }
  });
  const cherry = idx.byPath.get('assets/symbols/cherry.png')!;
  assert.equal(cherry.role, 'ui');
  assert.equal(cherry.roleInferred, false);
});

test('an authored role is never queued for a scanner overwrite', () => {
  const idx = buildIndex({
    ...base(),
    meta: { 'assets/symbols/cherry.png': { role: 'ui', roleInferred: false, uid: 'a' } }
  });
  assert.ok(!idx.pendingWrites.has('assets/symbols/cherry.png'));
});

test('a stored role still flagged inferred is re-inferred, so better signals win', () => {
  const idx = buildIndex({
    ...base(),
    meta: { 'assets/symbols/cherry.png': { role: 'other', roleInferred: true } }
  });
  assert.equal(idx.byPath.get('assets/symbols/cherry.png')!.role, 'sprite');
});

test('lineage promotes ai.layout when no top-level lineage is stored', () => {
  const layout = {
    sourcePath: 'assets/keyart/hero.png',
    rootPath: 'assets/keyart/hero.png',
    box: { x: 0, y: 0, width: 10, height: 10 },
    boxInRoot: { x: 0, y: 0, width: 10, height: 10 },
    canvasInRoot: { x: 0, y: 0, width: 1000, height: 1000 },
    depth: 1
  };
  const idx = buildIndex({
    ...base(),
    meta: { 'assets/symbols/cherry.png': { ai: { layout } } }
  });
  assert.deepEqual(idx.byPath.get('assets/symbols/cherry.png')!.lineage, layout);
});

test('trash backups become versions of the live asset', () => {
  const idx = buildIndex({
    ...base(),
    trashNames: ['assets_symbols_cherry.2026-09-06T10-00-00-000Z.png']
  });
  const cherry = idx.byPath.get('assets/symbols/cherry.png')!;
  assert.equal(cherry.versions.length, 1);
  assert.equal(cherry.versions[0].n, 1);
  assert.equal(cherry.versions[0].source, 'trash');
  assert.equal(cherry.versions[0].path, '.trash/assets_symbols_cherry.2026-09-06T10-00-00-000Z.png');
});

test('sibling .vN files become versions and do not appear as their own assets', () => {
  const b = base();
  const idx = buildIndex({
    ...b,
    filePaths: [...b.filePaths, 'assets/symbols/cherry.v1.png', 'assets/symbols/cherry.v2.png']
  });
  assert.equal(idx.assets.length, 2, 'version files are not top-level assets');
  const cherry = idx.byPath.get('assets/symbols/cherry.png')!;
  assert.deepEqual(cherry.versions.map((v) => v.n), [1, 2]);
  assert.equal(cherry.versions[1].source, 'file');
  assert.equal(cherry.versions[1].path, 'assets/symbols/cherry.v2.png');
});

test('a .vN file whose live asset is missing IS its own asset, never hidden', () => {
  const idx = buildIndex({ ...base(), filePaths: ['assets/ui/orphan.v2.png'] });
  assert.equal(idx.assets.length, 1);
  assert.equal(idx.assets[0].path, 'assets/ui/orphan.v2.png');
});

test('an asset referenced by path is used', () => {
  const idx = buildIndex({ ...base(), referencedPaths: new Set(['assets/symbols/cherry.png']) });
  assert.equal(idx.byPath.get('assets/symbols/cherry.png')!.used, true);
  assert.equal(idx.byPath.get('assets/keyart/hero.png')!.used, false);
});

test('an asset referenced by uid is used', () => {
  const idx = buildIndex({
    ...base(),
    meta: { 'assets/symbols/cherry.png': { uid: 'abc123' } },
    referencedUids: new Set(['abc123'])
  });
  assert.equal(idx.byPath.get('assets/symbols/cherry.png')!.used, true);
});

test('rolesInIndex lists built-ins in vocabulary order then custom roles sorted', () => {
  const b = base();
  const idx = buildIndex({
    ...b,
    filePaths: [...b.filePaths, 'assets/weird/x.png'],
    meta: { 'assets/weird/x.png': { role: 'confetti', roleInferred: false } }
  });
  assert.deepEqual(rolesInIndex(idx), ['keyart', 'sprite', 'confetti']);
  assert.deepEqual(roleCounts(idx), { keyart: 1, sprite: 1, confetti: 1 });
});

test('index reports what needs persisting, and nothing when already correct', () => {
  const idx = buildIndex(base());
  assert.equal(idx.pendingWrites.size, 2, 'both inferred roles need persisting');
  assert.equal(idx.needsUid.size, 2);

  const clean = buildIndex({
    ...base(),
    meta: {
      'assets/keyart/hero.png': { role: 'keyart', roleInferred: true, uid: 'a' },
      'assets/symbols/cherry.png': { role: 'sprite', roleInferred: true, uid: 'b' }
    }
  });
  assert.equal(clean.pendingWrites.size, 0);
  assert.equal(clean.needsUid.size, 0);
});
