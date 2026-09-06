import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTrashName,
  deriveTrashVersions,
  nextVersionPath,
  splitVersionSibling
} from '../../src/editor/src/views/panels/AssetPanel/assetVersions';

test('parses the name save_image writes into .trash', () => {
  const p = parseTrashName('assets_symbols_cherry.2026-09-06T10-11-12-345Z.png');
  assert.ok(p);
  assert.equal(p!.folderSlug, 'assets_symbols');
  assert.equal(p!.base, 'cherry');
  assert.equal(p!.ext, 'png');
  assert.ok(p!.timestamp > 0);
});

test('parses the overwrite-backup name, which carries no folder slug', () => {
  const p = parseTrashName('cherry.2026-09-06T10-11-12-345Z.png');
  assert.ok(p);
  assert.equal(p!.folderSlug, '');
  assert.equal(p!.base, 'cherry');
});

test('rejects a file that is not a timestamped backup', () => {
  assert.equal(parseTrashName('notes.txt'), null);
  assert.equal(parseTrashName('cherry.png'), null);
});

test('a dotted asset name still parses, timestamp is the last dotted segment', () => {
  const p = parseTrashName('assets_ui_bar.v2.2026-09-06T10-11-12-345Z.png');
  assert.ok(p);
  assert.equal(p!.base, 'bar.v2');
});

test('groups backups under the live asset and numbers them oldest first', () => {
  const map = deriveTrashVersions(
    [
      'assets_symbols_cherry.2026-09-06T12-00-00-000Z.png',
      'assets_symbols_cherry.2026-09-06T10-00-00-000Z.png',
      'assets_symbols_cherry.2026-09-06T11-00-00-000Z.png'
    ],
    ['assets/symbols/cherry.png']
  );
  const versions = map.get('assets/symbols/cherry.png');
  assert.equal(versions?.length, 3);
  assert.deepEqual(versions!.map((v) => v.n), [1, 2, 3]);
  assert.ok(versions![0].timestamp < versions![2].timestamp);
  assert.equal(versions![0].trashName, 'assets_symbols_cherry.2026-09-06T10-00-00-000Z.png');
});

test('a backup whose live asset is gone is not attributed to anything', () => {
  const map = deriveTrashVersions(
    ['assets_symbols_gone.2026-09-06T10-00-00-000Z.png'],
    ['assets/symbols/cherry.png']
  );
  assert.equal(map.size, 0);
});

test('a slugless backup matches a live asset by basename when it is unambiguous', () => {
  const map = deriveTrashVersions(
    ['cherry.2026-09-06T10-00-00-000Z.png'],
    ['assets/symbols/cherry.png']
  );
  assert.equal(map.get('assets/symbols/cherry.png')?.length, 1);
});

test('a slugless backup matching two live assets is attributed to NEITHER', () => {
  const map = deriveTrashVersions(
    ['cherry.2026-09-06T10-00-00-000Z.png'],
    ['assets/symbols/cherry.png', 'assets/icons/cherry.png']
  );
  assert.equal(map.size, 0);
});

test('numbers the first version v1', () => {
  assert.equal(nextVersionPath('assets/ui/bar.png', []), 'assets/ui/bar.v1.png');
});

test('continues from the highest existing version, not the count', () => {
  assert.equal(
    nextVersionPath('assets/ui/bar.png', ['assets/ui/bar.v1.png', 'assets/ui/bar.v3.png']),
    'assets/ui/bar.v4.png'
  );
});

test('ignores unrelated siblings when numbering', () => {
  assert.equal(
    nextVersionPath('assets/ui/bar.png', ['assets/ui/barn.v9.png', 'assets/ui/bar.png']),
    'assets/ui/bar.v1.png'
  );
});

test('keeps the extension of the live file', () => {
  assert.equal(nextVersionPath('assets/ui/bar.webp', []), 'assets/ui/bar.v1.webp');
});

test('splitVersionSibling recognises a version file and rejects a plain one', () => {
  assert.deepEqual(splitVersionSibling('assets/ui/bar.v2.png'), { of: 'assets/ui/bar.png', n: 2 });
  assert.equal(splitVersionSibling('assets/ui/bar.png'), null);
  assert.equal(splitVersionSibling('assets/ui/bar.v0.png'), null);
});
