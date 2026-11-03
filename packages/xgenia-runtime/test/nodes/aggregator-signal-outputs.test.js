const AggregatorModule = require('../../src/nodes/std-library/data/aggregatornode');
const AggregatorNode = AggregatorModule.node;

// (2026-10-05, leprechaun-cluster.vercel.app) A published game's maths component is replaced by an
// Aggregator. Its SIGNAL outputs (Done, BonusTriggered) used to all ride the Aggregator's `success`,
// so every one fired on every 2xx from any trigger: the bonus popup opened on the page's init call.
// They are now signal ports listed in `signalOutputs`, fired when the response says true — after the
// data outputs — and, for a script that does not report them at all (an older compiler), on a 2xx.

function makeAggregator({ outputs, signalOutputs }) {
  const registered = new Set(['success', 'failure']);
  const events = [];
  const ctx = {
    _internal: {},
    hasOutput: (name) => registered.has(name),
    registerOutput: (name) => registered.add(name),
    flagOutputDirty: (name) => events.push(['value', name]),
    sendSignalOnOutput: (name) => events.push(['signal', name]),
  };
  AggregatorNode.initialize.call(ctx);
  for (const [k, f] of Object.entries(AggregatorNode.methods)) ctx[k] = f.bind(ctx);
  AggregatorNode.inputs.outputs.set.call(ctx, outputs);
  AggregatorNode.inputs.signalOutputs.set.call(ctx, signalOutputs);
  return { ctx, events };
}

describe('Aggregator signal outputs', () => {
  test('a signal fires only when the response says true, after the data outputs', () => {
    const { ctx, events } = makeAggregator({ outputs: 'capital, spinWinnings, SpinDone, BonusTriggered', signalOutputs: 'SpinDone, BonusTriggered' });
    ctx.applyOutputs({ capital: 990, spinWinnings: 0, SpinDone: true, BonusTriggered: false }, true);
    expect(events).toEqual([['value', 'out-capital'], ['value', 'out-spinWinnings'], ['signal', 'out-SpinDone']]);
    // a signal never becomes a value a reader could hold on to
    expect(ctx.getOutputValue('BonusTriggered')).toBeUndefined();
  });

  test('the same signal fires again on the next response (a value that stayed true could fire once)', () => {
    const { ctx, events } = makeAggregator({ outputs: 'SpinDone', signalOutputs: 'SpinDone' });
    ctx.applyOutputs({ SpinDone: true }, true);
    ctx.applyOutputs({ SpinDone: true }, true);
    expect(events.filter((e) => e[0] === 'signal')).toHaveLength(2);
  });

  test('init call: BonusTriggered false does not open the bonus', () => {
    const { ctx, events } = makeAggregator({ outputs: 'capital, BonusTriggered', signalOutputs: 'BonusTriggered' });
    ctx.applyOutputs({ capital: 1000, BonusTriggered: false }, true);
    expect(events).toEqual([['value', 'out-capital']]);
  });

  test('an older script that never reports a signal: it fires on a 2xx, not on a refusal', () => {
    const { ctx, events } = makeAggregator({ outputs: 'capital, Done', signalOutputs: 'Done' });
    ctx.applyOutputs({ capital: 5 }, true);
    expect(events).toContainEqual(['signal', 'out-Done']);
    events.length = 0;
    ctx.applyOutputs({ error: 'Bet outside allowed range', code: 'INVALID_GAME_ACTION' }, false);
    expect(events.filter((e) => e[0] === 'signal')).toEqual([]);
  });

  test('ports: a listed signal output is a signal port, the rest stay values', () => {
    const ports = AggregatorModule.buildPorts({ outputs: 'capital, SpinDone', signalOutputs: 'SpinDone' });
    const byName = Object.fromEntries(ports.map((p) => [p.name, p.type]));
    expect(byName['out-SpinDone']).toBe('signal');
    expect(byName['out-capital']).toEqual({ name: '*', allowConnectionsOnly: true });
  });
});

// (2026-11-02) A published demo plays its rounds on the RGS: the RGS's wallet balance and paid win are what the
// screen shows, a request that never answers fails instead of spinning forever, and a duplicated request carries
// the same idempotency key so it is never charged twice.
describe('Aggregator and the RGS', () => {
  test('the RGS round record becomes rgsBalance / rgsWin / rgsRoundId outputs, not an out-__rgs object', () => {
    const { ctx, events } = makeAggregator({ outputs: 'winAmount', signalOutputs: '' });
    ctx.applyOutputs({ winAmount: 300, __rgs: { round_id: 'r1', bet_amount: 200, win_amount: 300, balance_after: 1000100 } }, true);
    expect(ctx.getOutputValue('rgsBalance')).toBe(1000100);
    expect(ctx.getOutputValue('rgsWin')).toBe(300);
    expect(ctx.getOutputValue('rgsRoundId')).toBe('r1');
    expect(events.map((e) => e[1])).not.toContain('out-__rgs');
  });

  // (2026-11-03) A Math Component declares an rgsBalance output so its game can show the RGS wallet; the maths
  // cannot see the wallet, so its response carries that field empty. The RGS's figure must win.
  test('a maths output named rgsBalance is filled by the RGS, never blanked by the maths\' own empty value', () => {
    const { ctx } = makeAggregator({ outputs: 'winAmount, rgsBalance', signalOutputs: '' });
    ctx.applyOutputs({ winAmount: 300, rgsBalance: null, __rgs: { round_id: 'r1', win_amount: 300, balance_after: 1000100 } }, true);
    expect(ctx.getOutputValue('rgsBalance')).toBe(1000100);
    const names = AggregatorModule.buildPorts({ outputs: 'winAmount, rgsBalance', signalOutputs: '' }).map((p) => p.name);
    expect(names.filter((n) => n === 'out-rgsBalance')).toHaveLength(1);
    // Without a round record (an unstaked call) the maths' own value is all there is.
    ctx.applyOutputs({ winAmount: 0, rgsBalance: 5 }, true);
    expect(ctx.getOutputValue('rgsBalance')).toBe(5);
  });

  test('ports: RGS outputs and Error are always offered', () => {
    const names = AggregatorModule.buildPorts({ outputs: 'winAmount', signalOutputs: '' }).map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(['out-rgsBalance', 'out-rgsWin', 'out-rgsRoundId', 'out-error']));
  });

  test('every request carries its own idempotency key; a refusal reports why', async () => {
    const { ctx, events } = makeAggregator({ outputs: 'winAmount', signalOutputs: '' });
    const bodies = [];
    global.fetch = jest.fn(async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return { ok: false, status: 409, json: async () => ({ error: 'Bet outside allowed range' }) };
    });
    ctx.doSend();
    ctx.doSend();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(bodies).toHaveLength(2);
    expect(bodies[0].__idempotency).toBeTruthy();
    expect(bodies[0].__idempotency).not.toBe(bodies[1].__idempotency);
    expect(ctx.getOutputValue('error')).toBe('Bet outside allowed range');
    expect(events).toContainEqual(['signal', 'failure']);
    delete global.fetch;
  });

  test('a request with no answer fails after the timeout instead of waiting forever', async () => {
    jest.useFakeTimers({ doNotFake: ['performance'] }); // Node 22's performance is read-only (see slot-features/harness.js)
    const { ctx, events } = makeAggregator({ outputs: 'winAmount', signalOutputs: '' });
    global.fetch = jest.fn((_url, init) => new Promise((_res, rej) => {
      init.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); });
    }));
    ctx.doSend();
    jest.advanceTimersByTime(10000);
    jest.useRealTimers();
    await new Promise((r) => setTimeout(r, 0));
    expect(events).toContainEqual(['signal', 'failure']);
    expect(ctx.getOutputValue('error')).toMatch(/No answer within 10 s/);
    delete global.fetch;
  });
});

// (2026-11-03, lobby-rgs-plinko.vercel.app) The RGS ledger counts cents; a game graph counts money. A plinko sent a
// 1.00 bet as 1 (booked as one cent) and its 1.08× win came back as 1. Publish now gives the Aggregator a money
// scale for a script that converts: the bet goes out in cents with __moneyScale, the win and the RGS money come back
// in the game's money — but only from a response that says it converted.
describe('Aggregator money in cents', () => {
  function moneyAggregator() {
    const made = makeAggregator({ outputs: 'spinWinnings, winAmount', signalOutputs: '' });
    AggregatorNode.inputs.moneyScale.set.call(made.ctx, 100);
    AggregatorNode.inputs.betField.set.call(made.ctx, 'BetAmount');
    AggregatorNode.inputs.winField.set.call(made.ctx, 'spinWinnings');
    return made;
  }

  test('the bet goes out in whole cents, with the scale', async () => {
    const { ctx } = moneyAggregator();
    const bodies = [];
    global.fetch = jest.fn(async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({}) };
    });
    ctx.setDataValue('BetAmount', 0.2);
    ctx.setDataValue('Risk', 2);
    ctx.doSend();
    ctx.setDataValue('BetAmount', '1.10');
    ctx.doSend();
    await new Promise((r) => setTimeout(r, 0));
    expect(bodies[0]).toMatchObject({ BetAmount: 20, Risk: 2, __moneyScale: 100 });
    expect(bodies[1]).toMatchObject({ BetAmount: 110, __moneyScale: 100 });
    delete global.fetch;
  });

  test('the win port and the RGS money come back in the game money; other outputs are left alone', () => {
    const { ctx, events } = moneyAggregator();
    ctx.applyOutputs({ spinWinnings: 108, winAmount: 1.08, __moneyScale: 100, __rgs: { round_id: 'r1', win_amount: 108, balance_after: 1000008 } }, true);
    expect(ctx.getOutputValue('spinWinnings')).toBe(1.08);
    expect(ctx.getOutputValue('winAmount')).toBe(1.08);
    expect(ctx.getOutputValue('rgsWin')).toBe(1.08);
    expect(ctx.getOutputValue('rgsBalance')).toBe(10000.08);
    expect(events.map((e) => e[1])).not.toContain('out-__moneyScale');
  });

  test('a response that did not convert (a script deployed before it could) is taken as it is', () => {
    const { ctx } = moneyAggregator();
    ctx.applyOutputs({ spinWinnings: 108, __rgs: { win_amount: 108, balance_after: 1000008 } }, true);
    expect(ctx.getOutputValue('spinWinnings')).toBe(108);
    expect(ctx.getOutputValue('rgsBalance')).toBe(1000008);
  });

  test('without a money scale nothing changes', async () => {
    const { ctx } = makeAggregator({ outputs: 'spinWinnings', signalOutputs: '' });
    const bodies = [];
    global.fetch = jest.fn(async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({}) };
    });
    ctx.setDataValue('BetAmount', 1);
    ctx.doSend();
    await new Promise((r) => setTimeout(r, 0));
    expect(bodies[0].BetAmount).toBe(1);
    expect(bodies[0].__moneyScale).toBeUndefined();
    delete global.fetch;
  });
});
