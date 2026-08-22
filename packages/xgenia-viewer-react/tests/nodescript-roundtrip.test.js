// The Script property is generated from a node's own definition, so the
// generated source has to survive the shapes the visual/UI nodes use: setters
// generated in loops, shared frame/dimension/margin ports, methods that return
// React components. An unedited script must round-trip to a definition whose
// every function still compares equal to the original — otherwise saving one
// would re-apply (and break) functions the user never touched.
// Shared port definitions read the XGENIA global while the module loads.
global.XGENIA = global.XGENIA || { deployed: false };

const NodeScript = require('@xgenia/runtime/src/nodescript');

const MODULES = {
  Group: () => require('../src/nodes/visual/group.js'),
  Text: () => require('../src/nodes/visual/text.js'),
  Image: () => require('../src/nodes/visual/image.js'),
  Circle: () => require('../src/nodes/visual/circle.js'),
  Columns: () => require('../src/nodes/visual/columns.js'),
  Button: () => require('../src/nodes/controls/button.ts'),
  TextInput: () => require('../src/nodes/controls/text-input.ts'),
  Options: () => require('../src/nodes/controls/options.ts'),
  Page: () => require('../src/nodes/navigation/page.js')
};

function definitionOf(mod) {
  const value = mod && mod.default ? mod.default : mod;
  return value && value.node ? value.node : value;
}

function diffAgainstBaseline(definition) {
  const baseline = NodeScript.snapshotDefinition(definition);
  const source = NodeScript.reconstructNodeSource(definition);
  const evaluated = NodeScript.evaluateNodeScript(source, null);

  expect(NodeScript.isNodeDefinition(evaluated)).toBe(true);

  const changed = [];

  Object.keys(evaluated.inputs || {}).forEach((name) => {
    const spec = evaluated.inputs[name] || {};
    const base = baseline.inputs[name] || {};
    if (typeof spec.set === 'function' && !NodeScript.isUnchanged(spec.set, base.set)) changed.push('inputs.' + name + '.set');
    if (typeof spec.valueChangedToTrue === 'function' && !NodeScript.isUnchanged(spec.valueChangedToTrue, base.valueChangedToTrue)) {
      changed.push('inputs.' + name + '.valueChangedToTrue');
    }
  });

  Object.keys(evaluated.outputs || {}).forEach((name) => {
    const spec = evaluated.outputs[name] || {};
    const fn = spec.get || spec.getter;
    const base = baseline.outputs[name] || {};
    if (typeof fn === 'function' && !NodeScript.isUnchanged(fn, base.get)) changed.push('outputs.' + name);
  });

  Object.keys(evaluated.methods || {}).forEach((name) => {
    const fn = evaluated.methods[name];
    if (typeof fn === 'function' && !NodeScript.isUnchanged(fn, baseline.methods[name])) changed.push('methods.' + name);
  });

  if (typeof evaluated.initialize === 'function' && !NodeScript.isUnchanged(evaluated.initialize, baseline.initialize)) {
    changed.push('initialize');
  }

  return changed;
}

describe('generated Script source for visual and UI nodes', () => {
  Object.keys(MODULES).forEach((name) => {
    test(name + ' round-trips with no function reported as changed', () => {
      const definition = definitionOf(MODULES[name]());
      expect(definition && typeof definition).toBe('object');
      expect(diffAgainstBaseline(definition)).toEqual([]);
    });
  });

  // Runs last: defineNode() mutates the definition it is given.
  test('visual nodes get the Script property too — it is injected for every type', () => {
    const NodeDefinition = require('@xgenia/runtime/src/nodedefinition');
    const nodeDefinition = NodeDefinition.defineNode(definitionOf(MODULES.Group()));
    const port = nodeDefinition.metadata.inputs.functionScript;

    expect(port.displayName).toBe('Script');
    expect(typeof port.default).toBe('string');
    expect(port.default).toContain('const Group = {');
  });
});
