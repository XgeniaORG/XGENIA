import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serializeNodeParameters } from '../../src/editor/src/views/panels/ChatPanelBridge/serialize-param-guard';

// Minimal stand-in for NodeGraphNode: stored map + getParameter falling back to
// the port default, and NO getParameters() (the editor model has none).
function fakeNode(opts: {
  typename: string;
  parameters: Record<string, unknown>;
  ports?: any[];
}) {
  const ports = opts.ports ?? [];
  return {
    typename: opts.typename,
    parameters: opts.parameters,
    getPorts: () => ports,
    getParameter(name: string) {
      const v = this.parameters[name];
      if (v !== undefined) return v;
      return ports.find((p) => p.name === name && p.plug !== 'output')?.default;
    }
  };
}

test('stored name survives when the port list lacks it (export 1790277377788)', () => {
  const node = fakeNode({
    typename: 'Variable2',
    parameters: { name: 'BetAmount', nodeLabel: 'BetAmountVar' },
    ports: [{ name: 'value', plug: 'input', type: '*' }, { name: 'value', plug: 'output', type: '*' }]
  });
  const out = serializeNodeParameters(node);
  assert.equal(out.name, 'BetAmount');
  assert.equal(out.nodeLabel, undefined, 'nodeLabel stays top-level only');
});

test('stored name survives with an empty port list and no type ports', () => {
  const node = fakeNode({ typename: 'Set Variable', parameters: { name: 'IsSpinning' }, ports: [] });
  assert.deepEqual(serializeNodeParameters(node, () => undefined), { name: 'IsSpinning' });
});

test('value matches node.getParameter for a stored key with no port', () => {
  const dim = { value: 480, unit: 'px' };
  const node = fakeNode({ typename: 'Group', parameters: { orphan: dim } });
  assert.deepEqual(serializeNodeParameters(node).orphan, node.getParameter('orphan'));
});

test('known unit port is still normalised', () => {
  const node = fakeNode({
    typename: 'Group',
    parameters: { width: { value: 480, unit: 'px' } },
    ports: [{ name: 'width', plug: 'input', type: { name: 'number', units: ['%', 'px'], defaultUnit: '%' }, default: 100 }]
  });
  assert.equal(serializeNodeParameters(node).width, '480px');
});

test('unset port still serializes its default, as before', () => {
  const node = fakeNode({
    typename: 'Text',
    parameters: {},
    ports: [{ name: 'text', plug: 'input', type: 'string', default: 'Hello' }]
  });
  assert.equal(serializeNodeParameters(node).text, 'Hello');
});

test('deny rules apply to stored keys too', () => {
  const node = fakeNode({
    typename: 'pixi.Sprite',
    parameters: { functionScript: 'x', big: 'y'.repeat(20001), done: 'z', ok: 1 },
    ports: [{ name: 'done', plug: 'output', type: 'signal' }]
  });
  assert.deepEqual(serializeNodeParameters(node), { ok: 1 });
});

test('JavaScript nodes keep functionScript', () => {
  const node = fakeNode({ typename: 'Javascript2', parameters: { functionScript: 'return 1' } });
  assert.equal(serializeNodeParameters(node).functionScript, 'return 1');
});

test('type ports resolver is used when the node reports none', () => {
  const node = fakeNode({ typename: 'Text', parameters: { text: 'Hi', width: { value: 50, unit: '%' } } });
  const typePorts = [
    { name: 'text', plug: 'input', type: 'string' },
    { name: 'width', plug: 'input', type: { name: 'number', units: ['%', 'px'], defaultUnit: '%' } }
  ];
  const out = serializeNodeParameters(node, (t) => (t === 'Text' ? typePorts : undefined));
  assert.deepEqual(out, { text: 'Hi', width: '50%' });
});
