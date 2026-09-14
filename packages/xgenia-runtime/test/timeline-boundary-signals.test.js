const NodeContext = require('../src/nodecontext');

// THE DEFECT (export xgenia-debug-export-1789410244757, T6): a signal that
// crosses a component boundary (Component Inputs/Outputs, or a component
// instance's own output mirroring one) is forwarded as two plain boolean
// writes via Node.prototype.sendValue, not connectionSentSignal. The timeline
// recorded both edges as 'value' events, so a kind:'signal' read never saw
// the fire, and a value read saw a phantom 'true' then 'false' pair.
//
// The declared port type lives on the node MODEL, not the dynamically
// registered Node-level output: NodeModel.outputPorts is an OBJECT keyed by
// port name (see models/nodemodel.js addOutputPort: `this.outputPorts[port.name]
// = port`), populated from the exported project data's `ports` array at
// createFromExportData time. So `output.owner.model.outputPorts[output.name].type`
// is reachable and carries the author's declared type ('signal' vs a data
// type like 'boolean') even though componentinputs.js/componentoutputs.js
// register the ports themselves with no type at all.

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

describe('timeline: signals crossing a component boundary', () => {
  let ctx;
  beforeEach(() => {
    ctx = new NodeContext({ platform: { getCurrentTime: () => 0 } });
  });

  it('records the true pulse as ONE signal event, via:component-boundary, and drops the false edge (Component Outputs)', () => {
    const out = fakeOutput('Component Outputs', 'Done', 'signal');
    ctx.connectionSentValue(out, true);
    ctx.connectionSentValue(out, false);
    const evs = ctx.getEventTimeline().events;
    expect(evs.map((e) => e.kind)).toEqual(['signal']);
    expect(evs[0].via).toBe('component-boundary');
  });

  it('records the true pulse as ONE signal event on Component Inputs too', () => {
    const out = fakeOutput('Component Inputs', 'Ready', 'signal');
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

  it('a boolean DATA port on a boundary stays a value', () => {
    const out = fakeOutput('Component Outputs', 'isBigWin', 'boolean');
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
