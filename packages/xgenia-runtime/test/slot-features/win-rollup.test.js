// Win Rollup (slot feature 25): 0 -> amount over durationMs, minor-unit display, text
// formatting, tick cadence, skip, immediate cases, frame cleanup on delete.
'use strict';

const { defineFeature, mount, useFakeClock } = require('./harness');

const WinRollup = defineFeature('win-rollup.js');

useFakeClock();

describe('Win Rollup', () => {
  test('module shape and metadata', () => {
    const mod = require('../../../../private/xgenia-pro-nodes/src/slot-games/features/win-rollup.js');
    expect(Object.keys(mod)).toEqual(['node']);
    expect(mod.node.name).toBe('Win Rollup');
    expect(mod.node.category).toBe('Slot Games');
    expect(mod.node.docs).toBe('https://docsapp.xgenia.com/nodes/slot-features/win-rollup');
    expect(typeof mod.node.description).toBe('string');
    const inputs = Object.keys(WinRollup.metadata.inputs).filter((n) => n !== 'functionScript');
    expect(inputs.sort()).toEqual(
      ['start', 'amount', 'durationMs', 'skip', 'decimals', 'prefix', 'suffix', 'tickEveryMs', 'minorUnits'].sort()
    );
    expect(Object.keys(WinRollup.metadata.outputs).sort()).toEqual(
      ['value', 'text', 'running', 'tick', 'finished'].sort()
    );
  });

  test('rolls from 0 to amount/100 (minor units) over durationMs and finishes once', async () => {
    const h = await mount(WinRollup, { amount: 12345, durationMs: 1000 });
    expect(h.out('text')).toBe('0.00');
    h.fire('start');
    expect(h.out('running')).toBe(true);
    expect(h.out('value')).toBe(0);
    expect(h.count('tick')).toBe(1);
    h.advance(500);
    expect(h.out('value')).toBeGreaterThan(55);
    expect(h.out('value')).toBeLessThan(68);
    expect(h.out('text')).toMatch(/^\d+\.\d{2}$/);
    expect(h.count('finished')).toBe(0);
    h.advance(600);
    expect(h.out('value')).toBeCloseTo(123.45);
    expect(h.out('text')).toBe('123.45');
    expect(h.out('running')).toBe(false);
    expect(h.count('finished')).toBe(1);
    expect(h.signals[h.signals.length - 1]).toBe('finished');
    expect(h.signals[h.signals.length - 2]).toBe('tick');
    expect(jest.getTimerCount()).toBe(0);
  });

  test('tick fires at start, about every tickEveryMs while rolling, and once at the end', async () => {
    const h = await mount(WinRollup, { amount: 5000, durationMs: 1000, tickEveryMs: 100 });
    h.fire('start');
    h.advance(1100);
    // start(1) + ~8-9 cadence ticks (16ms frames) + final(1)
    expect(h.count('tick')).toBeGreaterThanOrEqual(8);
    expect(h.count('tick')).toBeLessThanOrEqual(12);
    expect(h.count('finished')).toBe(1);
  });

  test('tickEveryMs 0 ticks on every frame', async () => {
    const h = await mount(WinRollup, { amount: 5000, durationMs: 500, tickEveryMs: 0 });
    h.fire('start');
    h.advance(600);
    expect(h.count('tick')).toBeGreaterThan(25);
  });

  test('skip jumps to the end immediately', async () => {
    const h = await mount(WinRollup, { amount: 9900, durationMs: 2000 });
    h.fire('start');
    h.advance(200);
    expect(h.out('value')).toBeLessThan(99);
    h.fire('skip');
    expect(h.out('value')).toBe(99);
    expect(h.out('text')).toBe('99.00');
    expect(h.out('running')).toBe(false);
    expect(h.count('finished')).toBe(1);
    expect(jest.getTimerCount()).toBe(0);
    h.fire('skip'); // idle: no-op
    expect(h.count('finished')).toBe(1);
  });

  test('prefix/suffix/decimals and minorUnits false format the text', async () => {
    const h = await mount(WinRollup, {
      amount: 1234.5, durationMs: 0, decimals: 1, prefix: 'EUR ', suffix: ' WIN', minorUnits: false
    });
    h.fire('start');
    expect(h.out('value')).toBe(1234.5);
    expect(h.out('text')).toBe('EUR 1234.5 WIN');
    expect(h.count('finished')).toBe(1);
  });

  test('changing the format re-renders the text without a new roll', async () => {
    const h = await mount(WinRollup, { amount: 250, durationMs: 0 });
    h.fire('start');
    expect(h.out('text')).toBe('2.50');
    h.set('decimals', 0);
    expect(h.out('text')).toBe('3');
    h.set('prefix', '$');
    expect(h.out('text')).toBe('$3');
  });

  test('amount 0 finishes immediately; durationMs 0 shows the amount at once', async () => {
    const h = await mount(WinRollup, { amount: 0, durationMs: 1500 });
    h.fire('start');
    expect(h.out('running')).toBe(false);
    expect(h.count('finished')).toBe(1);
    expect(jest.getTimerCount()).toBe(0);

    const h2 = await mount(WinRollup, { amount: 700, durationMs: 0 });
    h2.fire('start');
    expect(h2.out('value')).toBe(7);
    expect(h2.count('finished')).toBe(1);
  });

  test('each start restarts from 0 and finished is re-triggerable', async () => {
    const h = await mount(WinRollup, { amount: 1000, durationMs: 300 });
    h.fire('start');
    h.advance(400);
    expect(h.count('finished')).toBe(1);
    h.set('amount', 2000);
    h.fire('start');
    expect(h.out('value')).toBe(0);
    h.advance(400);
    expect(h.out('value')).toBe(20);
    expect(h.count('finished')).toBe(2);
  });

  test('the amount set in the same update as start is the one rolled', async () => {
    const h = await mount(WinRollup, { durationMs: 0 });
    h.node.queueInput('amount', 4200);
    h.node.queueInput('start', true);
    h.node.queueInput('start', false);
    h.ctx.update();
    expect(h.out('value')).toBe(42);
  });

  test('deleting the node mid-roll cancels the frame (dispose path)', async () => {
    const h = await mount(WinRollup, { amount: 1000, durationMs: 1000 });
    h.fire('start');
    h.advance(100);
    expect(jest.getTimerCount()).toBe(1);
    h.dispose();
    expect(jest.getTimerCount()).toBe(0);
    h.advance(2000);
    expect(h.count('finished')).toBe(0);
  });

  test('getInspectInfo shows the formatted text', async () => {
    const h = await mount(WinRollup, { amount: 500, durationMs: 0 });
    h.fire('start');
    expect(h.node.getInspectInfo()).toBe('Idle: 5.00');
  });
});
