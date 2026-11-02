import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameNameFrom } from '../../src/editor/src/views/lobby/gameName';

test('gameNameFrom: a title, not the first three words of a sentence', () => {
  assert.equal(gameNameFrom('A candy slot with free spins'), 'Candy Slot');
  assert.equal(gameNameFrom('Candy Rush, a candy slot with free spins'), 'Candy Rush');
  assert.equal(gameNameFrom('I want a pirate crash game where the ship sinks'), 'Pirate Crash Game');
  assert.equal(gameNameFrom('Neon plinko with 12 rows'), 'Neon Plinko');
  assert.equal(gameNameFrom('make me an egyptian slot'), 'Egyptian Slot');
  assert.equal(gameNameFrom('A 5-reel, 3-row slot with a neon Miami skyline'), '5-reel 3-row Slot');
  assert.equal(gameNameFrom('Zeus: a greek gods slot'), 'Zeus');
  assert.equal(gameNameFrom('A space crash game with a rocket'), 'Space Crash Game');
  assert.equal(gameNameFrom('   '), 'Untitled');
  assert.equal(gameNameFrom('pirate/gold slot'), 'Pirategold Slot'); // no characters a folder name cannot hold
});
