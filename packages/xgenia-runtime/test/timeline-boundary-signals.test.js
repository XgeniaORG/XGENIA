const NodeContext = require('../src/nodecontext');
const GraphModel = require('../src/models/graphmodel');
const ComponentInputs = require('../src/nodes/componentinputs');
const ComponentOutputs = require('../src/nodes/componentoutputs');
const NodeDefinition = require('../src/nodedefinition');

// THE DEFECT (export xgenia-debug-export-1789410244757, T6): a signal that
// crosses a component boundary (Component Inputs/Outputs, or a component
// instance's own output mirroring one) is forwarded as two plain boolean
// writes via Node.prototype.sendValue, not connectionSentSignal. The timeline
// recorded both edges as 'value' events, so a kind:'signal' read never saw
// the fire, and a value read saw a phantom 'true' then 'false' pair.
//
// The declared port type lives on a node MODEL, not the dynamically
// registered Node-level output: NodeModel.outputPorts/inputPorts are OBJECTs
// keyed by port name (see models/nodemodel.js addOutputPort/addInputPort:
// `this.outputPorts[port.name] = port`), populated from the exported
// project data's `ports` array at createFromExportData time.
//
// For a component-INSTANCE's own output (setOutputFromComponentOutput's
// flagOutputDirty call on the instance itself, owner.model.type is the
// component's path e.g. '/Components/GremlinGold/Logic'), that model IS
// `output.owner.model` and its outputPorts come from
// GraphModel._addComponentPorts (models/graphmodel.js:295-311).
//
// For a 'Component Inputs' NODE's own output, the node's OWN model.ports is
// USELESS on real data: the editor's exporter only emits node-level `ports`
// for types with exportDynamicPorts (packages/xgenia-editor/.../utils/
// exporter/util.ts:16-35; Component Inputs is not one of them), so
// output.owner.model.outputPorts is `{}` on every real preview export. The
// declared type instead lives on the OWNING component instance's own model
// (the same one _addComponentPorts populated), reached the exact way
// componentinputs.js's own registerOutputIfNeeded/getter reach it: via
// `owner.nodeScope.componentOwner` (componentinputs.js:31-40 uses
// `this.nodeScope.componentOwner._internal.inputValues[name]`) —
// `componentOwner.model.inputPorts[name]`.
//
// 'Component Outputs' never appears as `output.owner` here at all:
// componentoutputs.js registers only an INPUT (registerInputIfNeeded), never
// an output, so connectionSentValue/_isBoundarySignalPort is never called
// with that node as the owner. There is no dead branch for it below.

// Fixture for the component-INSTANCE-output case and the plain non-boundary
// cases: here output.owner.model IS the model the real code reads directly
// (model.outputPorts[name]), so a hand-built model.outputPorts is faithful.
function fakeOutput(ownerModelType, portName, portType, ownerTypeOverride) {
  return {
    name: portName,
    connections: [{ node: { id: 'ctrl', name: 'PixiReelController' }, inputPortName: 'stop' }],
    owner: {
      id: 'logic',
      name: '/Components/GremlinGold/Logic',
      type: ownerTypeOverride !== undefined ? ownerTypeOverride : ownerModelType,
      model: {
        type: ownerModelType,
        outputPorts: {
          [portName]: { name: portName, plug: 'output', type: portType },
        },
      },
    },
  };
}

// Fixture for the Component-Inputs-node-output case, shaped like real
// exporter data: the node's OWN model.outputPorts is empty (the exporter
// never populates it for this type), and the declared type instead sits on
// the owning component instance's model.inputPorts, reached via
// owner.nodeScope.componentOwner — see the comment above
// NodeContext.prototype._isBoundarySignalPort in src/nodecontext.js.
function fakeComponentInputsOutput(portName, portType) {
  return {
    name: portName,
    connections: [{ node: { id: 'p', name: 'Pulse' }, inputPortName: 'go' }],
    owner: {
      id: 'ci',
      name: 'ci',
      type: 'Component Inputs',
      model: { type: 'Component Inputs', outputPorts: {} }, // exporter-shaped: always empty on real data
      nodeScope: {
        componentOwner: {
          model: {
            type: '/Components/GremlinGold/Logic',
            inputPorts: {
              [portName]: { name: portName, plug: 'input', type: portType },
            },
          },
        },
      },
    },
  };
}

describe('timeline: signals crossing a component boundary', () => {
  let ctx;
  beforeEach(() => {
    ctx = new NodeContext({ platform: { getCurrentTime: () => 0 } });
  });

  it('records the true pulse as ONE signal event on Component Inputs, reading the type off the owning instance', () => {
    const out = fakeComponentInputsOutput('Spin', 'signal');
    ctx.connectionSentValue(out, true);
    ctx.connectionSentValue(out, false);
    const evs = ctx.getEventTimeline().events;
    expect(evs.map((e) => e.kind)).toEqual(['signal']);
    expect(evs[0].via).toBe('component-boundary');
  });

  it('a component INSTANCE output mirroring a boundary signal is also reclassified', () => {
    // Real shape from setOutputFromComponentOutput -> Node.prototype.flagOutputDirty:
    // `output.owner` is the component-instance Node itself, whose model.type is the
    // component's path (e.g. '/Components/GremlinGold/Logic'), matched by the export's
    // `@/Components/GremlinGold/Logic.Done = true -> @PixiReelController.stop`.
    const out = fakeOutput('/Components/GremlinGold/Logic', 'Done', 'signal', '/Components/GremlinGold/Logic');
    ctx.connectionSentValue(out, true);
    ctx.connectionSentValue(out, false);
    const evs = ctx.getEventTimeline().events;
    expect(evs.map((e) => e.kind)).toEqual(['signal']);
    expect(evs[0].via).toBe('component-boundary');
    expect(evs[0].nodeType).toBe('/Components/GremlinGold/Logic');
  });

  it('a boolean DATA port on a Component Inputs boundary stays a value', () => {
    const out = fakeComponentInputsOutput('isBigWin', 'boolean');
    ctx.connectionSentValue(out, true);
    const evs = ctx.getEventTimeline().events;
    expect(evs.map((e) => e.kind)).toEqual(['value']);
    expect(evs[0].via).toBeUndefined();
  });

  it('a non-boundary node is unchanged', () => {
    const out = fakeOutput('JavaScriptFunction', 'out-Done', 'signal');
    ctx.connectionSentValue(out, true);
    const evs = ctx.getEventTimeline().events;
    expect(evs.map((e) => e.kind)).toEqual(['value']);
  });

  it('a real connectionSentSignal fire is unaffected and still recorded as signal', () => {
    const out = fakeOutput('JavaScriptFunction', 'out-Done', 'signal');
    ctx.connectionSentSignal(out);
    const evs = ctx.getEventTimeline().events;
    expect(evs.map((e) => e.kind)).toEqual(['signal']);
    expect(evs[0].via).toBeUndefined();
  });
});

// GRAPH-LEVEL test (built like the reviewer's real-import probe): a real
// GraphModel.importEditorData + NodeContext, exporter-shaped data (Component
// Inputs/Outputs nodes get `ports: []`, exactly what
// packages/xgenia-editor/src/editor/src/utils/exporter/util.ts's
// exportPorts produces for these types), a component instance embedded in a
// parent component, and a signal driven both INTO the component (through
// Component Inputs) and OUT of it (through the instance's own output
// mirroring Component Outputs). This is the shape the unit fixtures above
// cannot prove by themselves — it exercises the real wiring
// (owner.nodeScope.componentOwner, GraphModel._addComponentPorts) end to end.
describe('timeline: signals crossing a component boundary (real graph, exporter-shaped data)', () => {
  function registerTestNodes(ctx) {
    ctx.nodeRegister.register(NodeDefinition.defineNode(ComponentInputs.node));
    ctx.nodeRegister.register(NodeDefinition.defineNode(ComponentOutputs.node));
    ctx.nodeRegister.register(
      NodeDefinition.defineNode({
        name: 'Pulse',
        category: 'test',
        inputs: { go: { type: 'signal', valueChangedToTrue() { this.sendSignalOnOutput('fire'); } } },
        outputs: { fire: { type: 'signal' } },
      })
    );
    ctx.nodeRegister.register(
      NodeDefinition.defineNode({
        name: 'Recv',
        category: 'test',
        initialize() { this.hits = 0; },
        inputs: { stop: { type: 'signal', valueChangedToTrue() { this.hits++; } } },
      })
    );
  }

  // Component 'Flag' also carries a boolean DATA port across the boundary
  // (Component Inputs port 'Flag', DATA-typed) alongside the signal port
  // 'Spin', to prove the boundary reclassification does not swallow data.
  async function buildGraph() {
    const ctx = new NodeContext({ platform: { getCurrentTime: () => 0, requestUpdate() {}, isRunningLocally: () => false } });
    registerTestNodes(ctx);
    const graph = new GraphModel();
    graph.on('componentAdded', (c) => ctx.registerComponentModel(c));
    await graph.importEditorData({
      components: [
        {
          name: '/Logic',
          nodes: [
            // Exporter shape: node-level `ports` is [] for Component Inputs/Outputs
            // on real exports (only types with exportDynamicPorts get a non-empty array).
            { id: 'ci', type: 'Component Inputs', ports: [] },
            { id: 'p', type: 'Pulse' },
            { id: 'co', type: 'Component Outputs', ports: [] },
          ],
          connections: [
            { sourceId: 'ci', sourcePort: 'Spin', targetId: 'p', targetPort: 'go' },
            { sourceId: 'p', sourcePort: 'fire', targetId: 'co', targetPort: 'Done' },
          ],
          // The component's OWN declared ports, which the exporter always emits
          // (this is the component's public interface, not a node's dynamic ports).
          ports: [
            { name: 'Spin', plug: 'input', type: 'signal' },
            { name: 'Flag', plug: 'input', type: 'boolean' },
            { name: 'Done', plug: 'output', type: 'signal' },
          ],
        },
        {
          name: '/root',
          nodes: [
            { id: 'src', type: 'Pulse' },
            { id: 'inst', type: '/Logic', ports: [] },
            { id: 'r', type: 'Recv' },
          ],
          connections: [
            { sourceId: 'src', sourcePort: 'fire', targetId: 'inst', targetPort: 'Spin' },
            { sourceId: 'inst', sourcePort: 'Done', targetId: 'r', targetPort: 'stop' },
          ],
        },
      ],
    });
    const root = await ctx.createComponentInstanceNode('/root');
    ctx.setRootComponent(root);
    ctx.update();
    return { ctx, root };
  }

  it('records ONE signal event, via component-boundary, both inward (Component Inputs) and outward (instance output)', async () => {
    const { ctx, root } = await buildGraph();
    const before = ctx.getEventTimeline().events.length;
    const src = root.nodeScope.getNodeWithId('src');
    const r = root.nodeScope.getNodeWithId('r');

    src.sendSignalOnOutput('fire');
    ctx.update();

    const evs = ctx.getEventTimeline().events.slice(before);
    const boundarySignals = evs.filter((e) => e.kind === 'signal' && e.via === 'component-boundary');
    // Inward: Component Inputs.Spin. Outward: the instance's own output (model.type '/Logic').
    expect(boundarySignals.map((e) => `${e.nodeType}.${e.port}`)).toEqual(['Component Inputs.Spin', '/Logic.Done']);
    // No false-edge 'value' events leaked from either boundary crossing.
    expect(evs.some((e) => e.kind === 'value' && (e.port === 'Spin' || e.port === 'Done'))).toBe(false);
    expect(r.hits).toBe(1);
  });

  it('a boolean DATA port through the same boundary stays a value, not a signal', async () => {
    const { ctx, root } = await buildGraph();
    const before = ctx.getEventTimeline().events.length;
    const inst = root.nodeScope.getNodeWithId('inst');

    inst.queueInput('Flag', true);
    ctx.update();

    const evs = ctx.getEventTimeline().events.slice(before);
    const flagEvents = evs.filter((e) => e.port === 'Flag');
    expect(flagEvents.length).toBeGreaterThan(0);
    expect(flagEvents.every((e) => e.kind === 'value')).toBe(true);
    expect(flagEvents.every((e) => e.via === undefined)).toBe(true);
  });
});
