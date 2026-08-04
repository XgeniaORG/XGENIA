const NodeContext = require('../src/nodecontext');
const NodeDefinition = require('../src/nodedefinition');
const NodeScript = require('../src/nodescript');
const ComponentInstance = require('../src/nodes/componentinstance');
const ComponentModel = require('../src/models/componentmodel');

// A node whose behaviour is spread over every surface a script can override:
// an input setter, a signal input, a method, an output getter and initialize.
function makeDefinition() {
  return {
    name: 'Script Test',
    category: 'test',
    initialize() {
      this._internal.value = 0;
      this._internal.offset = 100;
    },
    inputs: {
      value: {
        type: 'number',
        displayName: 'Value',
        set(value) {
          this._internal.value = this.transform(value);
          this.flagOutputDirty('result');
        }
      },
      bump: {
        type: 'signal',
        displayName: 'Bump',
        valueChangedToTrue() {
          this._internal.value = this._internal.value + 1;
          this.flagOutputDirty('result');
        }
      }
    },
    outputs: {
      result: {
        type: 'number',
        displayName: 'Result',
        getter() {
          return this._internal.value;
        }
      }
    },
    methods: {
      transform(value) {
        return Number(value) || 0;
      }
    }
  };
}

const DEFAULT_SCRIPT = NodeScript.reconstructNodeSource(makeDefinition());

async function build(parameters) {
  const context = new NodeContext();
  context.nodeRegister.register(NodeDefinition.defineNode(makeDefinition()));

  const componentModel = await ComponentModel.createFromExportData({
    name: 'c',
    id: 'c1',
    nodes: [{ id: 'n', type: 'Script Test', parameters: parameters || {} }],
    connections: []
  });

  const componentInstance = new ComponentInstance(context);
  await componentInstance.setComponentModel(componentModel);
  context.update();

  const node = componentInstance.nodeScope.getNodeWithId('n');

  return {
    node,
    model: componentModel.getNodeWithId('n'),
    context,
    result: () => node.getOutput('result').value,
    setScript: (script) => {
      componentModel.getNodeWithId('n').setParameter('functionScript', script);
      context.update();
    }
  };
}

/** The default script with one function swapped for another. */
function editDefault(from, to) {
  expect(DEFAULT_SCRIPT).toContain(from);
  return DEFAULT_SCRIPT.replace(from, to);
}

describe('the generated Script source', () => {
  test('is valid JavaScript that evaluates back to a definition', () => {
    const definition = NodeScript.evaluateNodeScript(DEFAULT_SCRIPT, null);

    expect(NodeScript.isNodeDefinition(definition)).toBe(true);
    expect(definition.name).toBe('Script Test');
    expect(typeof definition.inputs.value.set).toBe('function');
    expect(typeof definition.inputs.bump.valueChangedToTrue).toBe('function');
    expect(typeof definition.outputs.result.getter).toBe('function');
    expect(typeof definition.methods.transform).toBe('function');
    expect(typeof definition.initialize).toBe('function');
  });

  test('survives names, quotes and newlines that broke the old reconstruction', () => {
    const source = NodeScript.reconstructNodeSource({
      name: 'String Format',
      category: 'test',
      docs: "it's a node",
      inputs: {
        template: { type: 'string', default: 'line one\nline two', set(v) { this._internal.v = v; } },
        'odd-name': { type: 'string', set(v) { this._internal.o = v; } }
      }
    });

    const definition = NodeScript.evaluateNodeScript(source, null);
    expect(definition.name).toBe('String Format');
    expect(definition.docs).toBe("it's a node");
    expect(definition.inputs.template.default).toBe('line one\nline two');
    expect(typeof definition.inputs['odd-name'].set).toBe('function');
  });

  test('is compared whitespace- and shorthand-insensitively', () => {
    expect(NodeScript.sameFunctionSource('set(v) { return v; }', 'function (v) {\n  return v;\n}')).toBe(true);
    expect(NodeScript.sameFunctionSource('set(v) { return v; }', 'function (v) { return v + 1; }')).toBe(false);
  });
});

describe('editing the Script property', () => {
  test('an unedited script changes nothing', async () => {
    const { setScript, result, node } = await build({ value: 21 });

    expect(result()).toBe(21);

    setScript(DEFAULT_SCRIPT);

    expect(result()).toBe(21);
    expect(node._internal.__nodeScriptOverride).toBeUndefined();
  });

  test('an edited input setter replaces the original behaviour', async () => {
    const { setScript, result } = await build({ value: 21 });

    expect(result()).toBe(21);

    setScript(
      editDefault('this._internal.value = this.transform(value);', 'this._internal.value = this.transform(value) * 2;')
    );

    expect(result()).toBe(42);
  });

  test('an edited method replaces the original behaviour', async () => {
    // Methods land on the prototype as non-writable properties — this is the
    // case that plain assignment would silently fail to override.
    const { setScript, result } = await build({ value: 4 });

    expect(result()).toBe(4);

    setScript(editDefault('return Number(value) || 0;', 'return (Number(value) || 0) * 10;'));

    expect(result()).toBe(40);
  });

  test('an edited output getter replaces the original behaviour', async () => {
    const { setScript, result } = await build({ value: 7 });

    setScript(editDefault('return this._internal.value;', 'return this._internal.value + this._internal.offset;'));

    expect(result()).toBe(107);
  });

  test('an edited initialize runs against the live node', async () => {
    const { setScript, node } = await build({ value: 7 });

    expect(node._internal.offset).toBe(100);

    setScript(editDefault('this._internal.offset = 100;', 'this._internal.offset = 5;'));

    expect(node._internal.offset).toBe(5);
  });

  test('an edited signal input replaces the original behaviour, without firing it', async () => {
    const { setScript, result, node } = await build({ value: 1 });

    setScript(editDefault('this._internal.value = this._internal.value + 1;', 'this._internal.value = this._internal.value + 10;'));

    expect(result()).toBe(1); // saving must not send the signal

    node.queueInput('bump', true);
    node.queueInput('bump', false);
    node.context.update();

    expect(result()).toBe(11);
  });

  test('stored parameters still reach an overridden setter on load', async () => {
    const { result } = await build({
      value: 21,
      functionScript: editDefault(
        'this._internal.value = this.transform(value);',
        'this._internal.value = this.transform(value) * 3;'
      )
    });

    expect(result()).toBe(63);
  });

  test('clearing the property restores the built-in behaviour', async () => {
    const { setScript, model, context, result } = await build({ value: 21 });

    setScript(editDefault('this._internal.value = this.transform(value);', 'this._internal.value = this.transform(value) * 2;'));
    expect(result()).toBe(42);

    model.setParameter('functionScript', undefined);
    context.update();

    expect(result()).toBe(21);
  });

  test('successive edits do not stack', async () => {
    const { setScript, result } = await build({ value: 5 });

    setScript(editDefault('return Number(value) || 0;', 'return (Number(value) || 0) + 1;'));
    expect(result()).toBe(6);

    setScript(editDefault('return Number(value) || 0;', 'return (Number(value) || 0) + 2;'));
    expect(result()).toBe(7);
  });

  test('a script that fails to evaluate keeps the node running and reports a warning', async () => {
    const warnings = [];
    const { node, setScript, result } = await build({ value: 21 });

    node.context.editorConnection = {
      sendWarning: (component, id, key, warning) => warnings.push({ id, key, warning }),
      clearWarning: () => {},
      isConnected: () => false
    };

    setScript(DEFAULT_SCRIPT.replace('const ScriptTest = {', 'const ScriptTest = { ['));

    expect(result()).toBe(21);
    expect(warnings.length).toBe(1);
    expect(warnings[0].key).toBe(NodeScript.WARNING_KEY);
    expect(warnings[0].warning.message).toMatch(/Script error/);
  });

  test('an error thrown by an edited function is reported, not thrown at the graph', async () => {
    const warnings = [];
    const { node, setScript, result } = await build({ value: 21 });

    node.context.editorConnection = {
      sendWarning: (component, id, key, warning) => warnings.push(warning),
      clearWarning: () => {},
      isConnected: () => false
    };

    expect(() =>
      setScript(editDefault('return Number(value) || 0;', 'return notDefinedAnywhere(value);'))
    ).not.toThrow();

    const messages = warnings.map((w) => w.message).join('\n');
    expect(messages).toMatch(/notDefinedAnywhere/);

    // …and the node keeps working: a member that throws hands back to the
    // built-in implementation instead of quietly doing nothing.
    expect(messages).toMatch(/falling back to the built-in implementation/);
    expect(result()).toBe(21);
  });

  test('a function that needs the original file scope falls back to the built-in', async () => {
    // Re-compiled functions lose the closure they were written in. This is the
    // shape that matters in a published game, where the minified baseline can't
    // be matched and even untouched functions get applied.
    const helper = (value) => value * 2; // only reachable from the original scope
    const context = new NodeContext();
    context.nodeRegister.register(
      NodeDefinition.defineNode({
        name: 'Closure Test',
        category: 'test',
        initialize() {
          this._internal.value = 0;
        },
        inputs: {
          value: {
            type: 'number',
            set(value) {
              this._internal.value = helper(value);
              this.flagOutputDirty('result');
            }
          }
        },
        outputs: {
          result: {
            type: 'number',
            getter() {
              return this._internal.value;
            }
          }
        }
      })
    );

    const componentModel = await ComponentModel.createFromExportData({
      name: 'c',
      id: 'c1',
      nodes: [{ id: 'n', type: 'Closure Test', parameters: { value: 4 } }],
      connections: []
    });
    const componentInstance = new ComponentInstance(context);
    await componentInstance.setComponentModel(componentModel);
    context.update();

    const node = componentInstance.nodeScope.getNodeWithId('n');
    expect(node.getOutput('result').value).toBe(8);

    const source = context.getDefaultValueForInput('Closure Test', 'functionScript');
    componentModel.getNodeWithId('n').setParameter('functionScript', source.replace('helper(value)', 'helper(value) /* edited */'));
    context.update();

    expect(node.getOutput('result').value).toBe(8);
  });

  test('a plain script body still runs as a script (unchanged legacy behaviour)', async () => {
    const { node, setScript } = await build({ value: 1 });

    setScript('Outputs.doubled = (Inputs.value || 0) * 2;');

    expect(typeof node._internal.func).toBe('function');
  });
});
