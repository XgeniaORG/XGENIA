import { test } from 'node:test';
import assert from 'node:assert/strict';
import { duplicateOffsetWrites, DUPLICATE_OFFSET } from '../../src/editor/src/utils/duplicatePlacement';

test('a node layout owns gets no offset — it lands in the next slot', () => {
  assert.deepEqual(duplicateOffsetWrites({ position: 'relative' }, 'Group', 'column'), []);
  assert.deepEqual(duplicateOffsetWrites({}, 'Image', 'row'), []);
});

test('an absolutely placed node moves down-right, keeping the param shape', () => {
  const writes = duplicateOffsetWrites(
    { position: 'absolute', transformX: { value: 40, unit: 'px', isFixed: true }, transformY: '-12px' },
    'Group',
    'column'
  );
  assert.deepEqual(writes, [
    { param: 'transformX', value: { value: 40 + DUPLICATE_OFFSET, unit: 'px', isFixed: true } },
    { param: 'transformY', value: { value: -12 + DUPLICATE_OFFSET, unit: 'px' } }
  ]);
});

test('every child of a free-placement group is free, whatever its own position says', () => {
  const writes = duplicateOffsetWrites({}, 'Image', 'none');
  assert.deepEqual(writes.map((w) => w.param), ['transformX', 'transformY']);
});

test('a % offset is left alone rather than guessed at', () => {
  const writes = duplicateOffsetWrites({ position: 'absolute', transformX: { value: 10, unit: '%' } }, 'Group');
  assert.deepEqual(writes.map((w) => w.param), ['transformY']);
});

test('pixi sprites offset their numeric x/y', () => {
  assert.deepEqual(duplicateOffsetWrites({ x: 100, y: 5 }, 'pixi.Sprite'), [
    { param: 'x', value: 110 },
    { param: 'y', value: 15 }
  ]);
});
