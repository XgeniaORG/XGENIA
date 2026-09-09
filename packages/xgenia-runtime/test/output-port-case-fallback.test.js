// A wire saved against an output whose name differs only by case (`done` vs `Done`) used to be
// dropped with a console.warn — "wired but nothing happens". connectInput now resolves the
// output the way it has resolved inputs since March: exact name first, then first-character
// case, then a whole-name case-insensitive match.
'use strict';
const NodeContext = require('../src/nodecontext');
const ComponentInstance = require('../src/nodes/componentinstance');
const ComponentModel = require('../src/models/componentmodel');
const NodeDefinition = require('../src/nodedefinition');

const Source = NodeDefinition.defineNode({
  name: 'CaseSource',
  category: 'test',
  initialize() { this._internal.value = 7; },
  inputs: {
    emit: { type: 'signal', valueChangedToTrue() { this.flagOutputDirty('Value'); this.sendSignalOnOutput('Done'); } }
  },
  outputs: {
    Value: { type: 'number', getter() { return this._internal.value; } },
    Done: { type: 'signal' }
  }
});
const Target = NodeDefinition.defineNode({
  name: 'CaseTarget',
  category: 'test',
  initialize() { this._internal.got = undefined; this._internal.fired = 0; },
  inputs: {
    number: { type: 'number', set(v) { this._internal.got = v; } },
    go: { type: 'signal', valueChangedToTrue() { this._internal.fired++; } }
  },
  outputs: {}
});

async function build(connections) {
  const ctx = new NodeContext();
  ctx.nodeRegister.register(Source);
  ctx.nodeRegister.register(Target);
  const model = await ComponentModel.createFromExportData({
    name: 'c', id: '1',
    nodes: [{ id: 'S', type: 'CaseSource', parameters: {} }, { id: 'T', type: 'CaseTarget', parameters: {} }],
    connections
  });
  const inst = new ComponentInstance(ctx);
  await inst.setComponentModel(model);
  ctx.update();
  return { ctx, s: inst.nodeScope.getNodeWithId('S'), t: inst.nodeScope.getNodeWithId('T') };
}

describe('output port name fallback', () => {
  let warn;
  beforeEach(() => { warn = jest.spyOn(console, 'warn').mockImplementation(() => {}); jest.spyOn(console, 'debug').mockImplementation(() => {}); });
  afterEach(() => { jest.restoreAllMocks(); });

  test('a lower-case wire to an upper-case output still delivers values and signals', async () => {
    const { ctx, s, t } = await build([
      { sourceId: 'S', sourcePort: 'value', targetId: 'T', targetPort: 'number' },
      { sourceId: 'S', sourcePort: 'done', targetId: 'T', targetPort: 'go' }
    ]);
    s.queueInput('emit', true); s.queueInput('emit', false); ctx.update();
    expect(t._internal.got).toBe(7);
    expect(t._internal.fired).toBe(1);
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('has no output'));
  });

  test('a genuinely missing output is still refused with the warning', async () => {
    const { t } = await build([{ sourceId: 'S', sourcePort: 'nope', targetId: 'T', targetPort: 'number' }]);
    expect(t._internal.got).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('has no output "nope"'));
  });
});
