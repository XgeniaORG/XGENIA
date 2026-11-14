import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scaleChildWrites, followsParent } from '../../src/editor/src/utils/scaleChildWrites';

test('pixel sizes and offsets scale per axis, in the form they were written', () => {
  const writes = scaleChildWrites(
    { width: { value: 100, unit: 'px', isFixed: true }, height: '40px', transformX: 10, transformY: { value: 6, unit: 'px' } },
    2, 1.5
  );
  assert.deepEqual(writes, [
    { param: 'width', value: { value: 200, unit: 'px', isFixed: true } },
    { param: 'transformX', value: 20 },
    { param: 'height', value: '60px' },
    { param: 'transformY', value: { value: 9, unit: 'px' } }
  ]);
});

test('percent values are left alone: they already follow the parent', () => {
  assert.deepEqual(scaleChildWrites({ width: { value: 50, unit: '%' }, height: '80%', transformX: '10%' }, 2, 2), []);
});

test('text size follows the smaller ratio', () => {
  assert.deepEqual(scaleChildWrites({ fontSize: { value: 20, unit: 'px' } }, 2, 1), []);
  assert.deepEqual(scaleChildWrites({ fontSize: { value: 20, unit: 'px' } }, 2, 1.5), [
    { param: 'fontSize', value: { value: 30, unit: 'px' } }
  ]);
});

test('an unchanged axis writes nothing', () => {
  assert.deepEqual(scaleChildWrites({ width: 100, height: 40 }, 1, 2), [{ param: 'height', value: 80 }]);
});

test('non-dimension and unreadable values are ignored', () => {
  assert.deepEqual(scaleChildWrites({ width: 'auto', height: null, color: '#fff', label: '12' }, 2, 2), []);
});

test('a bad ratio writes nothing', () => {
  assert.deepEqual(scaleChildWrites({ width: 100 }, 0, 2), []);
  assert.deepEqual(scaleChildWrites({ width: 100 }, NaN, 2), []);
});

test('followsParent', () => {
  assert.equal(followsParent({ value: 50, unit: '%' }), true);
  assert.equal(followsParent('50%'), true);
  assert.equal(followsParent({ value: 50, unit: 'px' }), false);
  assert.equal(followsParent(undefined), false);
});
