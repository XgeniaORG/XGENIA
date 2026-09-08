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

// (2026-09-07, export 1788803211511) persist() used to be a bare fire-and-forget
// filesystem.writeFile; 17 overlapping writes tore the file, and loadAssetMeta() then
// adopted `{}` over the torn file so the next write wiped every record. Both are locked
// at the source level for the same reason as the keep-rule above.
test('persist() goes through the serialized atomic writer, never a bare writeFile', () => {
  const body = src.slice(src.indexOf('function persist('), src.indexOf('export function getAssetMeta('));
  assert.ok(body.includes('writer.schedule('), 'persist() must schedule on the serialized writer');
  assert.ok(!body.includes('filesystem.writeFile('), 'persist() must not call filesystem.writeFile directly');
  assert.ok(src.includes('atomicWriteText(filesystem'), 'the writer must write atomically (tmp + rename)');
});

test('loadAssetMeta() salvages a corrupt file and quarantines the original instead of adopting {}', () => {
  const start = src.indexOf('export async function loadAssetMeta');
  const body = src.slice(start, src.indexOf('\nasync function persist', start));
  assert.ok(body.includes('salvageJsonObject('), 'loadAssetMeta must salvage the longest valid prefix');
  assert.ok(body.includes('quarantineCorruptMeta('), 'loadAssetMeta must keep the corrupt bytes on disk');
  assert.ok(!body.includes('JSON.parse('), 'loadAssetMeta must not parse-or-empty');
});

test('flushAssetMeta is exported so the bridge can wait for a write to land', () => {
  assert.ok(src.includes('export function flushAssetMeta('));
});
