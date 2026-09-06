import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(
  join(__dirname, '../../src/editor/src/views/panels/AssetPanel/assetMeta.ts'),
  'utf8'
);

// commit() is module-private and the module reaches for ProjectModel and the platform
// filesystem on import, so this asserts the keep-rule at the source level instead: every
// standalone field of AssetMetaEntry must appear in the emptiness check. A field added to
// the interface without being added to commit() silently deletes data on the next write.
test('commit() considers every standalone AssetMetaEntry field', () => {
  const commitBody = src.slice(src.indexOf('function commit('), src.indexOf('function genUid('));
  for (const field of ['tags', 'favorite', 'ai', 'uid', 'role', 'version', 'lineage', 'live']) {
    assert.ok(
      commitBody.includes(`entry.${field}`),
      `commit() must check entry.${field} or it will discard it`
    );
  }
});

test('mergeAssetMeta loads from disk before it writes', () => {
  const start = src.indexOf('export async function mergeAssetMeta');
  assert.ok(start > 0, 'mergeAssetMeta must exist');
  const body = src.slice(start, src.indexOf('\n}', start));
  assert.ok(
    body.includes('await loadAssetMeta()'),
    'must load first or it clobbers the file against an empty cache'
  );
});
