// Autoplay (slot feature 22): start/roundComplete/stop, the stop-condition ORDER
// (feature, win, balance, count), the not-allowed refusal, and timer cleanup.
'use strict';

const { defineFeature, mount, useFakeClock } = require('./harness');

const Autoplay = defineFeature('autoplay.js');

useFakeClock();

describe('Autoplay', () => {
  test('module shape and metadata', () => {
    const mod = require('../../../../private/xgenia-pro-nodes/src/slot-games/features/autoplay.js');
    expect(Object.keys(mod)).toEqual(['node']);
    expect(mod.node.name).toBe('Autoplay');
    expect(mod.node.category).toBe('Slot Games');
    expect(mod.node.docs).toBe('https://docsapp.xgenia.com/nodes/slot-features/autoplay');
    expect(typeof mod.node.description).toBe('string');
    expect(Array.isArray(mod.node.searchTags)).toBe(true);
    const inputs = Object.keys(Autoplay.metadata.inputs).filter((n) => n !== 'functionScript');
    expect(inputs.sort()).toEqual(
      ['start', 'stop', 'roundComplete', 'spins', 'delayMs', 'stopOnAnyWin', 'stopOnWinAbove', 'stopOnBalanceBelow',
        'stopOnFeature', 'lastWin', 'balance', 'featureTriggered', 'allowed'].sort()
    );
    expect(Object.keys(Autoplay.metadata.outputs).sort()).toEqual(
      ['spin', 'remaining', 'active', 'stopped', 'stopReason', 'spinsDone'].sort()
    );
    expect(Autoplay.metadata.outputs.spin.type).toBe('signal');
    expect(Autoplay.metadata.outputs.stopped.type).toBe('signal');
  });

  test('start fires spin immediately and arms the counters', async () => {
    const h = await mount(Autoplay, { spins: 3, delayMs: 500 });
    expect(h.out('active')).toBe(false);
    h.fire('start');
    expect(h.signals).toEqual(['spin']);
    expect(h.out('active')).toBe(true);
    expect(h.out('remaining')).toBe(3);
    expect(h.out('spinsDone')).toBe(0);
    expect(h.out('stopReason')).toBe('');
  });

  test('roundComplete counts down and schedules the next spin after delayMs', async () => {
    const h = await mount(Autoplay, { spins: 3, delayMs: 500 });
    h.fire('start');
    h.fire('roundComplete');
    expect(h.out('remaining')).toBe(2);
    expect(h.out('spinsDone')).toBe(1);
    expect(h.count('spin')).toBe(1);
    h.advance(499);
    expect(h.count('spin')).toBe(1);
    h.advance(1);
    expect(h.count('spin')).toBe(2);
    expect(h.count('stopped')).toBe(0);
  });

  test('stops with "count" after the last round; nothing fires afterwards', async () => {
    const h = await mount(Autoplay, { spins: 2, delayMs: 100 });
    h.fire('start');
    h.fire('roundComplete');
    h.advance(100);
    expect(h.count('spin')).toBe(2);
    h.fire('roundComplete');
    expect(h.signals.filter((s) => s === 'stopped')).toEqual(['stopped']);
    expect(h.out('stopReason')).toBe('count');
    expect(h.out('active')).toBe(false);
    expect(h.out('remaining')).toBe(0);
    expect(h.out('spinsDone')).toBe(2);
    h.advance(5000);
    expect(h.count('spin')).toBe(2);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('delayMs 0 fires the next spin in the same update', async () => {
    const h = await mount(Autoplay, { spins: 5, delayMs: 0 });
    h.fire('start');
    h.fire('roundComplete');
    expect(h.count('spin')).toBe(2);
  });

  test('stopOnAnyWin stops with "win" on any positive lastWin', async () => {
    const h = await mount(Autoplay, { spins: 5, stopOnAnyWin: true });
    h.fire('start');
    h.set('lastWin', 0);
    h.fire('roundComplete');
    expect(h.count('stopped')).toBe(0);
    h.set('lastWin', 5);
    h.fire('roundComplete');
    expect(h.count('stopped')).toBe(1);
    expect(h.out('stopReason')).toBe('win');
  });

  test('stopOnWinAbove: equal does not stop, above does', async () => {
    const h = await mount(Autoplay, { spins: 5, stopOnWinAbove: 100 });
    h.fire('start');
    h.set('lastWin', 100);
    h.fire('roundComplete');
    expect(h.count('stopped')).toBe(0);
    h.set('lastWin', 101);
    h.fire('roundComplete');
    expect(h.out('stopReason')).toBe('win');
  });

  test('stopOnBalanceBelow stops with "balance"', async () => {
    const h = await mount(Autoplay, { spins: 5, stopOnBalanceBelow: 1000 });
    h.fire('start');
    h.set('balance', 1000);
    h.fire('roundComplete');
    expect(h.count('stopped')).toBe(0);
    h.set('balance', 999);
    h.fire('roundComplete');
    expect(h.out('stopReason')).toBe('balance');
  });

  test('stopOnFeature (default true) stops with "feature"; disabled it keeps going', async () => {
    const h = await mount(Autoplay, { spins: 5 });
    h.fire('start');
    h.set('featureTriggered', true);
    h.fire('roundComplete');
    expect(h.out('stopReason')).toBe('feature');

    const h2 = await mount(Autoplay, { spins: 5, stopOnFeature: false, delayMs: 10 });
    h2.fire('start');
    h2.set('featureTriggered', true);
    h2.fire('roundComplete');
    expect(h2.count('stopped')).toBe(0);
    h2.advance(10);
    expect(h2.count('spin')).toBe(2);
  });

  test('stop conditions are evaluated in the order feature, win, balance, count', async () => {
    const all = { spins: 1, stopOnAnyWin: true, stopOnBalanceBelow: 1000 };
    const h = await mount(Autoplay, all);
    h.fire('start');
    h.set('featureTriggered', true);
    h.set('lastWin', 50);
    h.set('balance', 1);
    h.fire('roundComplete');
    expect(h.out('stopReason')).toBe('feature');

    const h2 = await mount(Autoplay, all);
    h2.fire('start');
    h2.set('lastWin', 50);
    h2.set('balance', 1);
    h2.fire('roundComplete');
    expect(h2.out('stopReason')).toBe('win');

    const h3 = await mount(Autoplay, all);
    h3.fire('start');
    h3.set('balance', 1);
    h3.fire('roundComplete');
    expect(h3.out('stopReason')).toBe('balance');
  });

  test('manual stop cancels the pending delay timer', async () => {
    const h = await mount(Autoplay, { spins: 5, delayMs: 600 });
    h.fire('start');
    h.fire('roundComplete');
    expect(jest.getTimerCount()).toBe(1);
    h.fire('stop');
    expect(h.out('stopReason')).toBe('manual');
    expect(h.out('active')).toBe(false);
    expect(h.count('stopped')).toBe(1);
    expect(jest.getTimerCount()).toBe(0);
    h.advance(2000);
    expect(h.count('spin')).toBe(1);
  });

  test('stop while idle does nothing', async () => {
    const h = await mount(Autoplay, {});
    h.fire('stop');
    expect(h.signals).toEqual([]);
    expect(h.out('stopReason')).toBe('');
  });

  test('not allowed: start is refused with stopped/"not-allowed" and no spin', async () => {
    const h = await mount(Autoplay, { spins: 5, allowed: false });
    h.fire('start');
    expect(h.signals).toEqual(['stopped']);
    expect(h.out('stopReason')).toBe('not-allowed');
    expect(h.out('active')).toBe(false);
    expect(h.out('remaining')).toBe(0);
  });

  test('allowed turning false mid-run stops at the next roundComplete', async () => {
    const h = await mount(Autoplay, { spins: 5 });
    h.fire('start');
    h.set('allowed', false);
    h.fire('roundComplete');
    expect(h.out('stopReason')).toBe('not-allowed');
  });

  test('stopped and spin are re-triggerable across runs (signals, not boolean edges)', async () => {
    const h = await mount(Autoplay, { spins: 1 });
    h.fire('start');
    h.fire('roundComplete');
    h.fire('start');
    h.fire('roundComplete');
    expect(h.count('spin')).toBe(2);
    expect(h.count('stopped')).toBe(2);
    expect(h.out('stopReason')).toBe('count');
  });

  test('start while active is ignored', async () => {
    const h = await mount(Autoplay, { spins: 5 });
    h.fire('start');
    h.fire('start');
    expect(h.count('spin')).toBe(1);
    expect(h.out('remaining')).toBe(5);
  });

  test('spins 0 stops immediately with "count" and never spins', async () => {
    const h = await mount(Autoplay, { spins: 0 });
    h.fire('start');
    expect(h.signals).toEqual(['stopped']);
    expect(h.out('stopReason')).toBe('count');
  });

  test('deleting the node clears the pending timer (dispose path)', async () => {
    const h = await mount(Autoplay, { spins: 5, delayMs: 600 });
    h.fire('start');
    h.fire('roundComplete');
    expect(jest.getTimerCount()).toBe(1);
    h.dispose();
    expect(jest.getTimerCount()).toBe(0);
    h.advance(5000);
    expect(h.count('spin')).toBe(1);
  });

  test('getInspectInfo reports the run', async () => {
    const h = await mount(Autoplay, { spins: 4 });
    expect(h.node.getInspectInfo()).toMatch(/idle/);
    h.fire('start');
    expect(h.node.getInspectInfo()).toMatch(/active/);
    expect(h.node.getInspectInfo()).toMatch(/4 remaining/);
  });
});
