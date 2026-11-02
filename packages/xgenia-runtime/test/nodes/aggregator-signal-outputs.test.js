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
