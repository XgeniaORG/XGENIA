// ─────────────────────────────────────────────────────────────────────────────
// INVARIANT — SIGNALS QUEUED IN ONE UPDATE ARE PROCESSED IN ARRIVAL ORDER,
//             NOT IN THE ORDER THE NODE'S PORTS WERE FIRST TOUCHED IN ITS LIFETIME
//
// Debug exports 1788472290713 / 1788472577115 ("the reels never stop", 2026-09-03):
//   21:41:59.935  [PixiReelController] stop signal received but not spinning — ignoring
//   21:41:59.935  [PixiReelController] Spin signal received
//   21:42:07.959  Watchdog: column 0 never completed its stop after 8000 ms
// Every spin, all five columns, four spins out of four. `spin` had been queued on the
// controller BEFORE `stop` (fan-out first, then the maths chain pulled through
// _updateDependencies), yet `stop` was processed first and thrown away.
//
// Cause: Node.update iterated `Object.keys(this._inputValuesQueue)`. Keys are created the
// first time a port is ever queued and are never deleted, so that iteration order is the
// order in which the node's ports were FIRST TOUCHED in its lifetime — permanently. In the
// failing project GameInit → maths.Do → … → Done → controller.stop fired at page load, so the
// controller's `stop` key predated its `spin` key forever, and every later spin processed
// `stop` before `spin` regardless of which arrived first. Connection order was irrelevant:
// the probe below wires the controller FIRST in scenario C and still drops the stop.
//
// It also explains an earlier session's finding that the fan-out race did NOT reproduce in
// a different project: that graph never touched `stop` at init. Both observations were
// correct; the variable was port-touch history, which no one had named.
//
// The controller now latches a stop-before-spin (the consumer-side cure). This test holds
// the runtime-side property so no other node with two signal ports inherits the same fate.
// ─────────────────────────────────────────────────────────────────────────────
const NodeContext = require('../src/nodecontext');
const NodeDefinition = require('../src/nodedefinition');
const ComponentInstance = require('../src/nodes/componentinstance');
const ComponentModel = require('../src/models/componentmodel');

async function scenario({ initFirst, connOrder }) {
  const log = [];
  const Trigger = NodeDefinition.defineNode({ name: 'Trigger', category: 't',
    inputs: { fire: { type: 'signal', valueChangedToTrue() { this.sendSignalOnOutput('go'); } },
              init: { type: 'signal', valueChangedToTrue() { this.sendSignalOnOutput('initOut'); } } },
    outputs: { go: { type: 'signal' }, initOut: { type: 'signal' } } });
  // A synchronous "maths": Do → Done in the same update, like the slot maths chain.
  const Maths = NodeDefinition.defineNode({ name: 'Maths', category: 't',
    inputs: { Do: { type: 'signal', valueChangedToTrue() { this.sendSignalOnOutput('Done'); } } },
    outputs: { Done: { type: 'signal' } } });
  const Ctrl = NodeDefinition.defineNode({ name: 'Ctrl', category: 't',
    initialize() { this._spinning = false; },
    inputs: { spin: { type: 'signal', valueChangedToTrue() { log.push('spin'); this._spinning = true; } },
              stop: { type: 'signal', valueChangedToTrue() { log.push(this._spinning ? 'stop:honoured' : 'stop:DROPPED'); this._spinning = false; } } },
    outputs: {} });
  const ctx = new NodeContext();
  [Trigger, Maths, Ctrl].forEach((d) => ctx.nodeRegister.register(d));
  const wires = {
    mathsFirst: [
      { sourceId: 'T', sourcePort: 'go', targetId: 'M', targetPort: 'Do' },
      { sourceId: 'M', sourcePort: 'Done', targetId: 'C', targetPort: 'stop' },
      { sourceId: 'T', sourcePort: 'go', targetId: 'C', targetPort: 'spin' },
      { sourceId: 'T', sourcePort: 'initOut', targetId: 'M', targetPort: 'Do' },
    ],
    ctrlFirst: [
      { sourceId: 'T', sourcePort: 'go', targetId: 'C', targetPort: 'spin' },
      { sourceId: 'T', sourcePort: 'go', targetId: 'M', targetPort: 'Do' },
      { sourceId: 'M', sourcePort: 'Done', targetId: 'C', targetPort: 'stop' },
      { sourceId: 'T', sourcePort: 'initOut', targetId: 'M', targetPort: 'Do' },
    ],
  }[connOrder];
  const model = await ComponentModel.createFromExportData({ name: 'c', id: '1',
    nodes: [{ id: 'T', type: 'Trigger' }, { id: 'M', type: 'Maths' }, { id: 'C', type: 'Ctrl' }], connections: wires });
  const inst = new ComponentInstance(ctx);
  await inst.setComponentModel(model);
  ctx.update();
  const T = inst.nodeScope.getNodeWithId('T');
  if (initFirst) { T.queueInput('init', true); ctx.update(); log.length = 0; }   // init touches Ctrl.stop first
  T.queueInput('fire', true); ctx.update();
  return log;
}

describe('signals queued in one update are processed in arrival order', () => {
  test.each([
    ['A. failing-project shape: maths wired first, stop port touched at init', { initFirst: true,  connOrder: 'mathsFirst' }],
    ['B. maths wired first, stop port never touched before',                    { initFirst: false, connOrder: 'mathsFirst' }],
    ['C. controller wired first, stop port touched at init',                    { initFirst: true,  connOrder: 'ctrlFirst' }],
    ['D. controller wired first, stop port never touched before',              { initFirst: false, connOrder: 'ctrlFirst' }],
  ])('%s → spin lands before the stop it triggered', async (_label, opts) => {
    const log = await scenario(opts);
    expect(log).toEqual(['spin', 'stop:honoured']);
  });

  test('the probe is real: a stop with no spin at all is still dropped (nothing is being masked)', async () => {
    // Guard against a fix that makes every stop "honoured" by accident.
    const log = await scenario({ initFirst: true, connOrder: 'mathsFirst' });
    expect(log).toContain('spin');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WHAT THIS SUITE DELIBERATELY DOES NOT CLAIM
//
// The two scenarios below were derived from production console logs, not from reading the graph.
// That distinction cost something: a static closure over the same project ALSO suggested the
// Timer (@ReturnTimer_1) was reordered by this change, and it is not. The closure followed
// `WinGate.ontrue` and all three mutually-exclusive CharDirector branches as though they always
// fire; `ontrue` is conditional, so `restart` is never queued at page load and arrives several
// drain passes after `stop` on a spin. `stop` is first either way — no reorder.
//
// A static walk of a signal graph cannot see conditional outputs, mutually-exclusive branches, or
// truthiness. Treat its output as candidates to verify, never as findings. Both surviving
// scenarios here are backed by log lines from the export, quoted at each site.
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// THE OTHER EDGE: ARRIVAL ORDER IS CORRECT, AND IT CHANGES BEHAVIOUR THAT WAS
// ACCIDENTALLY RELYING ON THE OLD ORDER. THAT IS NOT ALWAYS AN IMPROVEMENT.
//
// Same export, same root, a different node. @SpinSound receives:
//     SpinHandler.out-goSpin -> play          (queued during the fan-out)
//     EmpireMaths.Done       -> stop          (queued when the synchronous maths finishes)
// and GameInit -> EmpireMaths.Do at page load touched `stop` first, exactly as it did on the
// controller. So:
//     OLD (first-touched): stop (idle, no-op) then play  -> the sound starts and NEVER stops,
//                          because its only stop fires at spin START. Matches the export's
//                          four "Sound is already playing, ignoring play request" lines.
//     NEW (arrival):       play then stop                -> the sound starts and is silenced
//                          in the same update. Effectively no spin sound at all.
//
// Neither is right, because the GRAPH is wrong: a release event is wired to the maths Done,
// which in a synchronous maths chain fires at the START of the spin, not when the reels land.
// The correct source is ReelController.Done / onAllStopped. No scheduler can infer that.
//
// This is pinned, rather than left as a surprise, because it is the honest cost of the fix:
// deploying it will change audible/visible behaviour in any project that was accidentally
// depending on first-touched order. The reels case gets better; this one trades one wrong
// behaviour for another until the graph is rewired.
// ─────────────────────────────────────────────────────────────────────────────
describe('a release event wired to a synchronous maths Done is a graph bug the engine cannot fix', () => {
  async function soundScenario() {
    const log = [];
    const Trigger = NodeDefinition.defineNode({ name: 'Trigger2', category: 't',
      inputs: { init: { type: 'signal', valueChangedToTrue() { this.sendSignalOnOutput('initOut'); } },
                fire: { type: 'signal', valueChangedToTrue() { this.sendSignalOnOutput('go'); } } },
      outputs: { initOut: { type: 'signal' }, go: { type: 'signal' } } });
    const Maths = NodeDefinition.defineNode({ name: 'Maths2', category: 't',
      inputs: { Do:   { type: 'signal', valueChangedToTrue() { this.sendSignalOnOutput('Done'); } },
                Spin: { type: 'signal', valueChangedToTrue() { this.sendSignalOnOutput('Done'); } } },
      outputs: { Done: { type: 'signal' } } });
    const Sound = NodeDefinition.defineNode({ name: 'Sound2', category: 't',
      initialize() { this._playing = false; },
      inputs: { play: { type: 'signal', valueChangedToTrue() { log.push(this._playing ? 'play:rejected' : 'play:started'); this._playing = true; } },
                stop: { type: 'signal', valueChangedToTrue() { log.push(this._playing ? 'stop:silenced' : 'stop:noop'); this._playing = false; } } },
      outputs: {} });
    const ctx = new NodeContext();
    [Trigger, Maths, Sound].forEach((d) => ctx.nodeRegister.register(d));
    const model = await ComponentModel.createFromExportData({ name: 'c', id: '1',
      nodes: [{ id: 'T', type: 'Trigger2' }, { id: 'M', type: 'Maths2' }, { id: 'S', type: 'Sound2' }],
      connections: [
        { sourceId: 'T', sourcePort: 'initOut', targetId: 'M', targetPort: 'Do' },
        { sourceId: 'T', sourcePort: 'go', targetId: 'M', targetPort: 'Spin' },
        { sourceId: 'T', sourcePort: 'go', targetId: 'S', targetPort: 'play' },
        { sourceId: 'M', sourcePort: 'Done', targetId: 'S', targetPort: 'stop' },
      ] });
    const inst = new ComponentInstance(ctx);
    await inst.setComponentModel(model);
    ctx.update();
    const T = inst.nodeScope.getNodeWithId('T');
    T.queueInput('init', true); ctx.update();   // page load touches `stop` first
    log.length = 0;
    T.queueInput('fire', true); ctx.update();
    return log;
  }

  test('play is delivered before the stop that followed it, and the miswired stop silences it', async () => {
    // The ORDER is now correct (play arrived first, so play runs first). The OUTCOME is still
    // wrong, and that is the graph's fault, not the runtime's. Asserting both halves so nobody
    // reads this suite as "the sound is fixed".
    expect(await soundScenario()).toEqual(['play:started', 'stop:silenced']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE STOP SIGNAL MUST NOT OVERTAKE ITS OWN LANDING DATA.
//
// The real controller has FOUR inputs from one spin, not two: `spin` from the button chain, and
// `reelStrips` + `stopPositions` (DATA) plus `Done`→`stop` (SIGNAL) from the maths. Reordering
// signal delivery could plausibly have pushed `stop` ahead of the data it needs, which would
// surface as "[PixiReelColumn] stop applied with NO targetSymbols and NO reelStrip" — reels
// settling on random symbols, a worse bug than not stopping at all.
//
// It does not: flagOutputDirty queues the data before sendSignalOnOutput queues the signal, so
// arrival order preserves data-before-stop. Pinned because it is the specific regression this
// change could have introduced, and because a real export was observed carrying that symptom
// (from a different cause).
// ─────────────────────────────────────────────────────────────────────────────
describe('a stop never arrives before the landing data it needs', () => {
  test('data lands first, and the spin is delivered before the stop', async () => {
    const log = [];
    const Trigger = NodeDefinition.defineNode({ name: 'Trigger3', category: 't',
      inputs: { init: { type: 'signal', valueChangedToTrue() { this.sendSignalOnOutput('initOut'); } },
                fire: { type: 'signal', valueChangedToTrue() { this.sendSignalOnOutput('go'); } } },
      outputs: { initOut: { type: 'signal' }, go: { type: 'signal' } } });
    const Maths = NodeDefinition.defineNode({ name: 'Maths3', category: 't',
      initialize() { this._internal.n = 0; },
      inputs: { Do:   { type: 'signal', valueChangedToTrue() { this._emit(); } },
                Spin: { type: 'signal', valueChangedToTrue() { this._emit(); } } },
      outputs: { reels: { type: 'array', get() { return ['strip' + this._internal.n]; } },
                 stopPositions: { type: 'array', get() { return [this._internal.n]; } },
                 Done: { type: 'signal' } },
      methods: { _emit() { this._internal.n++; this.flagOutputDirty('reels'); this.flagOutputDirty('stopPositions'); this.sendSignalOnOutput('Done'); } } });
    const Ctrl = NodeDefinition.defineNode({ name: 'Ctrl3', category: 't',
      initialize() { this._strips = null; this._stops = null; },
      inputs: { spin: { type: 'signal', valueChangedToTrue() { log.push('spin'); } },
                reelStrips: { type: 'array', set(v) { this._strips = v; } },
                stopPositions: { type: 'array', set(v) { this._stops = v; } },
                stop: { type: 'signal', valueChangedToTrue() { log.push(this._strips && this._stops ? 'stop:hasData' : 'stop:NO_DATA'); } } },
      outputs: {} });
    const ctx = new NodeContext();
    [Trigger, Maths, Ctrl].forEach((d) => ctx.nodeRegister.register(d));
    const model = await ComponentModel.createFromExportData({ name: 'c', id: '1',
      nodes: [{ id: 'T', type: 'Trigger3' }, { id: 'M', type: 'Maths3' }, { id: 'C', type: 'Ctrl3' }],
      connections: [
        { sourceId: 'T', sourcePort: 'initOut', targetId: 'M', targetPort: 'Do' },
        { sourceId: 'M', sourcePort: 'reels', targetId: 'C', targetPort: 'reelStrips' },
        { sourceId: 'M', sourcePort: 'stopPositions', targetId: 'C', targetPort: 'stopPositions' },
        { sourceId: 'M', sourcePort: 'Done', targetId: 'C', targetPort: 'stop' },
        { sourceId: 'T', sourcePort: 'go', targetId: 'M', targetPort: 'Spin' },
        { sourceId: 'T', sourcePort: 'go', targetId: 'C', targetPort: 'spin' },
      ] });
    const inst = new ComponentInstance(ctx);
    await inst.setComponentModel(model);
    ctx.update();
    const T = inst.nodeScope.getNodeWithId('T');
    T.queueInput('init', true); ctx.update();
    log.length = 0;
    T.queueInput('fire', true); ctx.update();
    // Both halves: the spin precedes the stop (the reels fix) AND the stop still has its data.
    expect(log).toEqual(['spin', 'stop:hasData']);
  });
});
