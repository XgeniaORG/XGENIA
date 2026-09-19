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
  revertNodeScript: true,
  scriptScopeNames: true
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

// ---------------------------------------------------------------------------
// Bundled import references -> the plain names a script can call
// ---------------------------------------------------------------------------

// 2026-09-17, export 1789661242337: the default Script is `fn.toString()` of the
// BUNDLED function, and in the editor's viewer bundle a method's call to an
// import reads `(0,filterUtils/* requestRender */.sG)(this)`. Kept in an edited
// function that threw `filterUtils is not defined` and fell back to the
// built-in, even though `requestRender` itself is in the override's scope. So
// the text a user or the AI sees names in-scope imports by their plain names.
//
// The reference forms webpack 5 writes (the original export name is in the
// comment, or is the property itself when exports are not mangled):
//
//   filterUtils/* requestRender */.sG                                 production, concatenated module
//   _ticker_safety__WEBPACK_IMPORTED_MODULE_9__/* .tickerAdd */ .uD   production, module variable
//   _Mgr__WEBPACK_IMPORTED_MODULE_1__/* ["default"] */ .A             production, module variable
//   _filterUtils__WEBPACK_IMPORTED_MODULE_3__.requestRender           development
//   _filterUtils__WEBPACK_IMPORTED_MODULE_3__["requestRender"]        development
//
// each either bare (a value) or wrapped as `(0,<ref>)` in call position. A
// minified bundle (the deploy build) has no comments and mangled keys, so no
// name can be recovered there and its text is left as it is.

const IMPORT_IDENT = '[A-Za-z_$][\\w$]*';

// One reference, matched from the first character of its namespace identifier
// (sticky: the scan below finds where that is, so this never slides through a
// long run of word characters — a quadratic stall on an inlined data string).
const IMPORT_REF_AT = new RegExp(
  IMPORT_IDENT +
    '(?:' +
    // groups 1-3: `NS/* .name */ .x`, `NS/* ["name"] */ .x`, `NS/* name */.x`
    '\\s*\\/\\*\\s*(?:\\.(' +
    IMPORT_IDENT +
    ')|\\[\\s*"(' +
    IMPORT_IDENT +
    ')"\\s*\\]|(' +
    IMPORT_IDENT +
    '))\\s*\\*\\/\\s*\\.\\s*' +
    IMPORT_IDENT +
    '|' +
    // groups 4-5: `X__WEBPACK_IMPORTED_MODULE_3__.name`, `…__["name"]` (the
    // identifier above has already consumed the `__WEBPACK_…__` suffix)
    '(?:\\s*\\.\\s*(' +
    IMPORT_IDENT +
    ')|\\[\\s*["\'](' +
    IMPORT_IDENT +
    ')["\']\\s*\\]))',
  'y'
);

const IMPORT_ANCHOR_RE = /\/\*|__WEBPACK_IMPORTED_MODULE_\d+__(?=\s*[.[])/g;

// Words after which `(` opens an expression rather than an argument list.
const EXPRESSION_KEYWORDS = new Set(
  'return typeof void delete await yield case throw in of instanceof new else do'.split(' ')
);

const isWordChar = (ch) => /[\w$]/.test(ch);
const isSpace = (ch) => /\s/.test(ch);

/**
 * Whether the `(` at `offset` is webpack's `(0,…)` call wrapper rather than the
 * argument list of a call (`foo(0, ref)`), judged by what comes before it.
 * Generated code never puts whitespace between a callee and its arguments, so
 * `if (x) (0,…)(y)` is a new expression and `foo(0,…)` / `fn()(0,…)` are calls.
 */
function isCallWrapper(text, offset) {
  if (offset === 0 || isSpace(text[offset - 1])) return true;

  const last = text[offset - 1];
  if (last === ')' || last === ']') return false;
  if (isWordChar(last)) {
    let start = offset - 1;
    while (start > 0 && isWordChar(text[start - 1])) start--;
    return EXPRESSION_KEYWORDS.has(text.slice(start, offset)) && text[start - 1] !== '.';
  }
  return true;
}

/** Index of the `(` of a `(0,` directly in front of `start`, or -1. */
function callWrapperOpen(text, start) {
  let i = start;
  while (i > 0 && isSpace(text[i - 1])) i--;
  if (text[i - 1] !== ',') return -1;
  i--;
  while (i > 0 && isSpace(text[i - 1])) i--;
  if (text[i - 1] !== '0') return -1;
  i--;
  while (i > 0 && isSpace(text[i - 1])) i--;
  return text[i - 1] === '(' ? i - 1 : -1;
}

/** Index just past the `)` closing a call wrapper right after `end`, or -1. */
function callWrapperClose(text, end) {
  let i = end;
  while (i < text.length && isSpace(text[i])) i++;
  return text[i] === ')' ? i + 1 : -1;
}

/**
 * Rewrite the bundled import references in a function's source whose original
 * name is in `scopeNames` to that plain name:
 *
 *   (0,filterUtils/* requestRender *\/.sG)(this)  ->  requestRender(this)
 *   filterUtils/* requestRender *\/.sG            ->  requestRender
 *
 * A reference whose name is not in scope, and every `default` import, is left
 * exactly as it is — the text stays honest about what will not compile.
 */
function unmangleImports(fnText, scopeNames) {
  const text = String(fnText === undefined || fnText === null ? '' : fnText);
  if (!scopeNames) return text;

  const names = scopeNames instanceof Set ? scopeNames : new Set(scopeNames);
  if (!names.size) return text;
  if (text.indexOf('*/') === -1 && text.indexOf('__WEBPACK_IMPORTED_MODULE_') === -1) return text;

  let out = '';
  let copied = 0;
  const anchor = new RegExp(IMPORT_ANCHOR_RE.source, 'g');
  let hit;

  while ((hit = anchor.exec(text)) !== null) {
    // Back to the first character of the namespace identifier.
    let start = hit.index;
    if (hit[0] === '/*') {
      while (start > copied && isSpace(text[start - 1])) start--;
    }
    const identEnd = start;
    while (start > copied && isWordChar(text[start - 1])) start--;
    if (start === identEnd && hit[0] === '/*') continue;

    IMPORT_REF_AT.lastIndex = start;
    const ref = IMPORT_REF_AT.exec(text);
    if (!ref) continue;

    const end = start + ref[0].length;
    anchor.lastIndex = end;

    const name = ref[1] || ref[2] || ref[3] || ref[4] || ref[5];
    if (text[start - 1] === '.') continue;

    // (2026-09-17) A member of the pixi.js namespace — `pixi_js__WEBPACK_IMPORTED_MODULE_17__.Texture`
    // (41 in the viewer bundle), with or without the name comment — is `PIXI.<name>` when PIXI is
    // in scope. Only the reference is rewritten; a `(0,…)` wrapper stays, so the call keeps its
    // `this` exactly as bundled.
    const nsIdent = (/^[A-Za-z_$][\w$]*/.exec(text.slice(start, end)) || [''])[0];
    if (name && name !== 'default' && names.has('PIXI') && /^pixi_js__WEBPACK_IMPORTED_MODULE_\d+__$/.test(nsIdent)) {
      out += text.slice(copied, start) + 'PIXI.' + name;
      copied = end;
      continue;
    }

    // Not a scope name, or a default import.
    if (name === 'default' || !names.has(name)) continue;

    let from = start;
    let to = end;
    let replacement = name;

    const open = callWrapperOpen(text, start);
    const close = open >= copied ? callWrapperClose(text, end) : -1;
    if (open >= copied && close !== -1 && isCallWrapper(text, open)) {
      from = open;
      to = close;
      // `return(0,…)` in tighter output: keep the keyword and the name apart.
      if (open > 0 && isWordChar(text[open - 1])) replacement = ' ' + name;
      anchor.lastIndex = close;
    }

    out += text.slice(copied, from) + replacement;
    copied = to;
  }

  return copied === 0 ? text : out + text.slice(copied);
}

/**
 * The names bundled imports are rewritten to for a node with this
 * `scriptScope`. A node that declares no scope gets none, so its Script text
 * and its baseline are exactly what they were before scopes existed.
 */
function unmangleNamesFor(scope) {
  return scope && typeof scope === 'object' ? scriptScopeNames(scope) : [];
}

/**
 * The form used for "did the user change this function?" comparisons.
 * `scopeNames` (optional) rewrites bundled imports first — pass the same names
 * the default Script was built with, so an untouched function compares equal.
 */
function canonicalFunctionText(fnOrSource, scopeNames) {
  if (fnOrSource === undefined || fnOrSource === null) return undefined;
  if (typeof fnOrSource !== 'function' && typeof fnOrSource !== 'string') return undefined;
  const source = typeof fnOrSource === 'function' ? fnOrSource.toString() : fnOrSource;
  return normalizeWhitespace(stripFunctionHeader(unmangleImports(source, scopeNames)));
}

function sameFunctionSource(a, b, scopeNames) {
  const ca = canonicalFunctionText(a, scopeNames);
  const cb = canonicalFunctionText(b, scopeNames);
  return ca !== undefined && ca === cb;
}

/**
 * Emit a function as a valid property value, re-indented to where it sits in
 * the generated script (unless re-indenting could change a template literal).
 * `scopeNames`: bundled imports of these names are written as the plain name.
 */
function emitFunction(fn, indent, scopeNames) {
  const source = unmangleImports(fn.toString(), scopeNames).trim();
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

function emitValue(value, indent, seen, scopeNames) {
  if (typeof value === 'function') return emitFunction(value, indent, scopeNames);
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
      const items = value.map((item) => emitValue(item, indent + '  ', seen, scopeNames));
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
    const entries = keys.map((key) => emitKey(key) + ': ' + emitValue(value[key], indent + '  ', seen, scopeNames));
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
    // 2026-09-17, export 1789661242337: bundled imports of in-scope names are
    // written as those names, so an edited function compiles against the scope.
    const scopeNames = unmangleNamesFor(opts.scriptScope);

    lines.push(SCRIPT_HEADER);
    lines.push('const ' + identifier + ' = {');

    if (opts.name !== undefined) lines.push('  name: ' + JSON.stringify(opts.name) + ',');
    if (opts.category !== undefined) lines.push('  category: ' + JSON.stringify(opts.category) + ',');
    if (opts.docs !== undefined) lines.push('  docs: ' + JSON.stringify(opts.docs) + ',');
    if (typeof opts.initialize === 'function') {
      lines.push('  initialize: ' + emitFunction(opts.initialize, '  ', scopeNames) + ',');
    }

    ['inputs', 'outputs'].forEach((section) => {
      const value = opts[section];
      if (!value || typeof value !== 'object') return;

      const keys = Object.keys(value);
      if (!keys.length) return;

      lines.push('  ' + section + ': {');
      keys.forEach((key) => {
        lines.push('    ' + emitKey(key) + ': ' + emitValue(value[key], '    ', [], scopeNames) + ',');
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
          lines.push('    ' + emitKey(key) + ': ' + emitFunction(fn, '    ', scopeNames) + ',');
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
/**
 * A baseline member: the pristine function plus its comparable source.
 * `scopeNames` are the names its bundled imports were rewritten to — the same
 * rewrite reconstructNodeSource applied to the default Script.
 */
function member(fn, scopeNames) {
  if (typeof fn !== 'function') return undefined;
  return { fn: fn, text: canonicalFunctionText(fn, scopeNames), scopeNames: scopeNames };
}

function snapshotDefinition(opts) {
  // 2026-09-17, export 1789661242337: canonicalise the built-in side with the
  // rewrite the default Script got (same `opts`, so the same scope). Otherwise
  // an UNEDITED function saved back as `requestRender(this)` would differ from
  // the bundle's `(0,filterUtils/* requestRender */.sG)(this)` and be recompiled.
  const scopeNames = unmangleNamesFor(opts.scriptScope);

  const snapshot = {
    initialize: member(opts.initialize, scopeNames),
    inputs: {},
    outputs: {},
    methods: {}
  };

  const inputs = opts.inputs || {};
  Object.keys(inputs).forEach((name) => {
    const input = inputs[name] || {};
    snapshot.inputs[name] = {
      set: member(input.set, scopeNames),
      valueChangedToTrue: member(input.valueChangedToTrue, scopeNames),
      isSignal: isSignalInput(input)
    };
  });

  const outputs = opts.outputs || {};
  Object.keys(outputs).forEach((name) => {
    const output = outputs[name] || {};
    snapshot.outputs[name] = { get: member(output.get || output.getter, scopeNames) };
  });

  const methods = opts.methods || opts.prototypeExtensions || {};
  Object.keys(methods).forEach((name) => {
    const method = methods[name];
    snapshot.methods[name] = member(typeof method === 'function' ? method : method && method.value, scopeNames);
  });

  return snapshot;
}

/**
 * The saved side goes through the same rewrite as the baseline, so a script
 * saved from an older default (still carrying the bundled form) also reads as
 * unchanged where the user didn't touch it.
 */
function isUnchanged(fn, baselineMember) {
  return !!baselineMember && sameFunctionSource(fn, baselineMember.text, baselineMember.scopeNames);
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

// ---------------------------------------------------------------------------
// Script scope: names an edited function can call without importing them
// ---------------------------------------------------------------------------

// 2026-09-17, debug export 1789661242337: an AI editing pixi.ReelColumn's
// `_cascadeDropIn` kept its `requestRender(this)` call. requestRender is an
// import of PixiReelColumn.js, and a script is compiled on its own, so the
// override threw on its first call and the node silently fell back to the
// built-in. Two things are now in scope for every compiled script: the Babel
// helpers transpiled node sources call (`_objectSpread`, `_slicedToArray`, …,
// which lived at the top of the bundled file), and whatever the node's own
// definition lists as `scriptScope` — the helpers its source file imports.

const FIXED_SCRIPT_PARAMS = ['XGENIA', 'Component', 'module', 'exports', '__isDefinition'];

// Keywords, strict-mode reserved words, and names a parameter must never shadow.
const RESERVED_SCRIPT_NAMES = new Set(
  (
    'break case catch class const continue debugger default delete do else enum export extends false finally ' +
    'for function if import in instanceof new null return super switch this throw true try typeof var void ' +
    'while with yield let static implements interface package private protected public await async ' +
    'eval arguments undefined NaN Infinity'
  ).split(' ')
);

function _typeof(value) {
  return typeof value;
}

function _defineProperty(obj, key, value) {
  if (key in obj) {
    Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true });
  } else {
    obj[key] = value;
  }
  return obj;
}

function ownKeys(object, enumerableOnly) {
  const keys = Object.keys(object);
  if (Object.getOwnPropertySymbols) {
    let symbols = Object.getOwnPropertySymbols(object);
    if (enumerableOnly) {
      symbols = symbols.filter((symbol) => Object.getOwnPropertyDescriptor(object, symbol).enumerable);
    }
    keys.push.apply(keys, symbols);
  }
  return keys;
}

// Babel emits `_objectSpread(_objectSpread({}, a), {}, { b: 1 })`: odd arguments
// are spread sources, the `{}` between them are there on purpose.
function _objectSpread2(target) {
  for (let i = 1; i < arguments.length; i++) {
    const source = arguments[i] != null ? arguments[i] : {};
    if (i % 2) {
      ownKeys(Object(source), true).forEach((key) => _defineProperty(target, key, source[key]));
    } else if (Object.getOwnPropertyDescriptors) {
      Object.defineProperties(target, Object.getOwnPropertyDescriptors(source));
    } else {
      ownKeys(Object(source)).forEach((key) =>
        Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key))
      );
    }
  }
  return target;
}

function _arrayLikeToArray(arr, len) {
  if (len == null || len > arr.length) len = arr.length;
  const copy = new Array(len);
  for (let i = 0; i < len; i++) copy[i] = arr[i];
  return copy;
}

function _arrayWithHoles(arr) {
  if (Array.isArray(arr)) return arr;
}

function _arrayWithoutHoles(arr) {
  if (Array.isArray(arr)) return _arrayLikeToArray(arr);
}

function iteratorMethod(value) {
  if (value == null) return undefined;
  return (typeof Symbol !== 'undefined' && value[Symbol.iterator]) || value['@@iterator'] || undefined;
}

function _iterableToArray(iter) {
  if (iteratorMethod(iter) != null) return Array.from(iter);
}

function _iterableToArrayLimit(arr, limit) {
  const method = iteratorMethod(arr);
  if (method == null) return undefined;

  const result = [];
  const iterator = method.call(arr);
  let finished = false;
  try {
    while (limit == null || result.length < limit) {
      const step = iterator.next();
      if (step.done) {
        finished = true;
        break;
      }
      result.push(step.value);
    }
  } catch (e) {
    finished = true;
    throw e;
  } finally {
    // Stopped early (limit reached): let the iterator clean up, like destructuring does.
    if (!finished && typeof iterator.return === 'function') iterator.return();
  }
  return result;
}

function _unsupportedIterableToArray(value, minLen) {
  if (!value) return undefined;
  if (typeof value === 'string') return _arrayLikeToArray(value, minLen);
  let name = Object.prototype.toString.call(value).slice(8, -1);
  if (name === 'Object' && value.constructor) name = value.constructor.name;
  if (name === 'Map' || name === 'Set') return Array.from(value);
  if (name === 'Arguments' || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(name)) {
    return _arrayLikeToArray(value, minLen);
  }
  return undefined;
}

function _nonIterableRest() {
  throw new TypeError(
    'Invalid attempt to destructure non-iterable instance.\n' +
      'In order to be iterable, non-array objects must have a [Symbol.iterator]() method.'
  );
}

function _nonIterableSpread() {
  throw new TypeError(
    'Invalid attempt to spread non-iterable instance.\n' +
      'In order to be iterable, non-array objects must have a [Symbol.iterator]() method.'
  );
}

function _slicedToArray(arr, i) {
  return _arrayWithHoles(arr) || _iterableToArrayLimit(arr, i) || _unsupportedIterableToArray(arr, i) || _nonIterableRest();
}

function _toConsumableArray(arr) {
  return _arrayWithoutHoles(arr) || _iterableToArray(arr) || _unsupportedIterableToArray(arr) || _nonIterableSpread();
}

function _classCallCheck(instance, Constructor) {
  if (!(instance instanceof Constructor)) throw new TypeError('Cannot call a class as a function');
}

function defineDescriptors(target, props) {
  for (let i = 0; i < props.length; i++) {
    const descriptor = props[i];
    descriptor.enumerable = descriptor.enumerable || false;
    descriptor.configurable = true;
    if ('value' in descriptor) descriptor.writable = true;
    Object.defineProperty(target, descriptor.key, descriptor);
  }
}

function _createClass(Constructor, protoProps, staticProps) {
  if (protoProps) defineDescriptors(Constructor.prototype, protoProps);
  if (staticProps) defineDescriptors(Constructor, staticProps);
  Object.defineProperty(Constructor, 'prototype', { writable: false });
  return Constructor;
}

/** Babel helpers transpiled node sources call; in scope for every script. */
const ENGINE_SCRIPT_HELPERS = Object.freeze({
  _typeof,
  _defineProperty,
  ownKeys,
  _objectSpread: _objectSpread2,
  _objectSpread2,
  _arrayLikeToArray,
  _unsupportedIterableToArray,
  _iterableToArray,
  _iterableToArrayLimit,
  _arrayWithHoles,
  _arrayWithoutHoles,
  _nonIterableRest,
  _nonIterableSpread,
  _slicedToArray,
  _toConsumableArray,
  _classCallCheck,
  _createClass
});

function isUsableScopeName(name) {
  return /^[A-Za-z_$][\w$]*$/.test(name) && !RESERVED_SCRIPT_NAMES.has(name) && FIXED_SCRIPT_PARAMS.indexOf(name) === -1;
}

function mergedScriptScope(scope) {
  return Object.assign({}, ENGINE_SCRIPT_HELPERS, scope && typeof scope === 'object' ? scope : {});
}

function usableNames(merged) {
  // A helper whose value is missing (an import that didn't resolve in this
  // build) is left out rather than shadowing a global of the same name.
  return Object.keys(merged).filter((name) => isUsableScopeName(name) && merged[name] !== undefined);
}

/**
 * The names a script for a node with this `scriptScope` can call directly, in
 * the order they are passed to the compiled script: the engine helpers, then
 * the node's own scope.
 */
function scriptScopeNames(scope) {
  return usableNames(mergedScriptScope(scope));
}

/** The scope name a "can't redeclare" SyntaxError is about, if any. */
function redeclaredScopeName(error, names) {
  const message = String((error && error.message) || '');
  for (let i = 0; i < names.length; i++) {
    const escaped = names[i].replace(/\$/g, '\\$');
    if (new RegExp('(^|[^\\w$])' + escaped + '([^\\w$]|$)').test(message)) return names[i];
  }
  return undefined;
}

/**
 * Compile the script body with the scope names as extra parameters. A script
 * may declare one of those names itself (`const requestRender = …`), which is a
 * SyntaxError against a parameter of the same name — its own declaration wins,
 * so that name is dropped and the body compiled again. A syntax error that has
 * nothing to do with the scope comes out exactly as it did without one.
 */
function compileScriptFactory(body, names) {
  let active = names.slice();
  for (;;) {
    try {
      return { factory: Function.apply(null, FIXED_SCRIPT_PARAMS.concat(active, [body])), names: active };
    } catch (e) {
      if (!(e instanceof SyntaxError) || !active.length) throw e;
      const clash = redeclaredScopeName(e, active);
      if (!clash) {
        return { factory: Function.apply(null, FIXED_SCRIPT_PARAMS.concat([body])), names: [] };
      }
      active = active.filter((name) => name !== clash);
    }
  }
}

/**
 * Evaluate a script and return the node definition object it produces.
 * Supports `const Foo = { … }`, `module.exports = { … }` and a bare object
 * literal. Returns null when the script doesn't produce a definition.
 *
 * `scope` (the node definition's `scriptScope`) and ENGINE_SCRIPT_HELPERS are
 * callable by name from every function in the script.
 */
function evaluateNodeScript(script, node, scope) {
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

  const merged = mergedScriptScope(scope);
  const compiled = compileScriptFactory(body, usableNames(merged));

  return compiled.factory.apply(
    undefined,
    [
      JavascriptNodeParser.createXgeniaAPI(),
      node && node.nodeScope ? JavascriptNodeParser.getComponentScopeForNode(node) : {},
      moduleObj,
      moduleObj.exports,
      isNodeDefinition
    ].concat(compiled.names.map((name) => merged[name]))
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
    definition = evaluateNodeScript(script, node, options && options.scope);
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
  scriptScopeNames,
  ENGINE_SCRIPT_HELPERS,
  isNodeDefinition,
  canonicalFunctionText,
  sameFunctionSource,
  isUnchanged,
  unmangleImports,
  WARNING_KEY
};
