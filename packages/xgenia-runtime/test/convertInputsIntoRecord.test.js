const NodeContext = require('../src/nodecontext');
const NodeDefinition = require('../src/nodedefinition');
const ComponentInstance = require('../src/nodes/componentinstance');
const ComponentModel = require('../src/models/componentmodel');
const ConvertInputsIntoRecord = require('../src/nodes/std-library/convertInputsIntoRecord');

const SourceNode = NodeDefinition.defineNode({
  name: 'Test Source',
  category: 'test',
  initialize() { this._internal.val = undefined; },
  inputs: { feed: { type: '*', set(v) { this._internal.val = v; this.flagOutputDirty('out'); } } },
  outputs: { out: { type: '*', getter() { return this._internal.val; } } }
});

function makeContext() {
  const context = new NodeContext();
  context.nodeRegister.register(SourceNode);
  context.nodeRegister.register(NodeDefinition.defineNode(ConvertInputsIntoRecord.node));
  return context;
}

async function build(recParams, sources, connections) {
  const context = makeContext();
  const nodes = [
    ...sources.map((s) => ({ id: s.id, type: 'Test Source', parameters: { feed: s.value } })),
    { id: 'rec', type: 'Convert Inputs into Record', parameters: recParams }
  ];
  const componentModel = await ComponentModel.createFromExportData({ name: 'c', id: 'c1', nodes, connections });
  const ci = new ComponentInstance(context);
  await ci.setComponentModel(componentModel);
  context.update();
  return {
    rec: ci.nodeScope.getNodeWithId('rec'),
    recModel: componentModel.getNodeWithId('rec'),
    componentModel,
    context
  };
}

test('key-field method: existing + newly added ports', async () => {
  const { rec } = await build(
    { numInputs: 3, key0: 'first', key2: 'myLabel' },
    [{ id: 's0', value: 'ZERO' }, { id: 's2', value: 'NEW' }],
    [
      { sourceId: 's0', sourcePort: 'out', targetId: 'rec', targetPort: 'input0' },
      { sourceId: 's2', sourcePort: 'out', targetId: 'rec', targetPort: 'input2' }
    ]
  );
  rec.buildRecord();
  expect(rec._internal.record).toEqual({ first: 'ZERO', myLabel: 'NEW' });
});

test('rename method: renaming a value port to a label uses that label as the record key', async () => {
  const { rec, componentModel } = await build(
    { numInputs: 3, key0: 'first' }, // key2 intentionally unset — label comes from the port rename
    [{ id: 's0', value: 'ZERO' }, { id: 's2', value: 'NEW' }],
    [{ sourceId: 's0', sourcePort: 'out', targetId: 'rec', targetPort: 'input0' }]
  );

  // The editor renames value port input2 -> "myLabel"; the runtime mirrors this by
  // renaming the model port and moving connections (editormodeleventshandler).
  componentModel.renameInputPortOnNodeWithId('rec', 'input2', 'myLabel');
  // Now connect the new value to the renamed port.
  componentModel.addConnection({ sourceId: 's2', sourcePort: 'out', targetId: 'rec', targetPort: 'myLabel' });
  rec.context.update();

  rec.buildRecord();
  console.log('rename record:', JSON.stringify(rec._internal.record));
  expect(rec._internal.record).toEqual({ first: 'ZERO', myLabel: 'NEW' });
});
