const ExpressionNode = require('../../src/nodes/std-library/expression').node;

// (2026-09-22, export 1790026115336) Two engine defects in the Expression node made the engine
// report impossible facts, which the AI then chased for an hour:
//
//   1. parsePorts turned EVERY identifier into an input port, including JavaScript's own globals.
//      `Date.now()` became `Function('Date', 'return (Date.now())')` with `Date` unwired, so the
//      real global was shadowed by `undefined` and the run failed with
//      `TypeError: Date.now is not a function`. Only 'Math' happened to be exempt.
//   2. The run-time catch called `logJavaScriptNodeError`, which the file never imported — so a
//      failing expression threw `ReferenceError: logJavaScriptNodeError is not defined` from its
//      own handler and the editorConnection.sendWarning after it was never reached.

function makeNode(opts = {}) {
  const warnings = [];
  const ctx = {
    id: 'expr-1',
    _internal: {},
    _inputValues: {},
    _inputs: {},
    nodeScope: { componentOwner: { name: '/App' } },
    context: {
      editorConnection: { sendWarning: (...a) => warnings.push(a) },
      isWarningTypeEnabled: () => true,
    },
    hasInput(name) { return Object.prototype.hasOwnProperty.call(this._inputs, name); },
    registerInput(name, def) { this._inputs[name] = def; },
    deregisterInput(name) { delete this._inputs[name]; },
    isInputConnected() { return opts.runConnected || false; },
    flagDirty() {},
    flagOutputDirty() {},
    sendSignalOnOutput() {},
    scheduleAfterInputsHaveUpdated(fn) { fn.call(this); },
    warnings,
  };
  for (const [name, ext] of Object.entries(ExpressionNode.prototypeExtensions)) ctx[name] = ext.value;
  ExpressionNode.initialize.call(ctx);
  return ctx;
}
const setExpression = (n, expr) => ExpressionNode.inputs.expression.set.call(n, expr);
const setInput = (n, name, v) => n._inputs[name].set.call(n, v);

describe('Expression ports vs JavaScript globals', () => {
  test('Date.now() does not become an input port, and evaluates as JavaScript', () => {
    const n = makeNode({ runConnected: true });
    setExpression(n, 'Date.now() > 0 ? x + 1 : -1');
    expect(Object.keys(n._inputs)).toEqual(['x']);
    setInput(n, 'x', 41);
    expect(n._calculateExpression()).toBe(42);
    expect(n.warnings).toHaveLength(0);
  });

  test('the other standard globals are left to JavaScript too', () => {
    const n = makeNode({ runConnected: true });
    setExpression(n, 'JSON.stringify([Number(a), parseInt(b), Math.max(a, b), String(c), isNaN(NaN)])');
    expect(Object.keys(n._inputs).sort()).toEqual(['a', 'b', 'c']);
    setInput(n, 'a', 1); setInput(n, 'b', '7'); setInput(n, 'c', 'abc');
    expect(n._calculateExpression()).toBe('[1,7,7,"abc",true]');
  });

  test('ordinary names still become ports — that is the node\'s job', () => {
    const n = makeNode({ runConnected: true });
    setExpression(n, 'balance - bet * lines');
    expect(Object.keys(n._inputs).sort()).toEqual(['balance', 'bet', 'lines']);
  });
});

describe('Expression run-time errors reach the editor', () => {
  test('a failing expression reports the REAL error to the editor instead of throwing from its handler', () => {
    const n = makeNode({ runConnected: true });
    setExpression(n, 'foo.bar');
    setInput(n, 'foo', null);
    let result;
    expect(() => { result = n._calculateExpression(); }).not.toThrow();
    expect(result).toBe(0);
    expect(n.warnings).toHaveLength(1);
    const [component, nodeId, key, payload] = n.warnings[0];
    expect(component).toBe('/App');
    expect(nodeId).toBe('expr-1');
    expect(key).toBe('expression-run-waring');
    expect(payload.message).toMatch(/null/);
  });
});
