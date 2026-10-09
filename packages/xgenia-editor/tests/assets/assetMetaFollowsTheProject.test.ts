import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cacheBelongsTo } from '../../src/editor/src/views/panels/AssetPanel/assetMetaStore';

// (2026-10-07) The genie slot "Nice", opened after the Aphrodite project in one editor session, got the
// Aphrodite project's whole .xgenia-assets.json: getOrAssignUid() committed against the old project's
// cache and persist() wrote it to the new project's path.
test('a cache belongs only to the project it was read for', () => {
  assert.equal(cacheBelongsTo('/Downloads/Untitled-7', '/Downloads/Untitled-7'), true);
  assert.equal(cacheBelongsTo('/Downloads/Untitled-7', '/Downloads/Nice'), false);
  assert.equal(cacheBelongsTo(undefined, '/Downloads/Nice'), false);
  assert.equal(cacheBelongsTo('/Downloads/Untitled-7', null), false);
});

const src = readFileSync(join(__dirname, '../../src/editor/src/views/panels/AssetPanel/assetMeta.ts'), 'utf8');
const body = (start: string) => { const i = src.indexOf(start); assert.ok(i >= 0, start); return src.slice(i, src.indexOf('\n}', i)); };

test('persist() refuses to write another project\'s cache', () => {
  assert.match(body('async function persist('), /if \(!cacheBelongsTo\(loadedRoot, projectRoot\(\)\)\)/);
});

test('getOrAssignUid() assigns no uid from another project\'s cache', () => {
  assert.match(body('export function getOrAssignUid('), /if \(!cacheBelongsTo\(loadedRoot, projectRoot\(\)\)\)/);
});
