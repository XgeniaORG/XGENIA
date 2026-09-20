const CounterNode = require('../../src/nodes/std-library/counter').node;

// `reset` guarded on `this.currentValue === 0` — a property that does not exist on the
// node (the count lives in `_internal.currentValue`), so the guard never fired and every
// reset announced countChanged even when nothing changed. A page that wired
// maths.CascadeSettled → Counter.reset → countChanged → Expression → maths input looped
// ~200×/s from mount (export 1789727384756, 2026-09-18). The guard's evident intent:
// a reset that leaves the count where it already was announces nothing.

function makeCounter(startValue = 0) {
  const ctx = { _internal: {}, flagOutputDirty: jest.fn(), sendSignalOnOutput: jest.fn() };
  CounterNode.initialize.call(ctx);
  CounterNode.inputs.startValue.set.call(ctx, startValue);
  ctx.flagOutputDirty.mockClear();
  ctx.sendSignalOnOutput.mockClear();
  return ctx;
}
const fire = (ctx, port) => CounterNode.inputs[port].valueChangedToTrue.call(ctx);

describe('Counter.reset', () => {
  test('at the start value it announces nothing', () => {
    const c = makeCounter(0);
    fire(c, 'reset');
    expect(c._internal.currentValue).toBe(0);
    expect(c.sendSignalOnOutput).not.toHaveBeenCalled();
    expect(c.flagOutputDirty).not.toHaveBeenCalled();
  });

  test('from 5 it returns to the start value and announces once', () => {
    const c = makeCounter(0);
    for (let i = 0; i < 5; i++) fire(c, 'increase');
    c.sendSignalOnOutput.mockClear();
    fire(c, 'reset');
    expect(c._internal.currentValue).toBe(0);
    expect(c.sendSignalOnOutput).toHaveBeenCalledTimes(1);
    expect(c.sendSignalOnOutput).toHaveBeenCalledWith('countChanged');
  });

  test('compares against the start value, not zero', () => {
    const c = makeCounter(3);
    fire(c, 'reset');
    expect(c._internal.currentValue).toBe(3);
    expect(c.sendSignalOnOutput).not.toHaveBeenCalled();
    fire(c, 'decrease');
    c.sendSignalOnOutput.mockClear();
    fire(c, 'reset');
    expect(c._internal.currentValue).toBe(3);
    expect(c.sendSignalOnOutput).toHaveBeenCalledWith('countChanged');
  });

  test('increase and decrease still announce every change', () => {
    const c = makeCounter(0);
    fire(c, 'increase');
    fire(c, 'decrease');
    expect(c.sendSignalOnOutput).toHaveBeenCalledTimes(2);
  });
});
