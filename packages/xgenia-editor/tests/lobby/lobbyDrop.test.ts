import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeDrop, type DroppedKind } from '../../src/editor/src/models/lobby/lobbyDrop';

const disk: Record<string, DroppedKind> = {
  '/games/neon': 'game',
  '/games/tiki': 'game',
  '/photos': 'folder'
};

const kindOf = (p: string): DroppedKind => disk[p] ?? 'other';

test('a file is turned away, never opened', () => {
  assert.deepEqual(judgeDrop(['/photos/cover.png'], kindOf), { games: [], reason: 'not-a-folder' });
  assert.deepEqual(judgeDrop(['/games/neon.zip', '/games/neon/project.json'], kindOf), {
    games: [],
    reason: 'not-a-folder'
  });
});

test('a folder without a project.json gets its own reason', () => {
  assert.deepEqual(judgeDrop(['/photos'], kindOf), { games: [], reason: 'no-project' });
  assert.deepEqual(judgeDrop(['/photos/cover.png', '/photos'], kindOf), { games: [], reason: 'no-project' });
});

test('games keep their drop order, and whatever came with them is left out', () => {
  assert.deepEqual(judgeDrop(['/photos/cover.png', '/games/tiki', '/photos', '/games/neon'], kindOf), {
    games: ['/games/tiki', '/games/neon']
  });
});

test('a drop that brought no paths is reported, not ignored', () => {
  assert.deepEqual(judgeDrop([], kindOf), { games: [], reason: 'not-a-folder' });
});
