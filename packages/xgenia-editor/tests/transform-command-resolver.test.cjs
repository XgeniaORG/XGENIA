const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveGesture,
  parseUnitValue,
  getCapabilities
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
    { param: 'marginLeft', value: { value: 45, unit: 'px', isFixed: false } },
    { param: 'marginTop', value: { value: -5, unit: 'px', isFixed: false } }
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
    { param: 'marginLeft', value: { value: 20, unit: '%', isFixed: false } },
    { param: 'marginTop', value: { value: 20, unit: '%', isFixed: false } }
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
    { param: 'marginLeft', value: { value: 12, unit: 'px', isFixed: false } },
    { param: 'marginTop', value: { value: 7, unit: 'px', isFixed: false } }
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
    { param: 'width', value: { value: 250, unit: 'px', isFixed: false } },
    { param: 'height', value: { value: 90, unit: 'px', isFixed: false } }
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
    { param: 'width', value: { value: 50, unit: '%', isFixed: false } },
    { param: 'height', value: { value: 25, unit: '%', isFixed: false } }
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
    { param: 'width', value: { value: 250, unit: 'px', isFixed: false } },
    { param: 'height', value: { value: 90, unit: 'px', isFixed: false } }
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
test('dom move reads canonical {value,unit} params and preserves isFixed', () => {
  const r = resolveGesture(
    {
      kind: 'dom', gesture: 'move', deltaX: 10, deltaY: 10,
      startRect: { width: 100, height: 40 },
      parentRect: { width: 800, height: 600 }
    },
    { parameters: {
      position: 'absolute',
      marginLeft: { value: 30, unit: 'px', isFixed: true },
      marginTop: { value: 10, unit: '%', isFixed: false }
    } }
  );
  assert.deepEqual(r.writes, [
    { param: 'marginLeft', value: { value: 40, unit: 'px', isFixed: true } },
    { param: 'marginTop', value: { value: 11.67, unit: '%', isFixed: false } }
  ]);
});
test('dom resize reads canonical {value,unit} width and stays %', () => {
  const r = resolveGesture(
    {
      kind: 'dom', gesture: 'resize', width: 400, height: 100,
      startRect: { width: 200, height: 80 },
      parentRect: { width: 1000, height: 400 }
    },
    { parameters: {
      width: { value: 20, unit: '%', isFixed: false },
      height: { value: 80, unit: 'px', isFixed: true }
    } }
  );
  assert.deepEqual(r.writes, [
    { param: 'width', value: { value: 40, unit: '%', isFixed: false } },
    { param: 'height', value: { value: 100, unit: 'px', isFixed: true } }
  ]);
});

// ---- dom rotate ----
test('dom rotate adds delta to current angle, writes bare degrees', () => {
  const r = resolveGesture(
    { kind: 'dom', gesture: 'rotate', deltaDeg: 30 },
    { parameters: { position: 'absolute', transformRotation: 15 } }
  );
  assert.deepEqual(r.writes, [{ param: 'transformRotation', value: { value: 45, unit: 'deg' } }]);
});
test('dom rotate from unset rotation starts at 0', () => {
  const r = resolveGesture(
    { kind: 'dom', gesture: 'rotate', deltaDeg: -22.5 },
    { parameters: {} } // in-flow is fine: rotation is a pure visual transform
  );
  assert.deepEqual(r.writes, [{ param: 'transformRotation', value: { value: -22.5, unit: 'deg' } }]);
});
test('dom rotate normalizes into (-180, 180]', () => {
  const r = resolveGesture(
    { kind: 'dom', gesture: 'rotate', deltaDeg: 200 },
    { parameters: { transformRotation: 170 } }
  );
  assert.deepEqual(r.writes, [{ param: 'transformRotation', value: { value: 10, unit: 'deg' } }]);
});
test('dom rotate blocked under transformed ancestor', () => {
  const r = resolveGesture(
    { kind: 'dom', gesture: 'rotate', deltaDeg: 30 },
    { parameters: {}, ancestorTransformed: true }
  );
  assert.equal(r.blocked, 'transformed-ancestor');
});

// ---- capabilities ----
test('capabilities: dom absolute unrotated gets everything', () => {
  assert.deepEqual(
    getCapabilities('dom', { position: 'absolute' }, false),
    { movable: true, resizable: true, rotatable: true }
  );
});
test('capabilities: dom in-flow cannot move but can resize and rotate', () => {
  assert.deepEqual(
    getCapabilities('dom', {}, false),
    { movable: false, moveReason: 'in-flow', resizable: true, rotatable: true }
  );
});
test('capabilities: rotated dom cannot resize', () => {
  const caps = getCapabilities('dom', { position: 'absolute', transformRotation: 45 }, false);
  assert.equal(caps.resizable, false);
  assert.equal(caps.resizeReason, 'rotated-target');
  assert.equal(caps.movable, true);
  assert.equal(caps.rotatable, true);
});
test('capabilities: transformed ancestor blocks everything', () => {
  assert.deepEqual(
    getCapabilities('dom', { position: 'absolute' }, true),
    {
      movable: false, moveReason: 'transformed-ancestor',
      resizable: false, resizeReason: 'transformed-ancestor',
      rotatable: false, rotateReason: 'transformed-ancestor'
    }
  );
});
test('capabilities: pixi unrotated gets everything', () => {
  assert.deepEqual(
    getCapabilities('pixi', {}, false),
    { movable: true, resizable: true, rotatable: true }
  );
});
test('capabilities: rotated pixi cannot resize', () => {
  const caps = getCapabilities('pixi', { rotation: 0.5 }, false);
  assert.equal(caps.resizable, false);
  assert.equal(caps.movable, true);
});

test('unknown gesture is blocked, never guessed', () => {
  const r = resolveGesture(
    { kind: 'dom', gesture: 'squeeze' },
    { parameters: {} }
  );
  assert.equal(r.blocked, 'unknown-gesture');
  assert.deepEqual(r.writes, []);
});
