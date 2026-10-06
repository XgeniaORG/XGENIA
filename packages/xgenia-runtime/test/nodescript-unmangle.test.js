const NodeContext = require('../src/nodecontext');
const NodeDefinition = require('../src/nodedefinition');
const NodeScript = require('../src/nodescript');
const ComponentInstance = require('../src/nodes/componentinstance');
const ComponentModel = require('../src/models/componentmodel');

// 2026-09-17, export 1789661242337: in the editor's viewer bundle a node method
// calls an import as `(0,filterUtils/* requestRender */.sG)(this)`, and the
// default Script is that method's toString(). An edited function keeping it threw
// `filterUtils is not defined` and fell back to the built-in. The Script now
// names in-scope imports by their plain names, and the diff baseline gets the
// same rewrite so untouched functions still read as untouched.

const { unmangleImports } = NodeScript;

const CALL = '(0,filterUtils/* requestRender */.sG)(this)';

describe('unmangleImports', () => {
  const names = ['requestRender', 'tickerAdd', 'tickerRemove', 'gsap'];

  test('the concatenated-module call and value forms', () => {
    expect(unmangleImports(CALL + ';', names)).toBe('requestRender(this);');
    expect(unmangleImports('const f = filterUtils/* requestRender */.sG;', names)).toBe('const f = requestRender;');
    expect(unmangleImports('list.forEach(filterUtils/* requestRender */.sG)', names)).toBe('list.forEach(requestRender)');
    // A property access after the import stays: only `.os` is the mangled key.
    expect(unmangleImports('this._tween = gsap/* gsap */.os.to(obj, cfg);', names)).toBe('this._tween = gsap.to(obj, cfg);');
  });

  test('the module-variable production form, as the bundle writes it', () => {
    expect(
      unmangleImports('(0,_ticker_safety__WEBPACK_IMPORTED_MODULE_9__/* .tickerAdd */ .uD)(app.ticker, this._tickerFn);', names)
    ).toBe('tickerAdd(app.ticker, this._tickerFn);');
    expect(
      unmangleImports(
        'if (tickerFn) (0,_ticker_safety__WEBPACK_IMPORTED_MODULE_39__/* .tickerRemove */ .d3)(app === null || app === void 0 ? void 0 : app.ticker, tickerFn)',
        names
      )
    ).toBe('if (tickerFn) tickerRemove(app === null || app === void 0 ? void 0 : app.ticker, tickerFn)');
  });

  test('the development forms', () => {
    expect(unmangleImports('(0,_filterUtils__WEBPACK_IMPORTED_MODULE_3__.requestRender)(this)', names)).toBe('requestRender(this)');
    expect(unmangleImports('(0, _filterUtils__WEBPACK_IMPORTED_MODULE_3__["requestRender"])(this)', names)).toBe(
      'requestRender(this)'
    );
    expect(unmangleImports('cb = _filterUtils__WEBPACK_IMPORTED_MODULE_3__.requestRender;', names)).toBe('cb = requestRender;');
    // A namespace member that is not a scope name is not an import we can name.
    expect(unmangleImports('new pixi_js__WEBPACK_IMPORTED_MODULE_17__.Texture({})', names)).toBe(
      'new pixi_js__WEBPACK_IMPORTED_MODULE_17__.Texture({})'
    );
  });

  test('whitespace variants', () => {
    expect(unmangleImports('( 0 , filterUtils /*  requestRender  */ . sG )(this)', names)).toBe('requestRender(this)');
    expect(unmangleImports('(0,\n  filterUtils/* requestRender */.sG\n)(this)', names)).toBe('requestRender(this)');
  });

  test('names that are not in scope, default imports and look-alikes are left exactly as they are', () => {
    const untouched = [
      '(0,filterUtils/* safeString2Hex */.Y8)(color)',
      'PixiAppContext/* default */.A',
      '(0,layout/* default */.A)(x)',
      '_PixiUpdateManager__WEBPACK_IMPORTED_MODULE_1__/* ["default"] */ .A',
      '_m__WEBPACK_IMPORTED_MODULE_0___default()(x)',
      'a.filterUtils/* requestRender */.sG',
      'this.requestRender(this)',
      'requestRender(this)'
    ];
    untouched.forEach((text) => expect(unmangleImports(text, names.concat(['default']))).toBe(text));
  });

  test('`(0, ref)` that is an argument list stays an argument list', () => {
    expect(unmangleImports('schedule(0,filterUtils/* requestRender */.sG)', names)).toBe('schedule(0,requestRender)');
    expect(unmangleImports('fns[i](0, filterUtils/* requestRender */.sG)', names)).toBe('fns[i](0, requestRender)');
    // …but after a keyword it is the call wrapper.
    expect(unmangleImports('return(0,filterUtils/* requestRender */.sG)(this)', names)).toBe('return requestRender(this)');
    expect(unmangleImports('return (0,filterUtils/* requestRender */.sG)(this)', names)).toBe('return requestRender(this)');
    expect(unmangleImports('}\n(0,filterUtils/* requestRender */.sG)(this)', names)).toBe('}\nrequestRender(this)');
    expect(unmangleImports('if (x) (0,filterUtils/* requestRender */.sG)(this)', names)).toBe('if (x) requestRender(this)');
    expect(unmangleImports('fn()(0,filterUtils/* requestRender */.sG)', names)).toBe('fn()(0,requestRender)');
  });

  test('no names, an empty list or plain text is returned unchanged, and the rewrite is idempotent', () => {
    expect(unmangleImports(CALL)).toBe(CALL);
    expect(unmangleImports(CALL, [])).toBe(CALL);
    expect(unmangleImports(CALL, new Set())).toBe(CALL);
    expect(unmangleImports(CALL, new Set(['requestRender']))).toBe('requestRender(this)');

    const once = unmangleImports('a(); ' + CALL + '; (0,filterUtils/* safeString2Hex */.Y8)(c);', names);
    expect(unmangleImports(once, names)).toBe(once);
  });
});

/**
 * A definition shaped like a bundled pixi node: its method bodies carry the
 * webpack import forms verbatim (their toString() is exactly that text), and
 * they run as built-ins because the namespaces are in their closure.
 */
function bundledDefinition(scope, calls) {
  const make = new Function(
    'filterUtils',
    'ticker_safety',
    [
      'return {',
      '  redraw() {',
      '    (0,filterUtils/* requestRender */.sG)(this);',
      '    this._internal.renders++;',
      '  },',
      '  tint(color) {',
      '    return (0,filterUtils/* safeString2Hex */.Y8)(color);',
      '  },',
      '  start(app) {',
      '    (0,ticker_safety/* tickerAdd */.uD)(app.ticker, this._tickerFn);',
      '    return "started";',
      '  },',
      '  label() {',
      '    return "built-in";',
      '  }',
      '};'
    ].join('\n')
  );

  const methods = make(
    { sG: (node) => calls.push(['bundle.requestRender', node]), Y8: (c) => 'hex:' + c },
    { uD: () => calls.push(['bundle.tickerAdd']) }
  );

  return {
    name: 'Bundled Test',
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
    methods
  };
}

describe('the default Script of a bundled node', () => {
  test('names in-scope imports plainly and leaves the rest of the text alone', () => {
    const source = NodeScript.reconstructNodeSource(bundledDefinition({ requestRender() {}, tickerAdd() {} }, []));

    expect(source).toContain('    redraw: function () {\n      requestRender(this);\n      this._internal.renders++;\n    },');
    expect(source).toContain('tickerAdd(app.ticker, this._tickerFn);');
    expect(source).not.toContain('filterUtils/* requestRender */');
    // Not in the scope: kept as the bundle wrote it, so it reads as not callable.
    expect(source).toContain('(0,filterUtils/* safeString2Hex */.Y8)(color)');

    expect(NodeScript.isNodeDefinition(NodeScript.evaluateNodeScript(source, null, { requestRender() {} }))).toBe(true);
  });

  test('a node without a scriptScope gets the text it always did', () => {
    const plain = NodeScript.reconstructNodeSource(bundledDefinition(undefined, []));
    const scoped = NodeScript.reconstructNodeSource(bundledDefinition({ requestRender() {}, tickerAdd() {} }, []));

    expect(plain).toContain('    redraw: function () {\n      ' + CALL + ';\n      this._internal.renders++;\n    },');
    expect(plain).toContain('(0,ticker_safety/* tickerAdd */.uD)(app.ticker, this._tickerFn);');
    // The rewrite is the only difference between the two.
    expect(
      plain
        .replace(CALL, 'requestRender(this)')
        .replace('(0,ticker_safety/* tickerAdd */.uD)', 'tickerAdd')
    ).toBe(scoped);

    // And an ordinary definition is untouched by having a scope at all.
    const ordinary = {
      name: 'Ordinary',
      category: 'test',
      inputs: { v: { type: 'number', set(v) { this._internal.v = v; } } },
      methods: { go() { return this._internal.v * 2; } }
    };
    expect(NodeScript.reconstructNodeSource(Object.assign({ scriptScope: { requestRender() {} } }, ordinary))).toBe(
      NodeScript.reconstructNodeSource(ordinary)
    );
  });
});

describe('saving a bundled node\'s Script back', () => {
  async function build(scope) {
    const calls = [];
    const context = new NodeContext();
    context.nodeRegister.register(NodeDefinition.defineNode(bundledDefinition(scope, calls)));

    const componentModel = await ComponentModel.createFromExportData({
      name: 'c',
      id: 'c1',
      nodes: [{ id: 'n', type: 'Bundled Test', parameters: { value: 1 } }],
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
      calls,
      warnings,
      defaultSource: context.getDefaultValueForInput('Bundled Test', 'functionScript'),
      setScript(script) {
        componentModel.getNodeWithId('n').setParameter('functionScript', script);
        context.update();
      },
      overridden: () => (node._internal.__nodeScriptOverride ? node._internal.__nodeScriptOverride.restore.length : 0),
      ownMethods: () => ['redraw', 'tint', 'start', 'label'].filter((m) => Object.prototype.hasOwnProperty.call(node, m))
    };
  }

  const scopeFor = (calls) => ({
    requestRender: (node) => calls.push(['scope.requestRender', node]),
    tickerAdd: () => calls.push(['scope.tickerAdd'])
  });

  test('unchanged, through applyNodeScript with the scope: default, and nothing overridden', async () => {
    const scopeCalls = [];
    const scope = scopeFor(scopeCalls);
    const definition = bundledDefinition(scope, []);
    const baseline = NodeScript.snapshotDefinition(definition);
    const source = NodeScript.reconstructNodeSource(definition);
    const node = { name: 'n', _internal: {} };

    expect(NodeScript.applyNodeScript(node, source, { baseline, defaultSource: source, scope })).toBe('default');

    // Same functions without the default-source shortcut: every one compares unchanged.
    const reformatted = '// saved by the editor\n' + source.replace(/\n {4}/g, '\n\t\t');
    expect(NodeScript.applyNodeScript(node, reformatted, { baseline, defaultSource: source, scope })).toBe('definition');
    expect(node._internal.__nodeScriptOverride).toBeUndefined();

    // Without the rewrite on the built-in side, redraw would have read as edited.
    const saved = NodeScript.evaluateNodeScript(source, null, scope).methods.redraw;
    expect(NodeScript.sameFunctionSource(saved, definition.methods.redraw)).toBe(false);
    expect(NodeScript.isUnchanged(saved, baseline.methods.redraw)).toBe(true);
  });

  test('unchanged, on a live node: nothing overridden', async () => {
    const { setScript, defaultSource, overridden, ownMethods } = await build(scopeFor([]));

    setScript('// kept as is\n' + defaultSource);

    expect(overridden()).toBe(0);
    expect(ownMethods()).toEqual([]);
  });

  test('a script saved from the old bundled default also reads as unchanged', async () => {
    const { setScript, overridden } = await build(scopeFor([]));
    const oldDefault = NodeScript.reconstructNodeSource(bundledDefinition(undefined, []));
    expect(oldDefault).toContain(CALL);

    setScript(oldDefault);

    expect(overridden()).toBe(0);
  });

  test('editing one OTHER function overrides only that function', async () => {
    const { node, calls, setScript, defaultSource, overridden, ownMethods, warnings } = await build(scopeFor([]));

    setScript(defaultSource.replace('return "built-in";', 'return "edited";'));

    expect(ownMethods()).toEqual(['label']);
    expect(overridden()).toBe(1);
    expect(node.label()).toBe('edited');

    // redraw is still the built-in, closure and all.
    calls.length = 0;
    node.redraw();
    expect(calls).toEqual([['bundle.requestRender', node]]);
    expect(warnings.join('\n')).not.toMatch(/falling back/);
  });

  test('editing THAT function, keeping requestRender(this), compiles and calls the scope\'s requestRender', async () => {
    const scopeCalls = [];
    const { node, calls, setScript, defaultSource, ownMethods, warnings } = await build(scopeFor(scopeCalls));

    const edited = defaultSource.replace('this._internal.renders++;', 'this._internal.renders += 10;');
    expect(edited).toContain('requestRender(this);\n      this._internal.renders += 10;');
    setScript(edited);

    expect(ownMethods()).toEqual(['redraw']);

    const before = node._internal.renders;
    calls.length = 0;
    scopeCalls.length = 0;
    node.redraw();

    expect(scopeCalls).toEqual([['scope.requestRender', node]]);
    expect(calls).toEqual([]);
    expect(node._internal.renders).toBe(before + 10);
    expect(warnings.join('\n')).not.toMatch(/is not defined|falling back/);
  });

  test('an edited function that keeps an import that is NOT in scope still falls back, visibly', async () => {
    const { node, setScript, defaultSource, warnings } = await build(scopeFor([]));

    setScript(defaultSource.replace('return (0,filterUtils/* safeString2Hex */.Y8)(color);', 'return (0,filterUtils/* safeString2Hex */.Y8)(color) + "!";'));

    expect(node.tint('red')).toBe('hex:red');
    expect(warnings.join('\n')).toMatch(/filterUtils is not defined/);
    expect(warnings.join('\n')).toMatch(/falling back/);
  });
});

describe('pixi.js namespace members become PIXI.<name> when PIXI is in scope', () => {
  const { unmangleImports } = NodeScript;

  test('dev form and commented production form, wrapper kept', () => {
    expect(unmangleImports('new pixi_js__WEBPACK_IMPORTED_MODULE_17__.Texture(src)', ['PIXI']))
      .toBe('new PIXI.Texture(src)');
    expect(unmangleImports('(0,pixi_js__WEBPACK_IMPORTED_MODULE_2__/* .Rectangle */ .M_)(0, 0, w, h)', ['PIXI']))
      .toBe('(0,PIXI.Rectangle)(0, 0, w, h)');
    expect(unmangleImports('pixi_js__WEBPACK_IMPORTED_MODULE_17__["Graphics"]', ['PIXI']))
      .toBe('PIXI.Graphics');
  });

  test('left alone without PIXI in scope, for a non-pixi namespace, and for a member access', () => {
    const src = 'new pixi_js__WEBPACK_IMPORTED_MODULE_17__.Texture(src)';
    expect(unmangleImports(src, ['requestRender'])).toBe(src);
    expect(unmangleImports('gsap__WEBPACK_IMPORTED_MODULE_3__.to(x)', ['PIXI'])).toBe('gsap__WEBPACK_IMPORTED_MODULE_3__.to(x)');
    expect(unmangleImports('a.pixi_js__WEBPACK_IMPORTED_MODULE_17__.Texture', ['PIXI'])).toBe('a.pixi_js__WEBPACK_IMPORTED_MODULE_17__.Texture');
  });

  test('a plain scope name and a PIXI member in the same body are both rewritten', () => {
    expect(unmangleImports('(0,filterUtils/* requestRender */.sG)(this); new pixi_js__WEBPACK_IMPORTED_MODULE_17__.Sprite(t);', ['PIXI', 'requestRender']))
      .toBe('requestRender(this); new PIXI.Sprite(t);');
  });
});
