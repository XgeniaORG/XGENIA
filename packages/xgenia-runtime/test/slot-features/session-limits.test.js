// Session Limits (slot feature 27): wager/loss/session limits, -1 when off, blocked until
// reset, limit ORDER (session, loss, wager), one limitReached per block, interval cleanup.
'use strict';

const { defineFeature, mount, useFakeClock } = require('./harness');

const SessionLimits = defineFeature('session-limits.js');

useFakeClock();

describe('Session Limits', () => {
  test('module shape and metadata (and the server-side counterpart is documented)', () => {
    const mod = require('../../../../private/xgenia-pro-nodes/src/slot-games/features/session-limits.js');
    expect(Object.keys(mod)).toEqual(['node']);
    expect(mod.node.name).toBe('Session Limits');
    expect(mod.node.category).toBe('Utilities');
    expect(mod.node.docs).toBe('https://docsapp.xgenia.com/nodes/slot-features/session-limits');
    expect(mod.node.description).toMatch(/rg_check_bet/);
    expect(mod.node.description).toMatch(/server-side/);
    const inputs = Object.keys(SessionLimits.metadata.inputs).filter((n) => n !== 'functionScript');
    expect(inputs.sort()).toEqual(
      ['maxSessionMinutes', 'maxLoss', 'maxWager', 'start', 'reset', 'bet', 'win', 'betPlaced', 'winPaid'].sort()
    );
    expect(Object.keys(SessionLimits.metadata.outputs).sort()).toEqual(
      ['limitReached', 'limitType', 'blocked', 'remainingMinutes', 'remainingLoss', 'remainingWager'].sort()
    );
    expect(SessionLimits.metadata.outputs.limitReached.type).toBe('signal');
  });

  test('all limits off: remaining outputs are -1, nothing ever blocks', async () => {
    const h = await mount(SessionLimits, {});
    h.fire('start');
    expect(h.out('remainingMinutes')).toBe(-1);
    expect(h.out('remainingLoss')).toBe(-1);
    expect(h.out('remainingWager')).toBe(-1);
    h.set('bet', 1000000);
    h.fire('betPlaced');
    h.advance(3600000);
    expect(h.out('blocked')).toBe(false);
    expect(h.count('limitReached')).toBe(0);
  });

  test('wager limit: remainingWager counts down, blocks once at the limit', async () => {
    const h = await mount(SessionLimits, { maxWager: 300 });
    h.fire('start');
    expect(h.out('remainingWager')).toBe(300);
    h.set('bet', 100);
    h.fire('betPlaced');
    h.fire('betPlaced');
    expect(h.out('remainingWager')).toBe(100);
    expect(h.out('blocked')).toBe(false);
    h.fire('betPlaced');
    expect(h.out('remainingWager')).toBe(0);
    expect(h.out('blocked')).toBe(true);
    expect(h.out('limitType')).toBe('wager');
    expect(h.count('limitReached')).toBe(1);
    h.fire('betPlaced'); // still blocked, no second signal
    expect(h.count('limitReached')).toBe(1);
    expect(h.out('remainingWager')).toBe(0);
  });

  test('loss limit: loss = bets - wins; wins restore allowance', async () => {
    const h = await mount(SessionLimits, { maxLoss: 150 });
    h.fire('start');
    h.set('bet', 100);
    h.set('win', 50);
    h.fire('betPlaced');
    expect(h.out('remainingLoss')).toBe(50);
    h.fire('winPaid');
    expect(h.out('remainingLoss')).toBe(100);
    h.fire('betPlaced');
    expect(h.out('remainingLoss')).toBe(0);
    expect(h.out('blocked')).toBe(true);
    expect(h.out('limitType')).toBe('loss');
    expect(h.count('limitReached')).toBe(1);
  });

  test('session limit: remainingMinutes counts down each minute and blocks at zero', async () => {
    const h = await mount(SessionLimits, { maxSessionMinutes: 2 });
    h.fire('start');
    expect(h.out('remainingMinutes')).toBe(2);
    h.advance(60000);
    expect(h.out('remainingMinutes')).toBe(1);
    h.advance(59000);
    expect(h.out('remainingMinutes')).toBe(1);
    expect(h.out('blocked')).toBe(false);
    h.advance(1000);
    expect(h.out('remainingMinutes')).toBe(0);
    expect(h.out('blocked')).toBe(true);
    expect(h.out('limitType')).toBe('session');
    expect(h.count('limitReached')).toBe(1);
  });

  test('the session limit needs start; loss and wager limits count without it', async () => {
    const h = await mount(SessionLimits, { maxSessionMinutes: 1, maxWager: 100 });
    h.advance(120000);
    expect(h.out('blocked')).toBe(false);
    expect(h.out('remainingMinutes')).toBe(1); // clock not running
    h.set('bet', 100);
    h.fire('betPlaced');
    expect(h.out('limitType')).toBe('wager');
  });

  test('order: loss beats wager when both are hit on the same bet', async () => {
    const h = await mount(SessionLimits, { maxLoss: 100, maxWager: 100 });
    h.fire('start');
    h.set('bet', 100);
    h.fire('betPlaced');
    expect(h.out('limitType')).toBe('loss');
  });

  test('reset clears blocked, zeroes the counters and lets limitReached fire again', async () => {
    const h = await mount(SessionLimits, { maxWager: 100 });
    h.fire('start');
    h.set('bet', 100);
    h.fire('betPlaced');
    expect(h.out('blocked')).toBe(true);
    h.fire('reset');
    expect(h.out('blocked')).toBe(false);
    expect(h.out('limitType')).toBe('');
    expect(h.out('remainingWager')).toBe(100);
    h.fire('betPlaced');
    expect(h.out('blocked')).toBe(true);
    expect(h.count('limitReached')).toBe(2);
  });

  test('changing a limit while running re-evaluates immediately', async () => {
    const h = await mount(SessionLimits, {});
    h.fire('start');
    h.set('bet', 500);
    h.fire('betPlaced');
    expect(h.out('blocked')).toBe(false);
    h.set('maxWager', 400);
    expect(h.out('remainingWager')).toBe(0);
    expect(h.out('blocked')).toBe(true);
    expect(h.out('limitType')).toBe('wager');
  });

  test('deleting the node clears the interval (dispose path)', async () => {
    const h = await mount(SessionLimits, { maxSessionMinutes: 1 });
    h.fire('start');
    expect(jest.getTimerCount()).toBe(1);
    h.dispose();
    expect(jest.getTimerCount()).toBe(0);
    h.advance(120000);
    expect(h.count('limitReached')).toBe(0);
  });

  test('getInspectInfo reports the block', async () => {
    const h = await mount(SessionLimits, { maxWager: 10 });
    expect(h.node.getInspectInfo()).toMatch(/Not started/);
    h.fire('start');
    h.set('bet', 10);
    h.fire('betPlaced');
    expect(h.node.getInspectInfo()).toMatch(/BLOCKED \(wager\)/);
  });
});
