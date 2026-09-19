const NodeContext = require('../src/nodecontext');
const NodeDefinition = require('../src/nodedefinition');
const NodeScript = require('../src/nodescript');
const ComponentInstance = require('../src/nodes/componentinstance');
const ComponentModel = require('../src/models/componentmodel');

// A script override is compiled on its own, away from the file the node was
// written in. These tests pin what it can still call by name: the Babel helpers
// transpiled sources use, and the node definition's own `scriptScope`.

const HELPER_NAMES = Object.keys(NodeScript.ENGINE_SCRIPT_HELPERS);

describe('evaluateNodeScript scope', () => {
  test('a method can call a helper from the node scope', () => {
    const requestRender = jest.fn();
    const definition = NodeScript.evaluateNodeScript(
      'const Reel = { methods: { redraw() { requestRender(this); return "drawn"; } } };',
      null,
      { requestRender }
    );

    const nodeLike = { id: 'n1' };
    expect(definition.methods.redraw.call(nodeLike)).toBe('drawn');
    expect(requestRender).toHaveBeenCalledTimes(1);
    expect(requestRender).toHaveBeenCalledWith(nodeLike);
  });

  test('Babel helpers are callable with no node scope', () => {
    const definition = NodeScript.evaluateNodeScript(
      [
        'const Node = {',
        '  methods: {',
        '    describe(value) { return _typeof(value); },',
        '    merge(a) { return _objectSpread(_objectSpread({}, a), {}, { c: 3 }); },',
        '    pair(list) { var _p = _slicedToArray(list, 2), x = _p[0], y = _p[1]; return x + y; },',
        '    copy(set) { return _toConsumableArray(set); }',
        '  }',
        '};'
      ].join('\n'),
      null
    );

    expect(definition.methods.describe('s')).toBe('string');
    expect(definition.methods.describe(null)).toBe('object');
    expect(definition.methods.merge({ a: 1, b: 2 })).toEqual({ a: 1, b: 2, c: 3 });
    expect(definition.methods.pair([4, 5, 6])).toBe(9);
    expect(definition.methods.copy(new Set([1, 2]))).toEqual([1, 2]);
  });

  test('names that collide with the fixed parameters or are not identifiers are ignored', () => {
    const fn = () => 'scope';
    const scope = { XGENIA: 'not the api', class: fn, '1abc': fn, 'odd-name': fn, eval: fn, good: fn };

    expect(NodeScript.scriptScopeNames(scope)).toEqual(HELPER_NAMES.concat(['good']));

    const definition = NodeScript.evaluateNodeScript(
      'const Node = { methods: { api() { return XGENIA; }, call() { return good(); } } };',
      null,
      scope
    );
    expect(definition.methods.api()).not.toBe('not the api');
    expect(definition.methods.call()).toBe('scope');
  });

  test('scriptScopeNames lists the helpers first, then the node scope', () => {
    const scope = { requestRender() {}, PIXI: {}, _typeof: () => 'overridden' };

    expect(NodeScript.scriptScopeNames(scope)).toEqual(HELPER_NAMES.concat(['requestRender', 'PIXI']));
    expect(NodeScript.scriptScopeNames()).toEqual(HELPER_NAMES);
    expect(NodeScript.scriptScopeNames(undefined)).toEqual(HELPER_NAMES);

    // The node scope overlays a helper of the same name.
    const definition = NodeScript.evaluateNodeScript('({ methods: { t(v) { return _typeof(v); } } })', null, scope);
    expect(definition.methods.t(1)).toBe('overridden');
  });

  test('a helper whose value is missing is not passed in', () => {
    expect(NodeScript.scriptScopeNames({ requestRender: undefined, tickerAdd() {} })).toEqual(
      HELPER_NAMES.concat(['tickerAdd'])
    );
  });

  test('the Babel helpers the list promises are all there', () => {
    [
      '_typeof',
      '_objectSpread',
      '_objectSpread2',
      '_defineProperty',
      'ownKeys',
      '_slicedToArray',
      '_toConsumableArray',
      '_classCallCheck',
      '_createClass',
      '_arrayLikeToArray',
      '_unsupportedIterableToArray',
      '_iterableToArray',
      '_iterableToArrayLimit',
      '_arrayWithHoles',
      '_arrayWithoutHoles',
      '_nonIterableRest',
      '_nonIterableSpread'
    ].forEach((name) => expect(typeof NodeScript.ENGINE_SCRIPT_HELPERS[name]).toBe('function'));

    const h = NodeScript.ENGINE_SCRIPT_HELPERS;
    expect(h._defineProperty({}, 'k', 1)).toEqual({ k: 1 });
    expect(h._slicedToArray('abc', 2)).toEqual(['a', 'b']);
    expect(h._slicedToArray(new Map([[1, 2]]), 1)).toEqual([[1, 2]]);
    expect(() => h._slicedToArray(5, 1)).toThrow(TypeError);
    expect(() => h._toConsumableArray(null)).toThrow(TypeError);

    function Point() {
      h._classCallCheck(this, Point);
    }
    h._createClass(Point, [{ key: 'kind', value: function () { return 'point'; } }]);
    expect(new Point().kind()).toBe('point');
    expect(() => h._classCallCheck({}, Point)).toThrow(TypeError);
  });

  test('a script that declares a scope name itself keeps its own declaration', () => {
    const scopeFn = jest.fn(() => 'scope');
    const definition = NodeScript.evaluateNodeScript(
      [
        'const requestRender = () => "own";',
        'class _classCallCheck {}',
        'const Node = { methods: { r() { return requestRender(this) + typeof _classCallCheck; } } };'
      ].join('\n'),
      null,
      { requestRender: scopeFn }
    );

    expect(definition.methods.r()).toBe('ownfunction');
    expect(scopeFn).not.toHaveBeenCalled();
  });

  test('a real syntax error still throws', () => {
    expect(() => NodeScript.evaluateNodeScript('const Node = { methods: { r() { return ( } } };', null, { PIXI: {} })).toThrow(
      SyntaxError
    );
  });
});

describe('scriptScope on a node definition', () => {
  function makeDefinition(scope) {
    const imported = (node) => node; // stands in for a module import the script can't see
    return {
      name: 'Scope Test',
      category: 'test',
      scriptScope: scope,
      initialize() {
        this._internal.renders = 0;
      },
      inputs: {
        value: {
          type: 'number',
          set(value) {
            this._internal.value = value;
            this.redraw();
          }
        }
      },
      outputs: {
        renders: {
          type: 'number',
          getter() {
            return this._internal.renders;
          }
        }
      },
      methods: {
        redraw() {
          imported(this);
          this._internal.renders++;
        }
      }
    };
  }

  async function build(definition, parameters) {
    const context = new NodeContext();
    const nodeDefinition = NodeDefinition.defineNode(definition);
    context.nodeRegister.register(nodeDefinition);

    const componentModel = await ComponentModel.createFromExportData({
      name: 'c',
      id: 'c1',
      nodes: [{ id: 'n', type: 'Scope Test', parameters: parameters || {} }],
      connections: []
    });
    const componentInstance = new ComponentInstance(context);
    await componentInstance.setComponentModel(componentModel);
    context.update();

    const node = componentInstance.nodeScope.getNodeWithId('n');
    const warnings = [];
    context.editorConnection = {
      sendWarning: (component, id, key, warning) => warnings.push(warning.message),
      clearWarning: () => {},
      isConnected: () => false
    };

    return {
      node,
      context,
      nodeDefinition,
      warnings,
      defaultSource: context.getDefaultValueForInput('Scope Test', 'functionScript'),
      setScript(script) {
        componentModel.getNodeWithId('n').setParameter('functionScript', script);
        context.update();
      }
    };
  }

  test('an override that calls a scope helper runs it instead of falling back', async () => {
    const requestRender = jest.fn();
    const { node, setScript, warnings, defaultSource } = await build(makeDefinition({ requestRender }), { value: 1 });

    expect(defaultSource).toContain('imported(this);');
    setScript(defaultSource.replace('imported(this);', 'requestRender(this);'));

    node.queueInput('value', 2);
    node.context.update();

    expect(requestRender).toHaveBeenCalledWith(node);
    expect(warnings.join('\n')).not.toMatch(/falling back/);
  });

  test('without the scope the same override falls back to the built-in (the export 1789661242337 failure)', async () => {
    const { node, setScript, warnings, defaultSource } = await build(makeDefinition(undefined), { value: 1 });

    setScript(defaultSource.replace('imported(this);', 'requestRender(this);'));
    node.queueInput('value', 2);
    node.context.update();

    expect(warnings.join('\n')).toMatch(/requestRender is not defined/);
    expect(warnings.join('\n')).toMatch(/falling back/);
  });

  test('a live node reports its scope names, and scriptScope is not a port', async () => {
    const scope = { requestRender() {}, PIXI: {} };
    const { node, nodeDefinition, defaultSource } = await build(makeDefinition(scope));

    expect(node.scriptScopeNames()).toEqual(NodeScript.scriptScopeNames(scope));
    expect(node.scriptScopeNames()).toEqual(HELPER_NAMES.concat(['requestRender', 'PIXI']));

    expect(nodeDefinition.metadata.inputs.scriptScope).toBeUndefined();
    expect(nodeDefinition.metadata.outputs.scriptScope).toBeUndefined();
    expect(node.hasInput('scriptScope')).toBe(false);

    // Neither the scope nor the discovery method leaks into the editable source.
    expect(defaultSource).not.toMatch(/scriptScope/);
  });

  test('a node with no scriptScope still answers with the engine helpers', async () => {
    const { node } = await build(makeDefinition(undefined));
    expect(node.scriptScopeNames()).toEqual(HELPER_NAMES);
  });
});
