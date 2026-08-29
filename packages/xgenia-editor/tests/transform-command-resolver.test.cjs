const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveGesture,
  parseUnitValue
} = require('../src/editor/src/utils/TransformCommandResolver.js');

// ---- parseUnitValue ----
test('parses px string', () => {
  assert.deepEqual(parseUnitValue('15px', 'px'), { value: 15, unit: 'px' });
});
test('parses % string', () => {
  assert.deepEqual(parseUnitValue('10%', 'px'), { value: 10, unit: '%' });
});
test('bare number keeps empty unit', () => {
  assert.deepEqual(parseUnitValue(120, 'px'), { value: 120, unit: '' });
});
test('undefined falls back to default unit at 0', () => {
  assert.deepEqual(parseUnitValue(undefined, 'px'), { value: 0, unit: 'px' });
});
test('object {value,unit} form is honored', () => {
  assert.deepEqual(parseUnitValue({ value: 25, unit: '%' }, 'px'), { value: 25, unit: '%' });
});

// ---- pixi ----
test('pixi move writes bare numbers', () => {
  const r = resolveGesture(
    { kind: 'pixi', gesture: 'move', x: 100.4, y: 50.6 },
    { parameters: {} }
  );
  assert.deepEqual(r.writes, [
    { param: 'x', value: 100.4 },
    { param: 'y', value: 50.6 }
  ]);
  assert.equal(r.blocked, undefined);
});
test('pixi resize writes width/height numbers', () => {
  const r = resolveGesture(
    { kind: 'pixi', gesture: 'resize', x: 10, y: 20, width: 300, height: 200 },
    { parameters: {} }
  );
  assert.deepEqual(r.writes, [
    { param: 'x', value: 10 },
    { param: 'y', value: 20 },
    { param: 'width', value: 300 },
    { param: 'height', value: 200 }
  ]);
});
test('pixi rotate writes radians', () => {
  const r = resolveGesture(
    { kind: 'pixi', gesture: 'rotate', rotation: 1.57 },
    { parameters: {} }
  );
  assert.deepEqual(r.writes, [{ param: 'rotation', value: 1.57 }]);
});

// ---- dom move ----
test('dom absolute move preserves px margins', () => {
  const r = resolveGesture(
    {
      kind: 'dom', gesture: 'move', deltaX: 30, deltaY: -10,
      startRect: { width: 100, height: 40 },
      parentRect: { width: 800, height: 600 }
    },
    { parameters: { position: 'absolute', marginLeft: '15px', marginTop: '5px' } }
  );
  assert.deepEqual(r.writes, [
    { param: 'marginLeft', value: '45px' },
    { param: 'marginTop', value: '-5px' }
  ]);
});
test('dom absolute move preserves % margins against parent box', () => {
  const r = resolveGesture(
    {
      kind: 'dom', gesture: 'move', deltaX: 80, deltaY: 60,
      startRect: { width: 100, height: 40 },
      parentRect: { width: 800, height: 600 }
    },
    { parameters: { position: 'absolute', marginLeft: '10%', marginTop: '10%' } }
  );
  // 80px of 800 = +10% → 20%; 60px of 600 = +10% → 20%
  assert.deepEqual(r.writes, [
    { param: 'marginLeft', value: '20%' },
    { param: 'marginTop', value: '20%' }
  ]);
});
test('dom absolute move with unset margins starts from 0px', () => {
  const r = resolveGesture(
    {
      kind: 'dom', gesture: 'move', deltaX: 12, deltaY: 7,
      startRect: { width: 100, height: 40 },
      parentRect: { width: 800, height: 600 }
    },
    { parameters: { position: 'absolute' } }
  );
  assert.deepEqual(r.writes, [
    { param: 'marginLeft', value: '12px' },
    { param: 'marginTop', value: '7px' }
  ]);
});
test('dom in-flow move is blocked (P2 reorder)', () => {
  const r = resolveGesture(
    {
      kind: 'dom', gesture: 'move', deltaX: 30, deltaY: 10,
      startRect: { width: 100, height: 40 },
      parentRect: { width: 800, height: 600 }
    },
    { parameters: {} } // position undefined = relative, in layout flow
  );
  assert.equal(r.blocked, 'in-flow');
  assert.deepEqual(r.writes, []);
});

// ---- dom resize ----
test('dom resize preserves px unit', () => {
  const r = resolveGesture(
    {
      kind: 'dom', gesture: 'resize', width: 250, height: 90,
      startRect: { width: 200, height: 80 },
      parentRect: { width: 1000, height: 400 }
    },
    { parameters: { width: '200px', height: '80px' } }
  );
  assert.deepEqual(r.writes, [
    { param: 'width', value: '250px' },
    { param: 'height', value: '90px' }
  ]);
});
test('dom resize preserves % unit against parent box', () => {
  const r = resolveGesture(
    {
      kind: 'dom', gesture: 'resize', width: 500, height: 100,
      startRect: { width: 200, height: 80 },
      parentRect: { width: 1000, height: 400 }
    },
    { parameters: { width: '20%', height: '20%' } }
  );
  assert.deepEqual(r.writes, [
    { param: 'width', value: '50%' },
    { param: 'height', value: '25%' }
  ]);
});
test('dom resize with unset dims writes px and flags sizeMode', () => {
  const r = resolveGesture(
    {
      kind: 'dom', gesture: 'resize', width: 250, height: 90,
      startRect: { width: 200, height: 80 },
      parentRect: { width: 1000, height: 400 }
    },
    { parameters: { sizeMode: 'contentHeight' } }
  );
  assert.equal(r.needsExplicitSizeMode, true);
  assert.deepEqual(r.writes, [
    { param: 'width', value: '250px' },
    { param: 'height', value: '90px' }
  ]);
});
test('dom resize when sizeMode already explicit does not re-flag', () => {
  const r = resolveGesture(
    {
      kind: 'dom', gesture: 'resize', width: 250, height: 90,
      startRect: { width: 200, height: 80 },
      parentRect: { width: 1000, height: 400 }
    },
    { parameters: { sizeMode: 'explicit', width: '200px', height: '80px' } }
  );
  assert.equal(r.needsExplicitSizeMode, undefined);
});

// ---- fail closed ----
test('transformed ancestor blocks every gesture', () => {
  for (const gesture of ['move', 'resize']) {
    const r = resolveGesture(
      {
        kind: 'dom', gesture, deltaX: 5, deltaY: 5, width: 10, height: 10,
        startRect: { width: 100, height: 40 },
        parentRect: { width: 800, height: 600 }
      },
      { parameters: { position: 'absolute' }, ancestorTransformed: true }
    );
    assert.equal(r.blocked, 'transformed-ancestor');
    assert.deepEqual(r.writes, []);
  }
});
test('resize of rotated dom target is blocked', () => {
  const r = resolveGesture(
    {
      kind: 'dom', gesture: 'resize', width: 250, height: 90,
      startRect: { width: 200, height: 80 },
      parentRect: { width: 1000, height: 400 }
    },
    { parameters: { position: 'absolute', transformRotation: 45, width: '200px', height: '80px' } }
  );
  assert.equal(r.blocked, 'rotated-target');
});
test('resize of rotated pixi target is blocked', () => {
  const r = resolveGesture(
    { kind: 'pixi', gesture: 'resize', x: 0, y: 0, width: 10, height: 10 },
    { parameters: { rotation: 0.5 } }
  );
  assert.equal(r.blocked, 'rotated-target');
});
test('unknown gesture is blocked, never guessed', () => {
  const r = resolveGesture(
    { kind: 'dom', gesture: 'squeeze' },
    { parameters: {} }
  );
  assert.equal(r.blocked, 'unknown-gesture');
  assert.deepEqual(r.writes, []);
});
