import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameFoldersIn } from '../../src/editor/src/views/lobby/dropTargets';

// (2026-10-07, tester report) A file dropped onto the projects page froze it on "Opening project".
const disk = new Set(['/games/Neon Miami/project.json', '/games/Aztec/project.json']);
const exists = (p: string) => disk.has(p);
const join = (...parts: string[]) => parts.join('/');

test('only folders that hold a project.json are opened', () => {
  assert.deepEqual(gameFoldersIn(['/games/Neon Miami', '/Downloads/key-art.png', '/games/Aztec'], exists, join), ['/games/Neon Miami', '/games/Aztec']);
});

test('a drop of files only opens nothing', () => {
  assert.deepEqual(gameFoldersIn(['/Downloads/key-art.png', '/Downloads/game.zip'], exists, join), []);
});

test('a filesystem that throws for a path does not throw out of the drop', () => {
  assert.deepEqual(gameFoldersIn(['/locked'], () => { throw new Error('EACCES'); }, join), []);
});
