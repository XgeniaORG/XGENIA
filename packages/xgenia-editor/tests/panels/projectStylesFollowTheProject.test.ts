import { test } from 'node:test';
import assert from 'node:assert/strict';
import { metaBelongsElsewhere } from '../../src/editor/src/views/panels/ProjectStylesPanel/metaOwner';

// The genie slot "Nice" was opened after the Aphrodite project in one editor session and kept
// its "amphora, olive wreath" style prompt: the cache was read once and never again.
test('a different project re-reads the styles', () => {
  const aphrodite = { name: 'Untitled-7' };
  const genie = { name: 'Nice' };
  assert.equal(metaBelongsElsewhere(aphrodite, genie), true);
});

test('the same project keeps the cache', () => {
  const p = { name: 'Nice' };
  assert.equal(metaBelongsElsewhere(p, p), false);
});

test('no project open keeps the cache; the first project opened reads its own', () => {
  assert.equal(metaBelongsElsewhere({ name: 'Nice' }, undefined), false);
  assert.equal(metaBelongsElsewhere(undefined, { name: 'Nice' }), true);
});
