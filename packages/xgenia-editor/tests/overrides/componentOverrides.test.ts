import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UndoQueue } from '../../src/editor/src/models/undo-queue-model';
import {
  APPLY_LABEL,
  REVERT_LABEL,
  applyOverrides,
  componentNameOf,
  formatOverrideValue,
  isComponentInstance,
  overriddenInputs,
  revertOverrides
} from '../../src/editor/src/utils/componentOverrides';

/*
 * Stand-ins for NodeGraphNode / NodeGraphModel / ComponentModel. They keep the three
 * behaviours the feature depends on, copied from the real models:
 *  - setParameter(name, undefined) deletes, and with { undo: group } pushes a do/undo
 *    pair that replays the write (NodeGraphNode.setParameter);
 *  - getParameter falls back parameters → variant → port default (NodeGraphNode.getParameter);
 *  - a component input's port default is the inner parameter its ONE wire lands on,
 *    recomputed on every read (ComponentModel.getPorts / _deriveDef).
 */

type Port = { name: string; plug: 'input' | 'output'; default?: unknown };

class FakeNode {
  parameters: Record<string, unknown> = {};
  stateParameters: Record<string, Record<string, unknown>> | undefined;
  variant: { parameters: Record<string, unknown> } | undefined;
  variantName: string | undefined;
  label: string | undefined;
  typename: string;
  ports: Port[];

  constructor(
    public id: string,
    public type: any,
    opts: { label?: string; ports?: Port[]; parameters?: Record<string, unknown> } = {}
  ) {
    this.typename = (type && type.name) || 'Node';
    this.label = opts.label;
    this.ports = opts.ports || [];
    Object.assign(this.parameters, opts.parameters || {});
  }

  getPorts(filter?: 'input' | 'output'): Port[] {
    const own = this.type && typeof this.type.getPorts === 'function' ? this.type.getPorts() : [];
    const all = [...own, ...this.ports];
    return filter ? all.filter((p) => p.plug === filter) : all;
  }

  getPort(name: string, plug?: 'input' | 'output') {
    return this.getPorts(plug).find((p) => p.name === name);
  }

  getParameter(name: string) {
    if (this.parameters[name] !== undefined) return this.parameters[name];
    if (this.variant && this.variant.parameters[name] !== undefined) return this.variant.parameters[name];
    const port = this.getPort(name, 'input');
    return port ? port.default : undefined;
  }

  setParameter(name: string, value: unknown, args?: any) {
    const oldValue = this.parameters[name];
    if (value === undefined) delete this.parameters[name];
    else this.parameters[name] = value;
    if (args && args.undo && typeof args.undo === 'object') {
      args.undo.push({
        label: args.label,
        do: () => this.setParameter(name, value),
        undo: () => this.setParameter(name, oldValue)
      });
    }
  }
}

class FakeGraph {
  nodes: FakeNode[] = [];
  connections: { fromId: string; fromProperty: string; toId: string; toProperty: string }[] = [];
  add(node: FakeNode) {
    this.nodes.push(node);
    return node;
  }
  connect(from: FakeNode, fromProperty: string, to: FakeNode, toProperty: string) {
    this.connections.push({ fromId: from.id, fromProperty, toId: to.id, toProperty });
  }
  forEachNode(callback: (node: FakeNode) => boolean | void) {
    for (const node of this.nodes) if (callback(node)) return true;
    return false;
  }
  findNodeWithId(id: string) {
    return this.nodes.find((n) => n.id === id);
  }
}

class FakeComponent {
  graph = new FakeGraph();
  constructor(public name: string) {}
  get fullName() {
    return this.name;
  }
  /** ComponentModel.getPorts, input side only: one wire → its inner value is the default. */
  getPorts(): Port[] {
    const ports: Port[] = [];
    this.graph.forEachNode((node) => {
      if (!node.type || !node.type.haveComponentPorts) return;
      for (const p of node.getPorts('output')) {
        const wires = this.graph.connections.filter((c) => c.fromId === node.id && c.fromProperty === p.name);
        const def =
          wires.length === 1 ? this.graph.findNodeWithId(wires[0].toId)!.getParameter(wires[0].toProperty) : undefined;
        ports.push({ name: p.name, plug: 'input', default: def });
      }
    });
    return ports;
  }
}

const componentInputsType = { name: 'Component Inputs', haveComponentPorts: true };
const textType = { name: 'Text' };

/**
 * /Slot/Reels with three inputs:
 *  - speed    → one wire into Spinner.rate
 *  - colour   → two wires, into LabelA.color and LabelB.color
 *  - unused   → no wires at all
 */
function setup() {
  const component = new FakeComponent('/Slot/Reels');
  const inputs = component.graph.add(
    new FakeNode('inputs', componentInputsType, {
      ports: [
        { name: 'speed', plug: 'output' },
        { name: 'colour', plug: 'output' },
        { name: 'unused', plug: 'output' }
      ]
    })
  );
  const spinner = component.graph.add(
    new FakeNode('spinner', textType, {
      label: 'Spinner',
      ports: [{ name: 'rate', plug: 'input', default: 1 }],
      parameters: { rate: 2 }
    })
  );
  const labelA = component.graph.add(
    new FakeNode('labelA', textType, { ports: [{ name: 'color', plug: 'input', default: '#000' }] })
  );
  const labelB = component.graph.add(
    new FakeNode('labelB', textType, { ports: [{ name: 'color', plug: 'input', default: '#000' }] })
  );
  component.graph.connect(inputs, 'speed', spinner, 'rate');
  component.graph.connect(inputs, 'colour', labelA, 'color');
  component.graph.connect(inputs, 'colour', labelB, 'color');

  const instance = new FakeNode('instance-1', component);
  const other = new FakeNode('instance-2', component);
  const queue = new UndoQueue();
  return { component, inputs, spinner, labelA, labelB, instance, other, queue };
}

test('a node whose type is not a component has no overrides and nothing to apply', () => {
  const plain = new FakeNode('plain', textType, {
    ports: [{ name: 'text', plug: 'input' }],
    parameters: { text: 'hello' }
  });
  const queue = new UndoQueue();
  assert.equal(isComponentInstance(plain), false);
  assert.deepEqual(overriddenInputs(plain), []);
  assert.equal(applyOverrides(plain, ['text'], { undoQueue: queue }), null);
  assert.equal(revertOverrides(plain, ['text'], { undoQueue: queue }), null);
  assert.equal(queue.getHistory().length, 0);
  assert.equal(plain.parameters.text, 'hello');
  assert.deepEqual(overriddenInputs(null), []);
});

test('an instance with no parameters lists nothing', () => {
  const { instance } = setup();
  assert.equal(isComponentInstance(instance), true);
  assert.equal(componentNameOf(instance), '/Slot/Reels');
  assert.deepEqual(overriddenInputs(instance), []);
});

test('0, 1 and 2+ wires: applicability, defaults and the multi-port note', () => {
  const { instance } = setup();
  instance.parameters.speed = 5;
  instance.parameters.colour = '#f00';
  instance.parameters.unused = 'x';
  // A parameter that matches no component input is not an override of anything.
  instance.parameters.notAnInput = 1;

  const byName = Object.fromEntries(overriddenInputs(instance).map((o) => [o.name, o]));
  assert.deepEqual(Object.keys(byName).sort(), ['colour', 'speed', 'unused']);

  assert.equal(byName.speed.applicable, true);
  assert.equal(byName.speed.value, 5);
  assert.equal(byName.speed.defaultValue, 2);
  assert.equal(byName.speed.note, undefined);
  assert.deepEqual(byName.speed.targets, [{ nodeId: 'spinner', nodeLabel: 'Spinner', property: 'rate' }]);

  assert.equal(byName.colour.applicable, true);
  assert.equal(byName.colour.defaultValue, '#000', 'both inner ports agree, so the default is reported');
  assert.match(byName.colour.note!, /2 ports/);
  assert.equal(byName.colour.targets.length, 2);

  assert.equal(byName.unused.applicable, false);
  assert.match(byName.unused.reason!, /Nothing inside/);
  assert.equal(byName.unused.targets.length, 0);
});

test('apply writes the inner parameter and clears the instance in ONE undo entry; undo restores both', () => {
  const { spinner, instance, other, queue } = setup();
  instance.parameters.speed = 5;
  assert.equal(other.getParameter('speed'), 2, 'the untouched instance starts on the component value');

  const result = applyOverrides(instance, ['speed'], { undoQueue: queue })!;
  assert.ok(result);
  assert.deepEqual(result.names, ['speed']);
  assert.deepEqual(result.writes, [{ nodeId: 'spinner', property: 'rate', value: 5 }]);
  assert.equal(spinner.parameters.rate, 5);
  assert.equal(instance.parameters.speed, undefined);
  assert.equal(instance.getParameter('speed'), 5, 'the instance shows the same value it had');
  assert.equal(other.getParameter('speed'), 5, 'an instance that never overrode it picks up the new default');
  assert.equal(queue.getHistory().length, 1);
  assert.equal(queue.getHistory()[0].label, APPLY_LABEL);
  assert.deepEqual(overriddenInputs(instance), []);

  queue.undo();
  assert.equal(spinner.parameters.rate, 2);
  assert.equal(instance.parameters.speed, 5);
  assert.equal(other.getParameter('speed'), 2);

  queue.redo();
  assert.equal(spinner.parameters.rate, 5);
  assert.equal(instance.parameters.speed, undefined);
});

test('apply with 2+ wires writes every inner port, each with its own copy of the value', () => {
  const { labelA, labelB, instance, queue } = setup();
  const value = { r: 1, g: 0, b: 0 };
  instance.parameters.colour = value;

  const result = applyOverrides(instance, ['colour'], { undoQueue: queue })!;
  assert.equal(result.writes.length, 2);
  assert.deepEqual(labelA.parameters.color, value);
  assert.deepEqual(labelB.parameters.color, value);
  assert.notEqual(labelA.parameters.color, labelB.parameters.color, 'no shared object between nodes');
  assert.equal(instance.parameters.colour, undefined);

  queue.undo();
  assert.equal(labelA.parameters.color, undefined);
  assert.equal(labelB.parameters.color, undefined);
  assert.deepEqual(instance.parameters.colour, value);
});

test('apply all: several names land in one group, inapplicable ones are skipped with a reason', () => {
  const { spinner, labelA, instance, queue } = setup();
  instance.parameters.speed = 9;
  instance.parameters.colour = '#0f0';
  instance.parameters.unused = 'x';

  const result = applyOverrides(instance, ['speed', 'colour', 'unused', 'missing'], { undoQueue: queue })!;
  assert.deepEqual(result.names, ['speed', 'colour']);
  assert.deepEqual(
    result.skipped.map((s) => s.name),
    ['unused', 'missing']
  );
  assert.equal(queue.getHistory().length, 1);
  assert.equal(spinner.parameters.rate, 9);
  assert.equal(labelA.parameters.color, '#0f0');
  assert.equal(instance.parameters.unused, 'x', 'a skipped override is left on the instance');

  queue.undo();
  assert.equal(spinner.parameters.rate, 2);
  assert.equal(labelA.parameters.color, undefined);
  assert.equal(instance.parameters.speed, 9);
  assert.equal(instance.parameters.colour, '#0f0');
});

test('apply with nothing applicable pushes no undo entry', () => {
  const { instance, queue } = setup();
  instance.parameters.unused = 'x';
  assert.equal(applyOverrides(instance, ['unused'], { undoQueue: queue }), null);
  assert.equal(applyOverrides(instance, [], { undoQueue: queue }), null);
  assert.equal(queue.getHistory().length, 0);
  assert.equal(instance.parameters.unused, 'x');
});

test('revert clears instance values in one entry, leaves the component alone, and undoes', () => {
  const { spinner, instance, queue } = setup();
  instance.parameters.speed = 5;
  instance.parameters.unused = 'x';

  const result = revertOverrides(instance, ['speed', 'unused', 'missing'], { undoQueue: queue })!;
  assert.deepEqual(result.names, ['speed', 'unused']);
  assert.deepEqual(result.skipped.map((s) => s.name), ['missing']);
  assert.equal(queue.getHistory().length, 1);
  assert.equal(queue.getHistory()[0].label, REVERT_LABEL);
  assert.equal(instance.parameters.speed, undefined);
  assert.equal(instance.getParameter('speed'), 2, 'falls back to the component value');
  assert.equal(spinner.parameters.rate, 2);

  queue.undo();
  assert.equal(instance.parameters.speed, 5);
  assert.equal(instance.parameters.unused, 'x');

  assert.equal(revertOverrides(instance, ['notSet'], { undoQueue: queue }), null);
});

test('a custom label names the undo entry', () => {
  const { instance, queue } = setup();
  instance.parameters.speed = 3;
  applyOverrides(instance, ['speed'], { undoQueue: queue, label: 'Apply speed to /Slot/Reels' });
  assert.equal(queue.getHistory()[0].label, 'Apply speed to /Slot/Reels');
});

test('visual-state values are listed but never applied', () => {
  const { spinner, instance, queue } = setup();
  instance.stateParameters = { hover: { speed: 7 } };

  const overrides = overriddenInputs(instance);
  assert.equal(overrides.length, 1);
  assert.equal(overrides[0].state, 'hover');
  assert.equal(overrides[0].applicable, false);
  assert.match(overrides[0].reason!, /visual state/);

  assert.equal(applyOverrides(instance, ['speed'], { undoQueue: queue }), null);
  assert.equal(spinner.parameters.rate, 2);
  assert.deepEqual(instance.stateParameters, { hover: { speed: 7 } });
});

test('a variant that also sets the input blocks apply, since the instance would change', () => {
  const { spinner, instance, queue } = setup();
  instance.parameters.speed = 5;
  instance.variant = { parameters: { speed: 11 } };
  instance.variantName = 'Fast';

  const [entry] = overriddenInputs(instance);
  assert.equal(entry.applicable, false);
  assert.match(entry.reason!, /"Fast" variant/);
  assert.equal(applyOverrides(instance, ['speed'], { undoQueue: queue }), null);
  assert.equal(spinner.parameters.rate, 2);
});

test('a wire straight to a component output has nothing inside to write', () => {
  const { component, inputs, instance } = setup();
  const outputs = component.graph.add(
    new FakeNode('outputs', { name: 'Component Outputs', haveComponentPorts: true }, {
      ports: [{ name: 'echo', plug: 'input' }]
    })
  );
  inputs.ports.push({ name: 'passthrough', plug: 'output' });
  component.graph.connect(inputs, 'passthrough', outputs, 'echo');
  instance.parameters.passthrough = 1;

  const [entry] = overriddenInputs(instance);
  assert.equal(entry.name, 'passthrough');
  assert.equal(entry.applicable, false);
  assert.match(entry.reason!, /component output/);
});

test('a wire whose inner port no longer exists does not count', () => {
  const { component, inputs, instance } = setup();
  const ghost = component.graph.add(new FakeNode('ghost', textType, { ports: [] }));
  inputs.ports.push({ name: 'stale', plug: 'output' });
  component.graph.connect(inputs, 'stale', ghost, 'removedPort');
  instance.parameters.stale = 1;

  const [entry] = overriddenInputs(instance);
  assert.equal(entry.applicable, false);
});

test('formatOverrideValue keeps previews short and readable', () => {
  assert.equal(formatOverrideValue(12), '12');
  assert.equal(formatOverrideValue(true), 'true');
  assert.equal(formatOverrideValue(''), '""');
  assert.equal(formatOverrideValue(undefined), '—');
  assert.equal(formatOverrideValue({ value: 12, unit: 'px' }), '12px');
  assert.equal(formatOverrideValue('a'.repeat(40), 10), 'aaaaaaaaa…');
  assert.equal(formatOverrideValue([1, 2]), '[1,2]');
});
