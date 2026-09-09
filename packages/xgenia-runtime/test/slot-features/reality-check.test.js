// Reality Check (slot feature 26): interval → due, acknowledge gating, session clock,
// bet/win totals via betPlaced/winPaid, stop/start semantics, interval cleanup on delete.
'use strict';

const { defineFeature, mount, useFakeClock } = require('./harness');

const RealityCheck = defineFeature('reality-check.js');

useFakeClock();

describe('Reality Check', () => {
  test('module shape and metadata', () => {
    const mod = require('../../../../private/xgenia-pro-nodes/src/slot-games/features/reality-check.js');
    expect(Object.keys(mod)).toEqual(['node']);
    expect(mod.node.name).toBe('Reality Check');
    expect(mod.node.category).toBe('Utilities');
    expect(mod.node.docs).toBe('https://docsapp.xgenia.com/nodes/slot-features/reality-check');
    expect(typeof mod.node.description).toBe('string');
    const inputs = Object.keys(RealityCheck.metadata.inputs).filter((n) => n !== 'functionScript');
    expect(inputs.sort()).toEqual(
      ['intervalMinutes', 'start', 'acknowledge', 'stop', 'bet', 'win', 'betPlaced', 'winPaid'].sort()
    );
    expect(Object.keys(RealityCheck.metadata.outputs).sort()).toEqual(
      ['due', 'elapsedMinutes', 'sessionSeconds', 'totalBet', 'totalWin', 'netPosition', 'checksShown', 'running'].sort()
    );
    expect(RealityCheck.metadata.outputs.due.type).toBe('signal');
  });

  test('due fires when the interval elapses; the clock counts every second', async () => {
    const h = await mount(RealityCheck, { intervalMinutes: 1 });
    expect(h.out('running')).toBe(false);
    h.fire('start');
    expect(h.out('running')).toBe(true);
    expect(jest.getTimerCount()).toBe(1);
    h.advance(59000);
    expect(h.out('sessionSeconds')).toBe(59);
    expect(h.out('elapsedMinutes')).toBe(0);
    expect(h.count('due')).toBe(0);
    h.advance(1000);
    expect(h.out('sessionSeconds')).toBe(60);
    expect(h.out('elapsedMinutes')).toBe(1);
    expect(h.count('due')).toBe(1);
    expect(h.out('checksShown')).toBe(1);
  });

  test('nothing re-fires until acknowledged; after acknowledge the next interval runs again', async () => {
    const h = await mount(RealityCheck, { intervalMinutes: 1 });
    h.fire('start');
    h.advance(60000);
    expect(h.count('due')).toBe(1);
    h.advance(180000); // 3 more minutes un-acknowledged
    expect(h.count('due')).toBe(1);
    expect(h.out('sessionSeconds')).toBe(240);
    h.fire('acknowledge');
    h.advance(59000);
    expect(h.count('due')).toBe(1);
    h.advance(1000);
    expect(h.count('due')).toBe(2);
    expect(h.out('checksShown')).toBe(2);
  });

  test('acknowledge with no check pending is a no-op', async () => {
    const h = await mount(RealityCheck, { intervalMinutes: 1 });
    h.fire('start');
    h.advance(30000);
    h.fire('acknowledge');
    h.advance(30000);
    expect(h.count('due')).toBe(1); // the period was NOT restarted by the stray acknowledge
  });

  test('betPlaced/winPaid add the current bet/win; netPosition = totalWin - totalBet', async () => {
    const h = await mount(RealityCheck, {});
    h.fire('start');
    h.set('bet', 100);
    h.fire('betPlaced');
    h.fire('betPlaced');
    h.fire('betPlaced');
    expect(h.out('totalBet')).toBe(300);
    h.set('win', 500);
    h.fire('winPaid');
    expect(h.out('totalWin')).toBe(500);
    expect(h.out('netPosition')).toBe(200);
    // a value change alone is NOT an event
    h.set('bet', 999);
    expect(h.out('totalBet')).toBe(300);
  });

  test('stop pauses the clock and keeps the totals; start resets everything', async () => {
    const h = await mount(RealityCheck, { intervalMinutes: 1 });
    h.fire('start');
    h.set('bet', 10);
    h.fire('betPlaced');
    h.advance(30000);
    h.fire('stop');
    expect(h.out('running')).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
    h.advance(120000);
    expect(h.out('sessionSeconds')).toBe(30);
    expect(h.out('totalBet')).toBe(10);
    expect(h.count('due')).toBe(0);
    h.fire('start');
    expect(h.out('sessionSeconds')).toBe(0);
    expect(h.out('totalBet')).toBe(0);
    expect(h.out('checksShown')).toBe(0);
    expect(h.out('running')).toBe(true);
    expect(jest.getTimerCount()).toBe(1);
  });

  test('intervalMinutes 0 disables the check', async () => {
    const h = await mount(RealityCheck, { intervalMinutes: 0 });
    h.fire('start');
    h.advance(3600000);
    expect(h.count('due')).toBe(0);
    expect(h.out('elapsedMinutes')).toBe(60);
  });

  test('deleting the node clears the interval (dispose path)', async () => {
    const h = await mount(RealityCheck, { intervalMinutes: 1 });
    h.fire('start');
    expect(jest.getTimerCount()).toBe(1);
    h.dispose();
    expect(jest.getTimerCount()).toBe(0);
    h.advance(120000);
    expect(h.count('due')).toBe(0);
  });

  test('getInspectInfo reports the session', async () => {
    const h = await mount(RealityCheck, {});
    expect(h.node.getInspectInfo()).toMatch(/Stopped/);
    h.fire('start');
    h.advance(5000);
    expect(h.node.getInspectInfo()).toMatch(/Running 5s/);
  });
});
