import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalisePins,
  togglePin,
  pinAll,
  unpinAll,
  prunePins,
  MAX_PINS
} from '../../src/editor/src/models/lobby/lobbyPins';

test('normalise survives whatever settings hands back', () => {
  assert.deepEqual(normalisePins(undefined), []);
  assert.deepEqual(normalisePins(null), []);
  assert.deepEqual(normalisePins('a'), []);
  assert.deepEqual(normalisePins({ 0: 'a' }), []);
  assert.deepEqual(normalisePins(['a', 42, null, 'b']), ['a', 'b']);
});

test('normalise drops duplicates, blanks and surrounding space', () => {
  assert.deepEqual(normalisePins(['a', 'a', '  ', ' b ', '']), ['a', 'b']);
});

test('normalise enforces the ceiling', () => {
  const many = Array.from({ length: MAX_PINS + 10 }, (_, i) => `id-${i}`);
  assert.equal(normalisePins(many).length, MAX_PINS);
});

test('toggle adds to the front and removes in place', () => {
  assert.deepEqual(togglePin(['b'], 'a'), ['a', 'b']);
  assert.deepEqual(togglePin(['a', 'b'], 'a'), ['b']);
});

test('toggle returns the same reference when nothing changed', () => {
  const full = Array.from({ length: MAX_PINS }, (_, i) => `id-${i}`);
  assert.equal(togglePin(full, 'new'), full, 'at the ceiling, adding is a no-op');

  const pins = ['a'];
  assert.equal(togglePin(pins, ''), pins, 'an empty id is a no-op');
});

test('unpinning at the ceiling still works', () => {
  const full = Array.from({ length: MAX_PINS }, (_, i) => `id-${i}`);
  assert.equal(togglePin(full, 'id-0').length, MAX_PINS - 1);
});

test('pinAll adds only what is missing and respects the ceiling', () => {
  assert.deepEqual(pinAll(['a'], ['a', 'b', 'c']), ['b', 'c', 'a']);

  const pins = ['a'];
  assert.equal(pinAll(pins, ['a']), pins, 'nothing to add is a no-op');
  assert.equal(pinAll([], Array.from({ length: MAX_PINS + 5 }, (_, i) => `id-${i}`)).length, MAX_PINS);
});

test('unpinAll drops the named ids and no others', () => {
  assert.deepEqual(unpinAll(['a', 'b', 'c'], ['a', 'c']), ['b']);

  const pins = ['a'];
  assert.equal(unpinAll(pins, ['zzz']), pins, 'nothing to remove is a no-op');
});

test('prune drops pins whose project is gone', () => {
  assert.deepEqual(prunePins(['a', 'ghost', 'b'], ['a', 'b']), ['a', 'b']);

  const pins = ['a'];
  assert.equal(prunePins(pins, ['a', 'b']), pins, 'nothing to prune is a no-op');
});
