// ─────────────────────────────────────────────────────────────────────────────
// A RUNAWAY SIGNAL LOOP RAN FOR 28 MINUTES AND THE ENGINE NEVER MENTIONED IT
// (export 1789727384756, 2026-09-18)
//
// A page wired maths.CascadeSettled → Counter.reset → countChanged → Expression →
// maths.CascadeNext → … → CascadeSettled. It started itself at mount, with no click,
// and ran about 184 passes a second for 28 minutes: a bet billed on every pass
// (balance −259,791), the renderer main thread busy enough that every executeCode
// bridge call timed out, and the session spent diagnosing "the editor's eval bridge
// died". Every symptom the operator could see pointed away from the cause.
//
// WHAT THIS DOES AND DOES NOT DETECT — measured, not assumed:
//   · It is NOT frame saturation. updateDirtyNodes caps at 10 iterations, and a probe
//     of a two-node signal cycle showed the engine's edge semantics settle it inside
//     one frame. The real loop did ~3 passes per frame and converged every frame; a
//     saturation check would never have fired.
//   · It IS emission rate on a single output. The loop pushed one output far past any
//     rate a frame-driven emitter can reach. A per-frame ticker tops out around 60/s;
//     rate a frame-driven emitter can reach. A 120Hz ProMotion display lets a legitimate
//     per-frame emitter reach 120/s, so the threshold sits just above it at 150/s sustained
//     for 3 consecutive seconds; the export's 184/s trips it.
//   · A SLOW self-sustaining loop is NOT caught here: a probe of a real Counter→Expression
//     accumulator ran at ~15 passes/s. Rate is the last net; the shape is caught statically
//     and the billing rate is caught in Spin Calculate.
//
// It REPORTS and never halts: the threshold is a judgement about rates, and freezing a
// live player's game on a judgement is not a trade this engine should make on its own.
// The report goes to the console AND to the editor's warning channel — a different
// transport from executeCode, which is precisely what stops answering during a runaway.
// ─────────────────────────────────────────────────────────────────────────────
const NodeContext = require('../src/nodecontext');
const NodeDefinition = require('../src/nodedefinition');
const ComponentInstance = require('../src/nodes/componentinstance');
const ComponentModel = require('../src/models/componentmodel');

function fakeEditorConnection() {
  return {
    on() {},
    isConnected: () => true,
    sendWarning: jest.fn(),
    clearWarning: jest.fn(),
    sendPulsingConnections() {},
  };
}

/** One node with one signal output, so a test can drive its emission rate by hand. */
async function emitterGraph({ editorConnection } = {}) {
  const Pulse = NodeDefinition.defineNode({
    name: 'Pulse',
    category: 't',
    inputs: {},
    outputs: { tick: { type: 'signal' } },
  });
  const ctx = new NodeContext(editorConnection ? { editorConnection } : undefined);
  ctx.nodeRegister.register(Pulse);
  const model = await ComponentModel.createFromExportData({
    name: 'Start Page',
    id: '1',
    nodes: [{ id: 'CompleteCheck', type: 'Pulse' }],
    connections: [],
  });
  const inst = new ComponentInstance(ctx);
  await inst.setComponentModel(model);
  return { ctx, node: inst.nodeScope.getNodeWithId('CompleteCheck') };
}

/** Emit `count` signals spaced `stepMs` apart on a clock the test owns. */
function emit(node, count, stepMs, clock) {
  for (let i = 0; i < count; i++) {
    clock.t += stepMs;
    node.sendSignalOnOutput('tick');
  }
}

const runawayErrors = (spy) => spy.mock.calls.filter((c) => /runaway/i.test(String(c[0])));

describe('an output driven far past any frame-driven rate is reported', () => {
  let err;
  let clock;

  beforeEach(() => {
    clock = { t: 1_000_000 };
    jest.spyOn(Date, 'now').mockImplementation(() => clock.t);
    err = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  test('a 60fps per-frame emitter runs for ten seconds and is never reported', async () => {
    const { node } = await emitterGraph();
    emit(node, 600, 17, clock); // ≈58.8/s
    expect(runawayErrors(err)).toHaveLength(0);
  });

  test('a 120Hz ProMotion per-frame emitter is also never reported — the display sets the legit ceiling', async () => {
    const { node } = await emitterGraph();
    emit(node, 1200, 8, clock); // 125/s for ~10s
    expect(runawayErrors(err)).toHaveLength(0);
  });

  test('a two-second burst at 200/s is tolerated — a burst is not a runaway', async () => {
    const { node } = await emitterGraph();
    emit(node, 400, 5, clock);
    expect(runawayErrors(err)).toHaveLength(0);
  });

  test('200/s sustained past three seconds is reported once, naming the node, the port and the rate', async () => {
    const { node } = await emitterGraph();
    emit(node, 800, 5, clock); // 4 seconds
    const errors = runawayErrors(err);
    expect(errors).toHaveLength(1);
    const msg = String(errors[0][0]);
    expect(msg).toMatch(/CompleteCheck/);
    expect(msg).toMatch(/tick/);
    expect(msg).toMatch(/Pulse/);
    expect(msg).toMatch(/\b19\d|\b20\d/); // the measured per-second rate, ~200
    expect(msg).toMatch(/no user input|by itself|re-?trigger/i);
  });

  test('a sustained runaway repeats its report on a slow cadence, not on every signal', async () => {
    const { node } = await emitterGraph();
    emit(node, 6000, 5, clock); // 30 seconds at 200/s
    const n = runawayErrors(err).length;
    expect(n).toBeGreaterThanOrEqual(2);
    expect(n).toBeLessThanOrEqual(8);
  });

  test('a rate that falls back to normal clears the run, and a later burst starts a fresh count', async () => {
    const { node } = await emitterGraph();
    emit(node, 400, 5, clock); // 2s hot — not yet reported
    emit(node, 600, 17, clock); // 10s normal — clears the run
    expect(runawayErrors(err)).toHaveLength(0);
    emit(node, 400, 5, clock); // 2s hot again — still under the sustained threshold
    expect(runawayErrors(err)).toHaveLength(0);
  });

  // The numbers this guard exists for, replayed. 209,490 bets were billed between two
  // screenshots 19 minutes apart (balance −8,751 → −218,241) = 184 passes a second.
  test("the export's own measured rate, 184/s, is caught — and 60/s and 100/s are not", async () => {
    const hot = await emitterGraph();
    emit(hot.node, 184 * 6, Math.round(1000 / 184), clock); // 6 seconds at the real rate
    expect(runawayErrors(err)).toHaveLength(1);
    expect(hot.ctx.getSignalRateState().hottest.perSecond).toBeGreaterThanOrEqual(150);

    err.mockClear();
    const warm = await emitterGraph();
    emit(warm.node, 125 * 10, 8, clock); // 10 seconds at 125/s — a 120Hz ticker, still quiet
    expect(runawayErrors(err)).toHaveLength(0);
  });

  test('the whole guard is off the hot path until a window closes: emitting stays cheap', async () => {
    const { ctx, node } = await emitterGraph();
    emit(node, 100, 5, clock);
    // Under a second: no window has closed, so nothing has been judged yet.
    expect(ctx.getSignalRateState().hottest).toBeNull();
  });
});

describe('the report reaches the editor over the warning channel, which the eval bridge cannot block', () => {
  let err;
  let clock;

  beforeEach(() => {
    clock = { t: 1_000_000 };
    jest.spyOn(Date, 'now').mockImplementation(() => clock.t);
    err = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  test('with an editor attached the offending node gets a warning naming the loop', async () => {
    const editorConnection = fakeEditorConnection();
    const { node } = await emitterGraph({ editorConnection });
    emit(node, 800, 5, clock);
    expect(editorConnection.sendWarning).toHaveBeenCalled();
    const [componentName, nodeId, key, warning] = editorConnection.sendWarning.mock.calls[0];
    expect(nodeId).toBe('CompleteCheck');
    expect(String(key)).toMatch(/runaway/i);
    expect(String(warning.message)).toMatch(/CompleteCheck|tick/);
    expect(typeof componentName).toBe('string');
  });

  test('with no editor attached it still reports to the console and never throws', async () => {
    const { node } = await emitterGraph();
    expect(() => emit(node, 800, 5, clock)).not.toThrow();
    expect(runawayErrors(err).length).toBeGreaterThanOrEqual(1);
  });

  test('the state is readable for tools: the hottest output is named with its rate', async () => {
    const { ctx, node } = await emitterGraph();
    emit(node, 800, 5, clock);
    const state = ctx.getSignalRateState();
    expect(state.hottest.nodeId).toBe('CompleteCheck');
    expect(state.hottest.port).toBe('tick');
    expect(state.hottest.perSecond).toBeGreaterThan(150);
    expect(state.hottest.sustainedSeconds).toBeGreaterThanOrEqual(3);
  });
});

// ── the same guard, reached through a REAL node graph ────────────────────────
// Everything above drives one output by hand. This wires the engine's own Counter and
// Expression into the accumulator shape the export used — Counter.increase →
// countChanged → Expression.run → isTrueEv → Counter.increase — and lets it run itself.
// It is the shape the AI built, minus the reset that re-armed it (counter.js no longer
// emits countChanged for a reset that changes nothing, so the export's exact loop is
// already dead; an always-true gate is how the same shape still runs away).
describe('a real self-sustaining node graph trips the guard', () => {
  let err;
  let clock;

  beforeEach(() => {
    clock = { t: 1_000_000 };
    jest.spyOn(Date, 'now').mockImplementation(() => clock.t);
    err = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {}); // Expression narrates every run
  });
  afterEach(() => jest.restoreAllMocks());

  async function accumulatorLoop() {
    const Counter = require('../src/nodes/std-library/counter').node;
    const Expression = require('../src/nodes/std-library/expression').node;
    const ctx = new NodeContext({ platform: { getCurrentTime: () => Date.now() } });
    [Counter, Expression].forEach((d) => ctx.nodeRegister.register(NodeDefinition.defineNode(d)));
    const model = await ComponentModel.createFromExportData({
      name: 'Start Page',
      id: '1',
      nodes: [
        { id: 'CompletionsCounter', type: 'Counter', parameters: { startValue: 0 } },
        { id: 'CompleteCheck', type: 'Expression', parameters: { expression: 'count >= 0' } },
      ],
      connections: [
        { sourceId: 'CompletionsCounter', sourcePort: 'countChanged', targetId: 'CompleteCheck', targetPort: 'run' },
        { sourceId: 'CompletionsCounter', sourcePort: 'currentCount', targetId: 'CompleteCheck', targetPort: 'count' },
        { sourceId: 'CompleteCheck', sourcePort: 'isTrueEv', targetId: 'CompletionsCounter', targetPort: 'increase' },
      ],
    });
    const inst = new ComponentInstance(ctx);
    await inst.setComponentModel(model);
    return { ctx, inst };
  }

  // MEASURED, and not what I first assumed: this two-node accumulator does NOT run
  // forever. It completes 50 passes inside the mount cascade and settles — the engine
  // damps a loop this tight. The export's loop sustained because each pass crossed the
  // page↔maths component boundary, which spreads it over frames. So the claim this test
  // makes is the one it can actually support: signals produced by REAL nodes through REAL
  // connections are measured and attributed to the right node, not just hand-driven ones.
  test('signals from real wired nodes are measured and attributed to the right node', async () => {
    const { ctx, inst } = await accumulatorLoop();
    const counter = inst.nodeScope.getNodeWithId('CompletionsCounter');

    // Re-trigger each tick, standing in for the frame-crossing loop the export had.
    for (let i = 0; i < 1000; i++) {
      clock.t += 5; // 200 signals/second over 5 virtual seconds
      counter.queueInput('increase', true);
      ctx.update();
      counter.queueInput('increase', false);
      ctx.update();
    }

    const errors = runawayErrors(err);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(String(errors[0][0])).toMatch(/CompletionsCounter|CompleteCheck/);

    const hottest = ctx.getSignalRateState().hottest;
    expect(['CompletionsCounter', 'CompleteCheck']).toContain(hottest.nodeId);
    expect(hottest.perSecond).toBeGreaterThan(150);
    expect(counter._internal.currentValue).toBeGreaterThan(100);
  });

  test('a tight two-node accumulator settles by itself — the engine damps it, so it is not this guard\'s case', async () => {
    const { ctx, inst } = await accumulatorLoop();
    for (let i = 0; i < 4000; i++) { clock.t += 1; ctx.update(); }
    // 50 passes during mount, then nothing: no runaway to report.
    expect(inst.nodeScope.getNodeWithId('CompletionsCounter')._internal.currentValue).toBeLessThan(100);
    expect(runawayErrors(err)).toHaveLength(0);
  });

  test("the export's own gate is already dead: a reset that changes nothing re-arms nothing", async () => {
    // count % 5 == 0 is true at 0, which is what made the export's loop restart on every
    // reset. With counter.js fixed, a reset at the start value emits no countChanged, so
    // this same wiring runs one pass and stops.
    const Counter = require('../src/nodes/std-library/counter').node;
    const Expression = require('../src/nodes/std-library/expression').node;
    const ctx = new NodeContext({ platform: { getCurrentTime: () => Date.now() } });
    [Counter, Expression].forEach((d) => ctx.nodeRegister.register(NodeDefinition.defineNode(d)));
    const model = await ComponentModel.createFromExportData({
      name: 'Start Page', id: '1',
      nodes: [
        { id: 'CompletionsCounter', type: 'Counter', parameters: { startValue: 0 } },
        { id: 'CompleteCheck', type: 'Expression', parameters: { expression: 'count % 5 == 0' } },
      ],
      connections: [
        { sourceId: 'CompletionsCounter', sourcePort: 'countChanged', targetId: 'CompleteCheck', targetPort: 'run' },
        { sourceId: 'CompletionsCounter', sourcePort: 'currentCount', targetId: 'CompleteCheck', targetPort: 'count' },
        { sourceId: 'CompleteCheck', sourcePort: 'isTrueEv', targetId: 'CompletionsCounter', targetPort: 'reset' },
      ],
    });
    const inst = new ComponentInstance(ctx);
    await inst.setComponentModel(model);
    for (let i = 0; i < 500; i++) { clock.t += 1; ctx.update(); }
    expect(runawayErrors(err)).toHaveLength(0);
    expect(ctx.getSignalRateState().hottest).toBeNull();
  });
});
