'use strict';

/**
 * Node behaviour scripts ("Script" property).
 *
 * Every node registered through `defineNode` gets a `functionScript` input
 * (displayName "Script") whose default value is a reconstruction of the node's
 * own definition — see `reconstructNodeSource`. This module is what makes an
 * *edited* script take over: when the parameter differs from that default, the
 * script is evaluated back into a definition object and the parts the user
 * actually changed replace the corresponding behaviour on that node instance.
 *
 * Three rules keep this safe on a live graph:
 *
 *  1. Only what changed is applied. Every function in the script is compared
 *     (whitespace/shorthand-insensitive) against the pristine definition, and
 *     identical functions are left completely alone. Re-evaluated functions
 *     lose the closure they were written in (module imports, file-level
 *     constants), so touching the untouched would break nodes for no reason.
 *  2. The override is per node instance, exactly like any other parameter.
 *     Other instances of the same type keep the original behaviour.
 *  3. Nothing throws out into the update loop. Evaluation errors and errors
 *     raised by overridden functions are reported as node warnings (they show
 *     up in the editor, including as markers in the code editor).
 *
 * A script that is *not* shaped like a node definition keeps the older
 * behaviour: it is compiled as a JavaScriptFunction-style body (Inputs /
 * Outputs / XGENIA / Component) and run.
 *
 * One surface where rule 1 cannot hold: the deploy bundle (published games) is
 * minified, so no function's source there can match a script written in the
 * editor and the script is applied in full. `guarded()` is what keeps that from
 * breaking a game — the first failure of any member hands it back to the
 * built-in implementation.
 */

const EdgeTriggeredInput = require('./edgetriggeredinput');
const JavascriptNodeParser = require('./javascriptnodeparser');

const WARNING_KEY = 'node-script-override';

// Methods a script must not replace — they are the override machinery itself.
const PROTECTED_METHODS = {
  applyNodeScript: true,
  revertNodeScript: true
};

// ---------------------------------------------------------------------------
// Function source: canonical form + emission
// ---------------------------------------------------------------------------

/**
 * Strip whatever names a function source carries in front of its argument list
 * so the different ways of writing the same function compare equal:
 *
 *   set(value) { … }            (shorthand method, what Function#toString gives)
 *   function (value) { … }      (what we emit into the script)
 *   function set(value) { … }
 *
 * Arrow functions are left as they are.
 */
function stripFunctionHeader(source) {
  let src = String(source).trim();
  let prefix = '';

  const asyncMatch = src.match(/^async\s+/);
  if (asyncMatch) {
    prefix = 'async ';
    src = src.slice(asyncMatch[0].length);
  }

  // function foo(…) / function*(…) / function (…)
  let header = src.match(/^function\s*\*?\s*(?:[A-Za-z_$][\w$]*)?\s*(?=\()/);
  if (!header) {
    // Shorthand method or generator: foo(…) / *foo(…) / [Symbol.x](…)
    header = src.match(/^\*?\s*(?:[A-Za-z_$][\w$]*|\[[^\]]*\])\s*(?=\()/);
  }
  if (header) {
    src = src.slice(header[0].length);
  }

  return prefix + src;
}

/**
 * True when re-indenting the source cannot change what it does. Template
 * literals carry their own leading whitespace, so those are left untouched.
 */
function isIndentationSafe(source) {
  return source.indexOf('`') === -1;
}

function normalizeWhitespace(source) {
  if (isIndentationSafe(source)) {
    // Layout is cosmetic: reformatting a function (or the whole script) must not
    // read as an edit, or a pass of the formatter would re-apply everything and
    // strip every function of the closure it was written in.
    return String(source).replace(/\s+/g, ' ').trim();
  }

  // Template literals carry their own whitespace — compare those verbatim.
  return String(source)
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .trim();
}

/**
 * The form used for "did the user change this function?" comparisons.
 */
function canonicalFunctionText(fnOrSource) {
  if (fnOrSource === undefined || fnOrSource === null) return undefined;
  if (typeof fnOrSource !== 'function' && typeof fnOrSource !== 'string') return undefined;
  return normalizeWhitespace(stripFunctionHeader(typeof fnOrSource === 'function' ? fnOrSource.toString() : fnOrSource));
}

function sameFunctionSource(a, b) {
  const ca = canonicalFunctionText(a);
  const cb = canonicalFunctionText(b);
  return ca !== undefined && ca === cb;
}

/**
 * Emit a function as a valid property value, re-indented to where it sits in
 * the generated script (unless re-indenting could change a template literal).
 */
function emitFunction(fn, indent) {
  const source = fn.toString().trim();
  const isExpression = /^(?:async\s+)?(?:function|class)\b/.test(source) || /^[([]/.test(source);
  const asExpression = isExpression ? source : reheadShorthand(source);

  if (!isIndentationSafe(asExpression)) return asExpression;

  const lines = asExpression.split('\n');
  if (lines.length === 1) return asExpression;

  // Remove the indentation the source file happened to use, then apply ours.
  let common = null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    const leading = lines[i].match(/^[ \t]*/)[0].length;
    common = common === null ? leading : Math.min(common, leading);
  }
  common = common || 0;

  return lines
    .map((line, index) => {
      if (index === 0) return line;
      if (line.trim() === '') return '';
      return indent + line.slice(common);
    })
    .join('\n');
}

/**
 * `set(value) { … }` is only valid inside an object literal as a shorthand
 * method; as a property *value* it has to become `function (value) { … }`.
 */
function reheadShorthand(source) {
  let src = source;
  let prefix = '';

  const asyncMatch = src.match(/^async\s+/);
  if (asyncMatch) {
    prefix = 'async ';
    src = src.slice(asyncMatch[0].length);
  }

  const header = src.match(/^(\*?)\s*(?:[A-Za-z_$][\w$]*|\[[^\]]*\])\s*(?=\()/);
  if (!header) return prefix + src;

  return prefix + 'function' + (header[1] ? '*' : '') + ' ' + src.slice(header[0].length);
}

// ---------------------------------------------------------------------------
// Definition -> source (the default value of the Script property)
// ---------------------------------------------------------------------------

function isPlainObject(value) {
  if (!value || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function emitKey(key) {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
}

function emitValue(value, indent, seen) {
  if (typeof value === 'function') return emitFunction(value, indent);
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';

  const type = typeof value;
  if (type === 'string') return JSON.stringify(value);
  if (type === 'number' || type === 'boolean') return String(value);
  if (type === 'bigint') return String(value) + 'n';
  if (type === 'symbol') return 'undefined /* symbol */';

  if (value instanceof RegExp) return String(value);
  if (value instanceof Date) return 'new Date(' + JSON.stringify(value.toISOString()) + ')';

  if (seen.indexOf(value) !== -1) return 'undefined /* circular */';
  seen.push(value);

  try {
    if (Array.isArray(value)) {
      const items = value.map((item) => emitValue(item, indent + '  ', seen));
      if (!items.length) return '[]';
      const inline = '[' + items.join(', ') + ']';
      if (inline.length <= 96 && inline.indexOf('\n') === -1) return inline;
      return '[\n' + items.map((item) => indent + '  ' + item).join(',\n') + '\n' + indent + ']';
    }

    if (!isPlainObject(value)) {
      // Class instances, DOM nodes, … cannot be written back as source.
      return 'undefined /* ' + (value.constructor && value.constructor.name ? value.constructor.name : 'object') + ' */';
    }

    const keys = Object.keys(value);
    const entries = keys.map((key) => emitKey(key) + ': ' + emitValue(value[key], indent + '  ', seen));
    if (!entries.length) return '{}';
    const inline = '{ ' + entries.join(', ') + ' }';
    if (inline.length <= 96 && inline.indexOf('\n') === -1) return inline;
    return '{\n' + entries.map((entry) => indent + '  ' + entry).join(',\n') + '\n' + indent + '}';
  } finally {
    seen.pop();
  }
}

function toIdentifier(name) {
  let identifier = String(name === undefined || name === null ? '' : name).replace(/[^A-Za-z0-9_$]/g, '');
  if (!identifier || /^[0-9]/.test(identifier)) identifier = 'Node' + identifier;
  return identifier;
}

const SCRIPT_HEADER = [
  '// Behaviour of this node instance. Edit any function below and save (SAVE,',
  '// Ctrl/Cmd+S, or close this editor) — the functions you change replace the',
  '// original behaviour of THIS node only. Delete the whole script and save to',
  '// go back to the built-in implementation.',
  '//',
  '// `this` is the node instance. Functions you edit are re-compiled on their',
  '// own, so they can only use what is reachable from here (this.*, XGENIA,',
  '// globals) — not identifiers that were imported by the original source file.',
  ''
].join('\n');

/**
 * Reconstruct an editable definition source for a node type. This is the
 * default value of the Script property, and the baseline every edit is
 * compared against, so it has to be valid JavaScript that evaluates back to an
 * equivalent definition object.
 */
function reconstructNodeSource(opts) {
  try {
    const identifier = toIdentifier(opts.name || 'Node');
    const lines = [];

    lines.push(SCRIPT_HEADER);
    lines.push('const ' + identifier + ' = {');

    if (opts.name !== undefined) lines.push('  name: ' + JSON.stringify(opts.name) + ',');
    if (opts.category !== undefined) lines.push('  category: ' + JSON.stringify(opts.category) + ',');
    if (opts.docs !== undefined) lines.push('  docs: ' + JSON.stringify(opts.docs) + ',');
    if (typeof opts.initialize === 'function') {
      lines.push('  initialize: ' + emitFunction(opts.initialize, '  ') + ',');
    }

    ['inputs', 'outputs'].forEach((section) => {
      const value = opts[section];
      if (!value || typeof value !== 'object') return;

      const keys = Object.keys(value);
      if (!keys.length) return;

      lines.push('  ' + section + ': {');
      keys.forEach((key) => {
        lines.push('    ' + emitKey(key) + ': ' + emitValue(value[key], '    ', []) + ',');
      });
      lines.push('  },');
    });

    const methods = opts.methods || opts.prototypeExtensions;
    if (methods && typeof methods === 'object') {
      const keys = Object.keys(methods).filter((key) => {
        const method = methods[key];
        return typeof method === 'function' || (method && typeof method.value === 'function');
      });

      if (keys.length) {
        lines.push('  methods: {');
        keys.forEach((key) => {
          const method = methods[key];
          const fn = typeof method === 'function' ? method : method.value;
          lines.push('    ' + emitKey(key) + ': ' + emitFunction(fn, '    ') + ',');
        });
        lines.push('  },');
      }
    }

    lines.push('};');
    lines.push('');

    return lines.join('\n');
  } catch (e) {
    return '// Unable to reconstruct source: ' + e.message + '\n';
  }
}

function isSignalInput(input) {
  if (!input) return false;
  if (typeof input.valueChangedToTrue === 'function') return true;
  const type = input.type;
  return type === 'signal' || (type && type.name === 'signal');
}

/**
 * The pristine function sources of a node type, in canonical form. Captured
 * once per type at definition time and used to tell which parts of an edited
 * script actually differ from the built-in implementation.
 */
/** A baseline member: the pristine function plus its comparable source. */
function member(fn) {
  if (typeof fn !== 'function') return undefined;
  return { fn: fn, text: canonicalFunctionText(fn) };
}

function snapshotDefinition(opts) {
  const snapshot = {
    initialize: member(opts.initialize),
    inputs: {},
    outputs: {},
    methods: {}
  };

  const inputs = opts.inputs || {};
  Object.keys(inputs).forEach((name) => {
    const input = inputs[name] || {};
    snapshot.inputs[name] = {
      set: member(input.set),
      valueChangedToTrue: member(input.valueChangedToTrue),
      isSignal: isSignalInput(input)
    };
  });

  const outputs = opts.outputs || {};
  Object.keys(outputs).forEach((name) => {
    const output = outputs[name] || {};
    snapshot.outputs[name] = { get: member(output.get || output.getter) };
  });

  const methods = opts.methods || opts.prototypeExtensions || {};
  Object.keys(methods).forEach((name) => {
    const method = methods[name];
    snapshot.methods[name] = member(typeof method === 'function' ? method : method && method.value);
  });

  return snapshot;
}

function isUnchanged(fn, baselineMember) {
  return !!baselineMember && sameFunctionSource(fn, baselineMember.text);
}

function builtIn(baselineMember) {
  return baselineMember ? baselineMember.fn : undefined;
}

// ---------------------------------------------------------------------------
// Source -> definition
// ---------------------------------------------------------------------------

function isNodeDefinition(value) {
  if (!value || typeof value !== 'object') return false;
  return (
    typeof value.initialize === 'function' ||
    (value.inputs && typeof value.inputs === 'object') ||
    (value.outputs && typeof value.outputs === 'object') ||
    (value.methods && typeof value.methods === 'object') ||
    (value.prototypeExtensions && typeof value.prototypeExtensions === 'object')
  );
}

/**
 * Cheap static check used only to decide how to report a broken script: a
 * script that was clearly *meant* to be a definition gets its error surfaced,
 * anything else falls back to being run as a plain script body.
 */
function looksLikeDefinition(script) {
  return /(^|\n)\s*(?:inputs|outputs|methods|prototypeExtensions|initialize)\s*:/.test(String(script));
}

function collectDeclaredNames(script) {
  const names = [];
  const re = /(?:^|\n)[ \t]*(?:const|let|var)[ \t]+([A-Za-z_$][\w$]*)/g;
  let match;
  while ((match = re.exec(script)) !== null) {
    if (names.indexOf(match[1]) === -1) names.push(match[1]);
  }
  // Later declarations win: helpers usually come before the definition itself.
  return names.reverse();
}

/**
 * Evaluate a script and return the node definition object it produces.
 * Supports `const Foo = { … }`, `module.exports = { … }` and a bare object
 * literal. Returns null when the script doesn't produce a definition.
 */
function evaluateNodeScript(script, node) {
  const trimmed = String(script).trim();
  const moduleObj = { exports: {} };

  let body;
  if (/^[({]/.test(trimmed)) {
    body = '"use strict";\nreturn (' + trimmed.replace(/;\s*$/, '') + ');';
  } else {
    const names = collectDeclaredNames(trimmed);
    const candidates = ['(__isDefinition(module.exports) ? module.exports : null)'].concat(
      names.map((name) => '(typeof ' + name + " !== 'undefined' && __isDefinition(" + name + ') ? ' + name + ' : null)')
    );
    body = '"use strict";\n' + trimmed + '\n;return ' + candidates.join(' || ') + ' || null;';
  }

  const factory = new Function('XGENIA', 'Component', 'module', 'exports', '__isDefinition', body);

  return factory.call(
    undefined,
    JavascriptNodeParser.createXgeniaAPI(),
    node && node.nodeScope ? JavascriptNodeParser.getComponentScopeForNode(node) : {},
    moduleObj,
    moduleObj.exports,
    isNodeDefinition
  );
}

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

function componentName(node) {
  try {
    return node.nodeScope.componentOwner.name;
  } catch (e) {
    return undefined;
  }
}

function reportWarning(node, message, stack) {
  console.error('[Node Script] ' + (node.name || 'node') + ': ' + message);

  const editorConnection = node.context && node.context.editorConnection;
  if (!editorConnection || !editorConnection.sendWarning) return;

  try {
    editorConnection.sendWarning(componentName(node), node.id, WARNING_KEY, {
      showGlobally: true,
      message: message,
      stack: stack
    });
  } catch (e) {
    /* console.error above is the fallback */
  }
}

function clearWarning(node) {
  const editorConnection = node.context && node.context.editorConnection;
  if (!editorConnection || !editorConnection.clearWarning) return;

  try {
    editorConnection.clearWarning(componentName(node), node.id, WARNING_KEY);
  } catch (e) {
    /* the warning simply stays up */
  }
}

/**
 * Keep an overridden function from throwing into the reactive update loop — a
 * typo in a script should show up as a warning on the node, not stop the whole
 * graph from running.
 *
 * When there is a built-in implementation to fall back to, the first failure
 * hands the member back to it permanently. That matters most in a published
 * game: the deploy bundle is minified, so the baseline there cannot be matched
 * against a script written in the editor and every function in the script gets
 * applied — including ones the user never touched, which may reference
 * identifiers that only existed in the original source file.
 */
function guarded(node, label, fn, fallback) {
  let failed = false;

  return function () {
    if (failed && fallback) return fallback.apply(this, arguments);

    try {
      return fn.apply(this, arguments);
    } catch (e) {
      reportWarning(
        node,
        label + ': ' + e.message + (fallback ? ' — falling back to the built-in implementation' : ''),
        e.stack
      );

      if (!fallback) return undefined;
      failed = true;
      return fallback.apply(this, arguments);
    }
  };
}

// ---------------------------------------------------------------------------
// Applying an override
// ---------------------------------------------------------------------------

function overrideState(node, create) {
  node._internal = node._internal || {};
  if (!node._internal.__nodeScriptOverride && create) {
    node._internal.__nodeScriptOverride = { restore: [], baseline: undefined };
  }
  return node._internal.__nodeScriptOverride;
}

/**
 * Every input that can safely be pushed through its setter again: an override
 * anywhere in the node (a method, initialize, a setter) can change what the
 * node makes of the values it already holds, and re-driving is how that becomes
 * visible without restarting the graph.
 *
 * Signals are never re-driven — that would fire them on save.
 */
function redrivableInputs(node, baseline) {
  const values = node._inputValues || {};

  return Object.keys(values).filter((name) => {
    if (name === 'functionScript') return false;

    const base = baseline && baseline.inputs ? baseline.inputs[name] : undefined;
    if (base) return !base.isSignal;

    // A port the node type doesn't declare (dynamic/numbered ports). A queued
    // `true` is what a signal looks like, so leave booleans alone.
    return typeof values[name] !== 'boolean';
  });
}

/**
 * Push the current value of an input through its (new) setter so an override
 * takes effect immediately instead of at the next incoming value.
 */
function redriveInputs(node, names) {
  names.forEach((name) => {
    // A value already on its way will reach the new setter by itself. Re-driving
    // would replace it with the older one during the node's first update.
    const pending = node._inputValuesQueue && node._inputValuesQueue[name];
    if (pending && pending.length) return;

    const value = node._inputValues ? node._inputValues[name] : undefined;
    if (value === undefined) return;
    try {
      node.queueInput(name, value);
    } catch (e) {
      reportWarning(node, 'input "' + name + '": ' + e.message, e.stack);
    }
  });
}

function redriveOutputs(node) {
  const outputs = node._outputList || [];

  for (let i = 0; i < outputs.length; i++) {
    const name = outputs[i].name;
    try {
      node.flagOutputDirty(name);
    } catch (e) {
      reportWarning(node, 'output "' + name + '": ' + e.message, e.stack);
    }
  }
}

/**
 * Drop a function compiled by the plain-script-body path. `_internal.func` is
 * only ours while that path owns it — nodes use that slot for their own things.
 */
function clearImperativeScript(node) {
  if (!node._internal || !node._internal.__nodeScriptImperative) return;
  node._internal.func = undefined;
  delete node._internal.__nodeScriptImperative;
}

/** Undo a previously applied script override, restoring the built-in behaviour. */
function revertNodeScript(node, skipRedrive) {
  const state = overrideState(node, false);
  if (!state) return false;

  delete node._internal.__nodeScriptOverride;

  for (let i = state.restore.length - 1; i >= 0; i--) {
    try {
      state.restore[i]();
    } catch (e) {
      console.error('[Node Script] failed to restore ' + (node.name || 'node') + ': ' + e.message);
    }
  }

  if (!skipRedrive) {
    redriveInputs(node, redrivableInputs(node, state.baseline));
    redriveOutputs(node);
  }

  return true;
}

function overrideInputSetter(node, name, setter, spec, state) {
  if (!node.hasInput(name)) {
    // An input the script added. Registering it lets values reach the setter;
    // the editor still only shows the ports the node type declares.
    node.registerInput(name, { set: setter, type: spec && spec.type });
    state.restore.push(function () {
      if (Object.prototype.hasOwnProperty.call(node._inputs, name)) delete node._inputs[name];
    });
    return;
  }

  const hadOwn = Object.prototype.hasOwnProperty.call(node._inputs, name);
  const previous = node._inputs[name];

  node._inputs[name] = Object.assign({}, previous, { set: setter });
  state.restore.push(function () {
    if (hadOwn) node._inputs[name] = previous;
    else delete node._inputs[name];
  });
}

function overrideOutputGetter(node, name, getter, state) {
  if (!node.hasOutput(name)) {
    node.registerOutput(name, { getter: getter });
    state.restore.push(function () {
      try {
        if (node.hasOutput(name)) node.deregisterOutput(name);
      } catch (e) {
        /* still connected — leave it in place */
      }
    });
    return;
  }

  const output = node.getOutput(name);
  const previous = output.getter;
  output.getter = getter;
  state.restore.push(function () {
    output.getter = previous;
  });
}

function overrideMethod(node, name, fn, state) {
  const hadOwn = Object.prototype.hasOwnProperty.call(node, name);
  const previous = hadOwn ? Object.getOwnPropertyDescriptor(node, name) : undefined;

  // defineProperty, not assignment: definition methods land on the prototype as
  // non-writable properties, so `node[name] = fn` would silently do nothing.
  Object.defineProperty(node, name, {
    value: fn,
    writable: true,
    configurable: true,
    enumerable: false
  });

  state.restore.push(function () {
    if (hadOwn) Object.defineProperty(node, name, previous);
    else delete node[name];
  });
}

/**
 * Replace the parts of `node`'s behaviour that the definition object differs
 * from the pristine baseline in.
 */
function applyDefinitionOverride(node, definition, baseline) {
  revertNodeScript(node, true);

  const state = overrideState(node, true);
  state.baseline = baseline;

  const errors = [];
  const label = 'Script';

  let unchangedCount = 0;
  let changedCount = 0;

  const methods = definition.methods || definition.prototypeExtensions;
  if (methods && typeof methods === 'object') {
    Object.keys(methods).forEach((name) => {
      if (PROTECTED_METHODS[name]) return;

      const entry = methods[name];
      const fn = typeof entry === 'function' ? entry : entry && entry.value;
      if (typeof fn !== 'function') return;

      const base = baseline.methods[name];
      if (isUnchanged(fn, base)) {
        unchangedCount++;
        return;
      }
      changedCount++;

      overrideMethod(node, name, guarded(node, label + ' method "' + name + '"', fn, builtIn(base)), state);
    });
  }

  if (definition.inputs && typeof definition.inputs === 'object') {
    Object.keys(definition.inputs).forEach((name) => {
      if (name === 'functionScript') return;

      const spec = definition.inputs[name];
      if (!spec || typeof spec !== 'object') return;

      const base = baseline.inputs[name] || {};

      if (typeof spec.set === 'function') {
        if (isUnchanged(spec.set, base.set)) {
          unchangedCount++;
          return;
        }
        changedCount++;

        overrideInputSetter(
          node,
          name,
          guarded(node, label + ' input "' + name + '"', spec.set, builtIn(base.set)),
          spec,
          state
        );
        return;
      }

      if (typeof spec.valueChangedToTrue === 'function') {
        if (isUnchanged(spec.valueChangedToTrue, base.valueChangedToTrue)) {
          unchangedCount++;
          return;
        }
        changedCount++;

        const setter = EdgeTriggeredInput.createSetter({
          valueChangedToTrue: guarded(
            node,
            label + ' input "' + name + '"',
            spec.valueChangedToTrue,
            builtIn(base.valueChangedToTrue)
          )
        });
        overrideInputSetter(node, name, setter, spec, state);
      }
    });
  }

  if (definition.outputs && typeof definition.outputs === 'object') {
    Object.keys(definition.outputs).forEach((name) => {
      const spec = definition.outputs[name];
      if (!spec || typeof spec !== 'object') return;

      const fn = spec.get || spec.getter;
      if (typeof fn !== 'function') return;

      const base = (baseline.outputs[name] || {}).get;
      if (isUnchanged(fn, base)) {
        unchangedCount++;
        return;
      }
      changedCount++;

      overrideOutputGetter(node, name, guarded(node, label + ' output "' + name + '"', fn, builtIn(base)), state);
    });
  }

  if (typeof definition.initialize === 'function') {
    if (isUnchanged(definition.initialize, baseline.initialize)) {
      unchangedCount++;
    } else {
      changedCount++;
      try {
        definition.initialize.call(node);
      } catch (e) {
        errors.push('initialize: ' + e.message);
      }
    }
  }

  if (unchangedCount === 0 && changedCount >= 3) {
    // The baseline could not be matched at all. Expected in a published game
    // (the deploy bundle is minified, so no function's source can match a
    // script written in the editor) — worth saying out loud, because it means
    // functions the user never edited are being applied too.
    console.warn(
      '[Node Script] "' +
        (node.name || 'node') +
        '": none of the ' +
        changedCount +
        " functions in the script match this build's implementation, so the script is applied in full."
    );
  }

  const applied = state.restore.length > 0;

  if (applied) {
    redriveInputs(node, redrivableInputs(node, baseline));
    redriveOutputs(node);
    node.flagDirty();
  } else {
    // Nothing differed from the built-in implementation — don't leave an empty
    // override behind, so a later revert has nothing to undo.
    delete node._internal.__nodeScriptOverride;
  }

  return { applied: applied, errors: errors };
}

/**
 * Entry point for the `functionScript` input of every node that gets the
 * generic Script property.
 *
 * @returns {'default'|'definition'|'imperative'|'error'} what was done, for tests
 */
function applyNodeScript(node, script, options) {
  const baseline = (options && options.baseline) || { inputs: {}, outputs: {}, methods: {} };
  const defaultSource = options && options.defaultSource;

  node._internal = node._internal || {};

  const isEmpty = script === undefined || script === null || String(script).trim() === '';

  if (isEmpty || (typeof defaultSource === 'string' && normalizeWhitespace(script) === normalizeWhitespace(defaultSource))) {
    revertNodeScript(node);
    clearImperativeScript(node);
    clearWarning(node);
    return 'default';
  }

  let definition = null;
  let evaluationError = null;
  try {
    definition = evaluateNodeScript(script, node);
  } catch (e) {
    evaluationError = e;
  }

  if (isNodeDefinition(definition)) {
    clearWarning(node);
    clearImperativeScript(node);

    const result = applyDefinitionOverride(node, definition, baseline);
    if (result.errors.length) reportWarning(node, result.errors.join('\n'));
    return 'definition';
  }

  if (evaluationError && looksLikeDefinition(script)) {
    // Meant to be a definition but didn't get there — keep the behaviour the
    // node has now and tell the user what went wrong.
    reportWarning(node, 'Script error: ' + evaluationError.message, evaluationError.stack);
    return 'error';
  }

  // Not a definition: run it as a plain script body, the way the Script
  // property behaved before definitions were editable.
  revertNodeScript(node);
  clearWarning(node);

  if (node.parseScript) {
    node._internal.func = node.parseScript(script);
    node._internal.__nodeScriptImperative = true;
    if (!node.isInputConnected('run') && node.scheduleRun) node.scheduleRun();
  }

  return 'imperative';
}

module.exports = {
  applyNodeScript,
  revertNodeScript,
  reconstructNodeSource,
  snapshotDefinition,
  evaluateNodeScript,
  isNodeDefinition,
  canonicalFunctionText,
  sameFunctionSource,
  isUnchanged,
  WARNING_KEY
};
