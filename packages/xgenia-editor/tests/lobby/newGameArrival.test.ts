import { test } from 'node:test';
import assert from 'node:assert/strict';

import { markNewGame, takeNewGame } from '../../src/editor/src/models/lobby/newGameArrival';

test('a game just created opens on the AI once', () => {
  markNewGame('p1');
  assert.equal(takeNewGame('p1'), true);
  assert.equal(takeNewGame('p1'), false);
});

test('a game that was not just created keeps the remembered panel', () => {
  assert.equal(takeNewGame('other'), false);
});
