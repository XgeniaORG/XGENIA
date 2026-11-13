const NodeContext = require('../src/nodecontext');
const NodeDefinition = require('../src/nodedefinition');
const ComponentInstance = require('../src/nodes/componentinstance');
const ComponentModel = require('../src/models/componentmodel');

// Update loops that the editor could not stop — reproduced in the two shapes they take.
//
// Shape 1, "pulled": a loop with a data wire somewhere in it. _updateDependencies pulls the
// upstream node back in synchronously, so the whole cycle spins inside ONE node's update
// until Node.update's maxUpdateIterations cap trips. That cap used to reschedule the node
// for the next frame — every frame, forever. With heavy script nodes in the loop, 100 spins
// is a multi-second frame, and back-to-back multi-second frames are a renderer core pinned
// at 100% and an editor that stops answering. This is the shape in every captured freeze.
//
// Shape 2, "deferred": a two-hop loop where neither step is wired upstream of the other, so
// nothing pulls; each hop lands in the NEXT round of updateDirtyNodes. Every node runs once
// per round, the per-node cap never climbs, updateDirtyNodes truncates at ten rounds and the
// next frame does it all again. The old guard is structurally unable to see this one.
//
// The out-of-band channel in both is NodeContext's globals emitter, which has the same shape
// as the Model 'change' event the viewer's Variable2 / Set Variable nodes use.

// _doUpdate does exactly this per frame; the cyclic-loop reschedule rides on 'frameStart'.
function frame(context) {
  context.eventEmitter.emit('frameStart');
  context.update();
  context.eventEmitter.emit('frameEnd');
}

function mockEditor(context) {
  const sent = [];
  context.editorConnection = {
    isConnected: () => false, // connectionSentValue asks; a real connection has it
    sendWarning: (componentName, nodeId, key, warning) => sent.push({ componentName, nodeId, key, warning }),
    clearWarning: jest.fn()
  };
  return sent;
}

const byKey = (sent, key) => sent.filter((w) => w.key === key);

function registerReader(context, name, globalName) {
  context.nodeRegister.register(
    NodeDefinition.defineNode({
      name,
      category: 'test',
      initialize() {
        // Mirrors Variable2: react to the store's change event by flagging the output.
        this.context.globalsEventEmitter.on(globalName, () => this.flagOutputDirty('value'));
      },
      inputs: {},
      outputs: {
        value: {
          type: 'number',
          get() {
            return this.context.getGlobalValue(globalName) || 0;
          }
        }
      }
    })
  );
}

let buildCounter = 0;
async function instantiate(context, exportData) {
  // Distinct name and id per build, so fixtures can never alias one another across tests.
  const n = ++buildCounter;
  exportData = { ...exportData, name: `${exportData.name}#${n}`, id: String(n) };
  const componentModel = await ComponentModel.createFromExportData(exportData);
  const instance = new ComponentInstance(context);
  await instance.setComponentModel(componentModel);
  return instance;
}

// Shape 1: reader --wire--> calc --wire--> writer --(variable)--> reader
async function buildPulledLoop(context) {
  registerReader(context, 'Var Reader', 'v');
  context.nodeRegister.register(
    NodeDefinition.defineNode({
      name: 'Calc',
      category: 'test',
      initialize() {
        this._internal.runs = 0;
        this._internal.last = 0;
      },
      inputs: {
        in: {
          set(v) {
            this._internal.runs++;
            this._internal.last = v;
            this.flagOutputDirty('out');
          }
        }
      },
      outputs: {
        out: {
          type: 'number',
          get() {
            return (this._internal.last || 0) + 1;
          }
        }
      }
    })
  );
  context.nodeRegister.register(
    NodeDefinition.defineNode({
      name: 'Var Writer',
      category: 'test',
      inputs: {
        value: {
          set(v) {
            // Mirrors Set Variable: the store happens after inputs settle, not inline.
            this.scheduleAfterInputsHaveUpdated(function () {
              this.context.setGlobalValue('v', v);
            });
          }
        }
      },
      outputs: {}
    })
  );
  return instantiate(context, {
    name: 'pulledLoop',
    id: '1',
    nodes: [
      { id: 'reader', type: 'Var Reader' },
      { id: 'calc', type: 'Calc', parameters: { in: 0 } }, // kick it once
      { id: 'writer', type: 'Var Writer' }
    ],
    connections: [
      { sourceId: 'reader', sourcePort: 'value', targetId: 'calc', targetPort: 'in' },
      { sourceId: 'calc', sourcePort: 'out', targetId: 'writer', targetPort: 'value' }
      // no wire from writer back to reader — the variable closes it
    ]
  });
}

// Shape 2: src1 --wire--> stepA --(v2)--> src2 --wire--> stepB --(v1)--> src1
// Neither step is wired upstream of the other, so nothing is pulled: one hop per round.
async function buildDeferredLoop(context) {
  registerReader(context, 'Src1', 'v1');
  registerReader(context, 'Src2', 'v2');
  const step = (name, writes) =>
    NodeDefinition.defineNode({
      name,
      category: 'test',
      initialize() {
        this._internal.runs = 0;
      },
      inputs: {
        in: {
          set(v) {
            this._internal.runs++;
            this.context.setGlobalValue(writes, (Number(v) || 0) + 1);
          }
        }
      },
      outputs: {}
    });
  context.nodeRegister.register(step('StepA', 'v2'));
  context.nodeRegister.register(step('StepB', 'v1'));
  return instantiate(context, {
    name: 'deferredLoop',
    id: '1',
    nodes: [
      { id: 'src1', type: 'Src1' },
      { id: 'src2', type: 'Src2' },
      { id: 'stepA', type: 'StepA', parameters: { in: 0 } }, // kick it once
      { id: 'stepB', type: 'StepB' }
    ],
    connections: [
      { sourceId: 'src1', sourcePort: 'value', targetId: 'stepA', targetPort: 'in' },
      { sourceId: 'src2', sourcePort: 'value', targetId: 'stepB', targetPort: 'in' }
    ]
  });
}

describe('dependency livelock guard', () => {
  test('pulled loop: throttled by the iteration cap, then halted on the third consecutive frame', async () => {
    const context = new NodeContext();
    const sent = mockEditor(context);
    const instance = await buildPulledLoop(context);
    const calc = instance.nodeScope.getNodeWithId('calc');
    const writer = instance.nodeScope.getNodeWithId('writer');
    // What a person sees on the canvas; node.name is only the type.
    calc.model.parameters.label = 'HeatAccumulator';

    frame(context);
    // The old guard fires and throttles — this is the pre-existing behaviour, still intact.
    expect(byKey(sent, 'cyclic-loop').length).toBeGreaterThan(0);
    const runsAfter1 = calc._internal.runs;
    expect(runsAfter1).toBeGreaterThanOrEqual(50);
    expect(byKey(sent, 'dependency-livelock')).toHaveLength(0);

    frame(context);
    // Rescheduled and spinning again: this is the churn that pinned the renderer.
    expect(calc._internal.runs).toBeGreaterThan(runsAfter1);
    expect(byKey(sent, 'dependency-livelock')).toHaveLength(0);

    frame(context);
    const livelock = byKey(sent, 'dependency-livelock');
    expect(livelock.length).toBeGreaterThan(0);
    expect(livelock[0].warning.level).toBe('error');
    expect(livelock[0].warning.showGlobally).toBe(true);
    expect(livelock[0].warning.message).toMatch(/Variable/);
    expect(calc._livelocked || writer._livelocked).toBe(true);
    // The warning must name the node by its label, not its type — 'JavaScriptFunction' is
    // not something anyone can find among thirty script nodes.
    expect(livelock.map((w) => w.warning.message).join(' ')).toMatch(/HeatAccumulator/);
    expect(livelock.map((w) => w.warning.message).join(' ')).not.toMatch(/"Calc"/);

    // Halted means halted: more frames, no more runs.
    const runsWhenHalted = calc._internal.runs;
    for (let i = 0; i < 5; i++) frame(context);
    expect(calc._internal.runs).toBe(runsWhenHalted);
  });

  test('deferred loop: invisible to the iteration cap, caught by the non-converging-frame detector', async () => {
    const context = new NodeContext();
    const sent = mockEditor(context);
    const instance = await buildDeferredLoop(context);
    const stepA = instance.nodeScope.getNodeWithId('stepA');
    const stepB = instance.nodeScope.getNodeWithId('stepB');

    frame(context);
    frame(context);
    // It churns, and the per-node cap never sees it: no cyclic-loop warning at all.
    expect(stepA._internal.runs + stepB._internal.runs).toBeGreaterThan(6);
    expect(byKey(sent, 'cyclic-loop')).toHaveLength(0);
    expect(byKey(sent, 'dependency-livelock')).toHaveLength(0);

    frame(context);
    const livelock = byKey(sent, 'dependency-livelock');
    expect(livelock.map((w) => w.nodeId).sort()).toEqual(['stepA', 'stepB']);
    expect(livelock[0].warning.level).toBe('error');
    expect(stepA._livelocked).toBe(true);
    expect(stepB._livelocked).toBe(true);

    const runsWhenHalted = stepA._internal.runs + stepB._internal.runs;
    for (let i = 0; i < 5; i++) frame(context);
    expect(stepA._internal.runs + stepB._internal.runs).toBe(runsWhenHalted);
  });

  test('a structural change lifts the quarantine, clears the warning, and an unfixed loop re-quarantines', async () => {
    const context = new NodeContext();
    mockEditor(context);
    const instance = await buildDeferredLoop(context);
    const stepA = instance.nodeScope.getNodeWithId('stepA');

    for (let i = 0; i < 3; i++) frame(context);
    expect(stepA._livelocked).toBe(true);

    const runsAtHalt = stepA._internal.runs;
    context.clearLivelockQuarantine();

    expect(stepA._livelocked).toBe(false);
    expect(context.editorConnection.clearWarning).toHaveBeenCalledWith(expect.anything(), 'stepA', 'dependency-livelock');

    // Lifting does NOT replay the backlog: quarantine emptied the queues, and a halted node
    // dropped whatever arrived meanwhile. Replaying it would re-freeze the editor at once even
    // if the user had just fixed the loop — the backlog IS the pathology. So an idle loop stays
    // idle: no churn, no quarantine, until something triggers it again.
    for (let i = 0; i < 3; i++) frame(context);
    expect(stepA._livelocked).toBe(false);
    expect(stepA._internal.runs).toBe(runsAtHalt);

    // Triggered again with nothing fixed, it must come straight back rather than churn silently.
    stepA.queueInput('in', 0);
    for (let i = 0; i < 3; i++) frame(context);
    expect(stepA._livelocked).toBe(true);
    expect(stepA._internal.runs).toBeGreaterThan(runsAtHalt);
  });

  test('queue overflow: a port flooded within one frame halts the node before the drain runs away', async () => {
    // The shape read off a live freeze with the debugger: a meter at iteration 0 draining
    // 247,618 queued 'add' values. The iteration cap never becomes reachable, because one
    // iteration's cost grows with the backlog. The bound has to be on the queue itself.
    const context = new NodeContext();
    const sent = mockEditor(context);
    context.nodeRegister.register(
      NodeDefinition.defineNode({
        name: 'Flood',
        category: 'test',
        inputs: {
          prime: {
            set() {
              this.sendValue('out', -1);
            }
          },
          go: {
            set() {
              for (let i = 0; i < 1500; i++) this.sendValue('out', i);
            }
          }
        },
        outputs: { out: { type: 'number', get() { return 0; } } }
      })
    );
    context.nodeRegister.register(
      NodeDefinition.defineNode({
        name: 'Sink',
        category: 'test',
        initialize() {
          this._internal.got = 0;
        },
        inputs: { in: { set() { this._internal.got++; } } },
        outputs: {}
      })
    );
    const instance = await instantiate(context, {
      name: 'flood',
      id: '1',
      nodes: [
        { id: 'flood', type: 'Flood', parameters: { prime: true } },
        { id: 'sink', type: 'Sink' }
      ],
      connections: [{ sourceId: 'flood', sourcePort: 'out', targetId: 'sink', targetPort: 'in' }]
    });
    const sink = instance.nodeScope.getNodeWithId('sink');
    const flood = instance.nodeScope.getNodeWithId('flood');

    // One value first: queueInput coalesces everything queued before a node's FIRST update
    // into a single value, which would swallow the flood. The meter in the live freeze had
    // updated many times before its queue ran to 247,618.
    frame(context);
    expect(sink._internal.got).toBe(1);
    expect(sink._livelocked).toBe(false);

    flood.queueInput('go', true);
    frame(context);

    expect(sink._livelocked).toBe(true);
    const w = byKey(sent, 'dependency-livelock');
    expect(w).toHaveLength(1);
    expect(w[0].nodeId).toBe('sink');
    expect(w[0].warning.level).toBe('error');
    expect(w[0].warning.message).toMatch(/queued/);
    // Backlog freed and no further input accepted: the 500 values after the cap were dropped.
    expect(Object.values(sink._inputValuesQueue).every((q) => q.length === 0)).toBe(true);
    expect(sink._internal.got).toBeLessThan(1500);
  });

  test('frame budget: a loop that keeps a frame busy past the budget yields, and is halted after three frames', async () => {
    // A pulled loop whose step is deliberately slow. Without the budget, one frame is 100
    // spins of ~5ms — half a second with the browser locked out. With it, the frame yields at
    // the budget, is rescheduled, and after three over-budget frames the node is halted.
    const context = new NodeContext();
    context.frameBudgetMs = 40;
    const sent = mockEditor(context);
    registerReader(context, 'Var Reader', 'v');
    context.nodeRegister.register(
      NodeDefinition.defineNode({
        name: 'Slow Calc',
        category: 'test',
        initialize() {
          this._internal.runs = 0;
          this._internal.last = 0;
        },
        inputs: {
          in: {
            set(v) {
              const t = Date.now();
              while (Date.now() - t < 5) {
                /* burn ~5ms, like a heavy script node */
              }
              this._internal.runs++;
              this._internal.last = v;
              this.flagOutputDirty('out');
            }
          }
        },
        outputs: { out: { type: 'number', get() { return (this._internal.last || 0) + 1; } } }
      })
    );
    context.nodeRegister.register(
      NodeDefinition.defineNode({
        name: 'Var Writer',
        category: 'test',
        inputs: {
          value: {
            set(v) {
              this.scheduleAfterInputsHaveUpdated(function () {
                this.context.setGlobalValue('v', v);
              });
            }
          }
        },
        outputs: {}
      })
    );
    const instance = await instantiate(context, {
      name: 'slowLoop',
      id: '1',
      nodes: [
        { id: 'reader', type: 'Var Reader' },
        { id: 'calc', type: 'Slow Calc', parameters: { in: 0 } },
        { id: 'writer', type: 'Var Writer' }
      ],
      connections: [
        { sourceId: 'reader', sourcePort: 'value', targetId: 'calc', targetPort: 'in' },
        { sourceId: 'calc', sourcePort: 'out', targetId: 'writer', targetPort: 'value' }
      ]
    });
    const calc = instance.nodeScope.getNodeWithId('calc');
    const writer = instance.nodeScope.getNodeWithId('writer');

    const t0 = Date.now();
    frame(context);
    const frameMs = Date.now() - t0;
    // 100 spins at ~5ms would be ~500ms; the 40ms budget must have ended the frame far sooner.
    expect(frameMs).toBeLessThan(300);
    expect(calc._budgetTripped || writer._budgetTripped).toBe(true);
    expect(calc._internal.runs).toBeLessThan(100);
    // A budget trip is not called a cycle.
    expect(byKey(sent, 'cyclic-loop')).toHaveLength(0);
    expect(byKey(sent, 'dependency-livelock')).toHaveLength(0);

    frame(context);
    frame(context);
    const w = byKey(sent, 'dependency-livelock');
    expect(w.length).toBeGreaterThan(0);
    expect(w[0].warning.message).toMatch(/budget/);
    expect(calc._livelocked || writer._livelocked).toBe(true);

    const runsWhenHalted = calc._internal.runs;
    frame(context);
    frame(context);
    expect(calc._internal.runs).toBe(runsWhenHalted);
  });

  test('a graph that converges is never quarantined', async () => {
    const context = new NodeContext();
    const sent = mockEditor(context);
    context.nodeRegister.register(
      NodeDefinition.defineNode({
        name: 'Relay',
        category: 'test',
        inputs: {
          in: {
            set(v) {
              this._internal.last = v;
              this.flagOutputDirty('out');
            }
          }
        },
        outputs: {
          out: {
            type: 'number',
            get() {
              return (this._internal.last || 0) + 1;
            }
          }
        }
      })
    );
    const instance = await instantiate(context, {
      name: 'chain',
      id: '1',
      nodes: [
        { id: 'a', type: 'Relay', parameters: { in: 1 } },
        { id: 'b', type: 'Relay' },
        { id: 'c', type: 'Relay' }
      ],
      connections: [
        { sourceId: 'a', sourcePort: 'out', targetId: 'b', targetPort: 'in' },
        { sourceId: 'b', sourcePort: 'out', targetId: 'c', targetPort: 'in' }
      ]
    });

    for (let i = 0; i < 10; i++) frame(context);

    expect(byKey(sent, 'dependency-livelock')).toHaveLength(0);
    expect(byKey(sent, 'cyclic-loop')).toHaveLength(0);
    const c = instance.nodeScope.getNodeWithId('c');
    expect(c._livelocked).toBe(false);
    expect(c._internal.last).toBe(3); // a.in=1 -> a.out=2 -> b.out=3
  });
});
