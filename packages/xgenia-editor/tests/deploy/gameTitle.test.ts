import { test } from 'node:test';
import assert from 'node:assert/strict';

import { gameTitle } from '../../src/editor/src/utils/compilation/gameTitle';

// 2026-11-04: 159 of 161 local games had no title, so every published page's tab read "XGENIA Viewer".

test('a game without a title publishes under its own name', () => {
  assert.equal(gameTitle(undefined, 'Lobby RGS Plinko'), 'Lobby RGS Plinko');
  assert.equal(gameTitle('  ', 'Lobby RGS Plinko'), 'Lobby RGS Plinko');
});

test('the old placeholder saved as a title counts as no title', () => {
  assert.equal(gameTitle('XGENIA Viewer', 'Lobby RGS Plinko'), 'Lobby RGS Plinko');
});

test('a title the maker set wins', () => {
  assert.equal(gameTitle('Neon Plinko', 'Lobby RGS Plinko'), 'Neon Plinko');
});

test('no title and no name still gives a title', () => {
  assert.equal(gameTitle(undefined, ''), 'XGENIA Viewer');
});
