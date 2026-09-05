// ─────────────────────────────────────────────────────────────────────────────
// INVARIANT — A STATE SLOT CAN BE SEEDED WITHOUT USING ITS INPUT
//
// Debug export 1788537867593 ("Heist Drive", 2026-09-04). The build's GameState was a
// stateManager holding capital/totalBets/totalWinnings/spinCount/hits, wired in the canonical
// accumulator shape:
//
//     GameState.output0    -> SpinCalc.capital      (read the running balance)
//     SpinCalc.capital     -> GameState.input0      (write it back)
//
// The starting balance of 1000 was typed as a static parameter on input0. It never existed: a
// static input value is SHADOWED the moment a wire drives that input. So output0 read 0, the
// first spin took capital to -1, and the session spent ~25 tool calls trying to seed it —
//
//   • set input0 = 1000 statically            → shadowed by the write-back wire
//   • wire a constant into input0             → "Fan-in blocked: input0 already has 1 incoming"
//   • delete the write-back, seed, re-add     → the accumulator stops accumulating
//   • wire init -> GameState.reset            → reset NULLS the state (capital 0 -> -1 again)
//   • a CapitalMerge JS node in front         → merge echoes output0, SpinCalc's result never lands
//   • hardcode 1000 in SpinCalc's script      → rejected by the edit reviewer, correctly
//
// — and ended with the balance still wrong. Every one of those is a way of trying to put a seed
// on a single-writer input. The seed does not belong there.
//
// `initialValues` writes the OUTPUT side: at start, and again after a reset clears it. A wire on
// the input cannot shadow it, fan-in cannot block it, and reset returns to it instead of to null.
// ─────────────────────────────────────────────────────────────────────────────
const NodeContext = require('../src/nodecontext');
const ComponentInstance = require('../src/nodes/componentinstance');
const ComponentModel = require('../src/models/componentmodel');
const NodeDefinition = require('../src/nodedefinition');
// The std-library module exports { node, setup }; the register wants a NodeDefinition.
const StateManagerNode = NodeDefinition.defineNode(require('../src/nodes/std-library/stateManager').node);

/**
 * Stand up a real stateManager in a real node context, with `parameters` applied the way the
 * editor applies them (as input values), and hand back a small probe.
 */
async function createStateManager(parameters) {
  const ctx = new NodeContext();
  ctx.nodeRegister.register(StateManagerNode);
  const model = await ComponentModel.createFromExportData({
    name: 'c', id: '1',
    nodes: [{ id: 'SM', type: 'stateManager', parameters }],
    connections: [],
  });
  const inst = new ComponentInstance(ctx);
  await inst.setComponentModel(model);
  ctx.update();
  const sm = inst.nodeScope.getNodeWithId('SM');
  // input0…/output0… are registered ON DEMAND (registerInputIfNeeded / registerOutputIfNeeded),
  // which the runtime triggers when a wire targets them. This graph has no wires, so the probe
  // registers the slots the same way before touching them.
  const slots = Math.max(0, Math.floor((parameters && parameters.numInputs) || 3));
  for (let i = 0; i < slots; i++) {
    sm.registerInputIfNeeded('input' + i);
    sm.registerOutputIfNeeded('output' + i);
  }
  return {
    node: sm,
    // getOutput() returns the port DEFINITION; the value comes from its getter.
    getOutput: (name) => {
      const def = sm.getOutput(name);
      return def && typeof def.getter === 'function' ? def.getter.call(sm) : undefined;
    },
    setInput: (name, value) => { sm.queueInput(name, value); ctx.update(); },
    fire: (signal) => { sm.queueInput(signal, true); ctx.update(); },
  };
}

describe('stateManager initialValues', () => {
  test('output0 carries the seed before any update has run', async () => {
    const sm = await createStateManager({ numInputs: 1, initialValues: { input0: 1000 } });
    expect(sm.getOutput('output0')).toBe(1000);
  });

  test('a wired input wins once it is driven and committed', async () => {
    const sm = await createStateManager({ numInputs: 1, initialValues: { input0: 1000 } });
    sm.setInput('input0', 999);
    sm.fire('update');
    expect(sm.getOutput('output0')).toBe(999);
  });

  test('reset returns to the seed, not to null — this is what made the reset workaround fail', async () => {
    const sm = await createStateManager({ numInputs: 1, initialValues: { input0: 1000 } });
    sm.setInput('input0', 999);
    sm.fire('update');
    expect(sm.getOutput('output0')).toBe(999);
    sm.fire('reset');
    expect(sm.getOutput('output0')).toBe(1000);
  });

  test('seeds by ALIAS as well as by slot name', async () => {
    const sm = await createStateManager({ numInputs: 1, alias0: 'capital', initialValues: { capital: 1000 } });
    expect(sm.getOutput('output0')).toBe(1000);
  });

  test('accepts a JSON string (the shape a tool call carries)', async () => {
    const sm = await createStateManager({ numInputs: 1, alias0: 'capital', initialValues: '{"capital":1000}' });
    expect(sm.getOutput('output0')).toBe(1000);
  });

  test('seeds only the slots it names — the others stay untouched', async () => {
    const sm = await createStateManager({ numInputs: 3, initialValues: { input1: 7 } });
    expect(sm.getOutput('output0')).toBeUndefined();
    expect(sm.getOutput('output1')).toBe(7);
    expect(sm.getOutput('output2')).toBeUndefined();
  });

  test('no initialValues → unchanged behaviour (the pre-2026-09-04 default)', async () => {
    const sm = await createStateManager({ numInputs: 1 });
    expect(sm.getOutput('output0')).toBeUndefined();
    sm.setInput('input0', 5);
    sm.fire('update');
    expect(sm.getOutput('output0')).toBe(5);
  });

  test('a malformed initialValues is ignored rather than thrown', async () => {
    const sm = await createStateManager({ numInputs: 1, initialValues: 'not json' });
    expect(sm.getOutput('output0')).toBeUndefined();
  });

  test('the seed survives the accumulator shape: read output0, write input0, update', async () => {
    // The exact Heist Drive loop, without the wires: read the balance, spend 1, commit.
    const sm = await createStateManager({ numInputs: 1, alias0: 'capital', initialValues: { capital: 1000 } });
    const before = sm.getOutput('output0');
    expect(before).toBe(1000);
    sm.setInput('input0', before - 1);
    sm.fire('update');
    expect(sm.getOutput('output0')).toBe(999);   // not -1, which is what shipped
  });
});
