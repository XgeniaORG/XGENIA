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
