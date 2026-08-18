'use strict';

import React from 'react';
import { joinDimensionValue } from './dimension-value';

// CHANGE 1: Enhanced React 18/19 compatibility and patching
if (typeof window !== 'undefined') {
  const isDebugMode = false; // Set to true only for debugging
  if (isDebugMode) {
    console.log('[react-component-node] Pre-check: Imported React version:', React?.version);
    console.log('[react-component-node] Pre-check: Window.React version:', window.React?.version);
  }
  
  // Ensure our imported React and window.React are the same instance
  if (window.React && React !== window.React) {
    console.warn('[react-component-node] React instance mismatch detected! Attempting to patch.');
    
    // Make sure all hooks are properly available, including newer ones.
    const hookNames = [
      'useState', 'useEffect', 'useContext', 'useReducer', 'useCallback', 
      'useMemo', 'useRef', 'useImperativeHandle', 'useLayoutEffect', 'useDebugValue',
      // React 18+ hooks
      'useDeferredValue', 'useTransition', 'useId', 'useSyncExternalStore', 'useInsertionEffect'
    ];
      
    hookNames.forEach(hookName => {
      if (typeof window.React[hookName] === 'function' && 
          (typeof React[hookName] !== 'function' || React[hookName] !== window.React[hookName])) {
        if (isDebugMode) console.log(`[react-component-node] Patching React.${hookName}`);
        React[hookName] = window.React[hookName];
      }
    });
    
    // Also patch core parts of the React object to prevent "Invalid hook call" errors
    if (window.React.createElement && React.createElement !== window.React.createElement) {
      if (isDebugMode) console.log('[react-component-node] Patching React.createElement');
      React.createElement = window.React.createElement;
    }
    
    if (window.React.version && React.version !== window.React.version) {
      if (isDebugMode) console.log('[react-component-node] Patching React.version');
      React.version = window.React.version;
    }
  }
}

import DOMBoundingBoxObserver from './dom-boundingbox-oberver';
import Layout from './layout';
import mergeDeep from './mergedeep';
import NodeSharedPortDefinitions from './node-shared-port-definitions';
import transitionParameter from './node-transitions';

// Tolerant CSS declaration parser: paren-aware ';' split (so url(data:...;base64,...)
// survives), first-':' split (so https:// values survive), applies every valid
// declaration and reports (not swallows) the bad ones. The old parser rejected any
// declaration whose value contained ':' or ';' and then discarded the ENTIRE style
// block on a single bad declaration. Kept in sync with the copy in
// private/xgenia-pro-nodes/src/utils/react-component-node.js (parity-locked by
// private/xgenia-ai-app/tests/stylecss-parser.test.ts).
// Strip /* */ comments (an unterminated comment swallows the rest, as before).
export function stripCssComments(css) {
  let raw = String(css || '');
  let stripped = '';
  while (raw.length) {
    let next = raw.indexOf('/*');
    if (next === -1) next = raw.length;
    stripped += raw.substring(0, next);
    raw = raw.substring(next);
    if (raw.length) {
      let end = raw.indexOf('*/');
      if (end === -1) end = raw.length;
      raw = raw.substring(end + 2);
    }
  }
  return stripped;
}

export function parseStyleCssDeclarations(css) {
  const style = {};
  const errors = [];

  const stripped = stripCssComments(css);

  const decls = [];
  let depth = 0;
  let cur = '';
  for (const ch of stripped) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ';' && depth === 0) {
      decls.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (depth > 0) {
    // An unclosed '(' swallowed every later declaration into `cur`; report it
    // instead of silently applying the mangled tail as one giant declaration.
    // Declarations split cleanly BEFORE the unbalanced one still apply.
    errors.push(`Unbalanced '(' in declaration: "${cur.trim().slice(0, 60)}"`);
  } else if (cur.trim()) decls.push(cur);

  for (const rawDecl of decls) {
    const s = rawDecl.trim();
    if (!s) continue;
    const idx = s.indexOf(':');
    if (idx <= 0) {
      errors.push(`Invalid declaration: "${s.slice(0, 60)}"`);
      continue;
    }
    const prop = s.slice(0, idx).trim();
    const value = s.slice(idx + 1).trim();
    if (!prop || !value) {
      errors.push(`Invalid declaration: "${s.slice(0, 60)}"`);
      continue;
    }
    // Custom properties (--x) keep their name verbatim; everything else camelCases.
    const camel = prop.startsWith('--') ? prop : prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    style[camel] = value;
  }

  return { style, errors };
}

// Conditional group rules wrap rules that still belong to this node, so their
// contents get scoped. @keyframes / @font-face / @property own their inner
// preludes ('from', '50%', …) — those pass through verbatim.
const SCOPED_AT_RULE = /^@(media|supports|container|layer|scope)\b/i;

// Split one CSS block into its flat declaration text and its nested blocks.
// This is what makes `&:hover { … }`, `> * { … }` and `@media … { … }`
// expressible in a styleCss port: the flat part stays inline style (as it always
// has), the blocks become real CSS rules in a per-node <style> element.
// Brace-, paren- AND quote-aware, so `url(a{b)` and `content: "}"` don't derail it.
export function splitCssBlocks(css) {
  const src = stripCssComments(css);
  const errors = [];
  const blocks = [];
  let flat = '';
  let pending = ''; // text since the last ';' or '}' — a declaration, or a selector
  let paren = 0;
  let quote = null;
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

    if (quote) {
      pending += ch;
      if (ch === quote && src[i - 1] !== '\\') quote = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      pending += ch;
      i++;
      continue;
    }
    if (ch === '(') paren++;
    else if (ch === ')') paren = Math.max(0, paren - 1);

    if (ch === '{' && paren === 0) {
      const bodyStart = i + 1;
      let depth = 1;
      let j = bodyStart;
      let q = null;
      let pd = 0;
      while (j < src.length && depth > 0) {
        const c = src[j];
        if (q) {
          if (c === q && src[j - 1] !== '\\') q = null;
        } else if (c === '"' || c === "'") {
          q = c;
        } else if (c === '(') pd++;
        else if (c === ')') pd = Math.max(0, pd - 1);
        else if (pd === 0 && c === '{') depth++;
        else if (pd === 0 && c === '}') {
          depth--;
          if (depth === 0) break;
        }
        j++;
      }
      if (depth > 0) {
        // Unclosed '{' swallowed the rest; report it rather than emitting a
        // truncated rule whose declarations would leak into the next one.
        errors.push(`Unbalanced '{' in rule: "${pending.trim().slice(0, 60)}"`);
        pending = '';
        break;
      }
      const prelude = pending.trim();
      if (prelude) blocks.push({ prelude, body: src.slice(bodyStart, j) });
      else errors.push('Ignored a rule block with no selector');
      pending = '';
      i = j + 1;
      continue;
    }

    if (ch === '}' && paren === 0) {
      errors.push(`Unexpected '}' — dropped "${pending.trim().slice(0, 60)}"`);
      pending = '';
      i++;
      continue;
    }

    pending += ch;
    if (ch === ';' && paren === 0) {
      flat += pending;
      pending = '';
    }
    i++;
  }

  // Trailing text with no ';' is still a declaration (parity with the flat parser).
  flat += pending;
  return { flat, blocks, errors };
}

// Resolve one nested prelude against the enclosing scope selector.
//   '&:hover'  -> '.scope:hover'      (explicit &, anywhere in the selector)
//   ':hover'   -> '.scope:hover'      (leading pseudo attaches to the scope)
//   '> *'      -> '.scope > *'        (leading combinator)
//   '.title'   -> '.scope .title'     (descendant)
function scopeCssSelector(prelude, scope) {
  return prelude
    .split(',')
    .map((part) => {
      const s = part.trim();
      if (!s) return null;
      if (s.indexOf('&') !== -1) return s.replace(/&/g, scope);
      if (s.charAt(0) === ':') return scope + s;
      return scope + ' ' + s;
    })
    .filter(Boolean)
    .join(', ');
}

// Flatten nested blocks into CSS text rooted at `scope`. Declaration bodies are
// emitted verbatim — the browser's own parser handles them, so vendor prefixes,
// !important and every value syntax work without a camelCase round trip.
export function renderScopedCssRules(blocks, scope, errors) {
  let out = '';
  for (const { prelude, body } of blocks) {
    if (prelude.charAt(0) === '@' && !SCOPED_AT_RULE.test(prelude)) {
      // @keyframes / @font-face / @property — body belongs to the at-rule itself.
      out += prelude + ' {' + body + '}\n';
      continue;
    }

    const inner = splitCssBlocks(body);
    if (errors && inner.errors.length) errors.push(...inner.errors);
    const decls = inner.flat.trim();

    if (prelude.charAt(0) === '@') {
      // Conditional group rule: bare declarations inside still target this node.
      let nested = '';
      if (decls) nested += scope + ' { ' + decls + ' }\n';
      nested += renderScopedCssRules(inner.blocks, scope, errors);
      if (nested) out += prelude + ' {\n' + nested + '}\n';
      continue;
    }

    const selector = scopeCssSelector(prelude, scope);
    if (!selector) continue;
    if (decls) out += selector + ' { ' + decls + ' }\n';
    out += renderScopedCssRules(inner.blocks, selector, errors);
  }
  return out;
}

// Full styleCss parse: inline declarations plus the nested blocks around them.
export function parseStyleCss(css) {
  const split = splitCssBlocks(css);
  const flat = parseStyleCssDeclarations(split.flat);
  return { style: flat.style, blocks: split.blocks, errors: split.errors.concat(flat.errors) };
}

// One <style> element per scope class, shared by every node instance that
// resolves to it (component instances reuse the definition's node id, so N
// instances legitimately want the same rules). Refcounted so the last one out
// removes it.
const _scopedCssStyleElements = new Map();

function addOutputPropHandler(node, propCallbacks, propPath) {
  const props = propPath ? node.props[propPath] : node.props;

  for (const propName in propCallbacks) {
    if (props[propName]) {
      const prevCb = props[propName];
      const callback = propCallbacks[propName];
      props[propName] = function() {
        prevCb.apply(this, arguments);
        callback.apply(node, arguments);
      };
    } else {
      // Use a closure instead of bind
      const callback = propCallbacks[propName];
      props[propName] = function() {
        return callback.apply(node, arguments);
      };
    }
  }
  
  // Check if forceUpdate exists before calling it
  if (typeof node.forceUpdate === 'function') {
    node.forceUpdate();
  } else if (node.context && node.context.scheduleUpdate) {
    // Fallback to scheduling an update if forceUpdate doesn't exist
    node.context.scheduleUpdate();
  }
}

function addPrimitiveOutputPropHandler(node, name, output) {
  let prop;

  if (output.type === 'signal') {
    prop = function() {
      node.sendSignalOnOutput(name);
    };
  } else {
    prop = function() {
      const args = Array.prototype.slice.call(arguments);
      node.outputPropValues[name] = output.getValue ? output.getValue.apply(node, args) : args[0];
      node.flagOutputDirty(name);
      if (output.onChange) {
        output.onChange.call(node, node.outputPropValues[name]);
      }
    };
  }

  // Modify addOutputPropHandler to avoid using bind
  const props = output.propPath ? node.props[output.propPath] : node.props;
  const propName = name;
  
  if (props[propName]) {
    const prevCb = props[propName];
    props[propName] = function() {
      prevCb.apply(this, arguments);
      prop.apply(node, arguments);
    };
  } else {
    props[propName] = function() {
      return prop.apply(node, arguments);
    };
  }
  
  // Check if forceUpdate exists before calling it
  if (typeof node.forceUpdate === 'function') {
    node.forceUpdate();
  } else if (node.context && node.context.scheduleUpdate) {
    // Fallback to scheduling an update if forceUpdate doesn't exist
    node.context.scheduleUpdate();
  }
}

function defineRegularInputProp(input, name) {
  if (!input.type) throw new Error(`input ${name} is missing a type`);

  if (input.type.units) {
    input.set = function (value) {
      const props = input.propPath ? this.props[input.propPath] : this.props;
      if (value && value.value !== undefined) {
        // ─── THE VALUE MAY ALREADY CARRY A UNIT (2026-08-15) ──────────────────────
        // (user: "it did not set 800% — it set 800PX, and % was the type")
        // A dimension is stored as {value, unit} and applied by concatenation, so a
        // value that already has a unit produces "800px" + "%" = "800px%". That is not
        // a CSS length, so the browser drops the declaration entirely and the box
        // collapses to auto — while the stored parameter still LOOKS well-formed to
        // every check that inspects its shape.
        //
        // Trust the unit written into the value: someone who typed "800px" meant 800px,
        // and the unit dropdown is the field they did not touch. Repairing here rather
        // than only auditing means an already-corrupted project renders correctly on
        // the next frame instead of needing a migration.
        props[name] = joinDimensionValue(value);
      } else if (typeof value === 'string' && /[a-z%)]$/i.test(value.trim())) {
        // ─── A VALID CSS STRING WAS BEING THROWN AWAY (2026-08-15) ────────────────
        // This branch used to delete the prop for anything that was not a
        // {value, unit} object — including "50%", "800px" and "calc(100% - 20px)",
        // which are complete CSS lengths that need no assembly at all. The port then
        // had NO value, the element fell back to its default size, and nothing said
        // so: the parameter reads back exactly as it was set.
        props[name] = value.trim();
      } else {
        // Still dropped — a bare number is genuinely ambiguous here (the port's
        // declared default is the bare 100 and means 100%, while an authored bare
        // number conventionally means px), so guessing would be worse than refusing.
        // But refusing SILENTLY is what made this class invisible for so long: say it,
        // now that viewer warnings actually reach a console.
        if (value !== undefined && value !== null && value !== '') {
          if (!this._warnedUnusableDim) this._warnedUnusableDim = {};
          if (!this._warnedUnusableDim[name]) {
            this._warnedUnusableDim[name] = true;
            console.warn('[' + (this.name || 'node') + '] "' + name + '" was set to '
              + JSON.stringify(value) + ', which is not a usable CSS length, so the property '
              + 'has been REMOVED and this element falls back to its default size. Pass an '
              + 'explicit unit as a string — "800px", "100%", "50vh". A bare number is '
              + 'ambiguous on this port: its declared default is 100 meaning 100%.');
          }
        }
        delete props[name];
      }
      if (input.onChange) {
        input.onChange.call(this, value);
      }
      
      // Check if forceUpdate exists before calling it
      if (typeof this.forceUpdate === 'function') {
        this.forceUpdate();
      } else if (this.context && this.context.scheduleUpdate) {
        // Fallback to scheduling an update if forceUpdate doesn't exist
        this.context.scheduleUpdate();
      }
    };
  } else {
    input.set = function (value) {
      const props = input.propPath ? this.props[input.propPath] : this.props;
      if (value !== undefined) {
        props[name] = value;
      } else {
        delete props[name];
      }
      if (input.onChange) {
        input.onChange.call(this, value);
      }
      
      // Check if forceUpdate exists before calling it
      if (typeof this.forceUpdate === 'function') {
        this.forceUpdate();
      } else if (this.context && this.context.scheduleUpdate) {
        // Fallback to scheduling an update if forceUpdate doesn't exist
        this.context.scheduleUpdate();
      }
    };
  }
}

function flattenArray(target, array) {
  for (const e of array) {
    if (Array.isArray(e)) {
      flattenArray(target, e);
    } else if (e !== undefined) {
      target.push(e);
    }
  }
}

class XgeniaReactComponent extends React.Component {
  constructor(props) {
    super(props);
    // Store a reference to this component in the xgeniaNode
    if (props.xgeniaNode) {
      props.xgeniaNode.reactComponentRef = this;
    }
    
    // Add state to enable forced updates
    this.state = {
      forceUpdateKey: 0
    };
  }

  componentDidMount() {
    this.props.xgeniaNode.sendSignalOnOutput('didMount');
  }

  componentWillUnmount() {
    this.props.xgeniaNode.sendSignalOnOutput('willUnmount');
    //Remove
    const xgeniaNode = this.props.xgeniaNode;
    if (xgeniaNode.currentVisualStates) {
      const statesToRemove = ['hover', 'pressed', 'focused'];
      const vs = xgeniaNode.currentVisualStates.filter((s) => !statesToRemove.includes(s));
      xgeniaNode.setVisualStates(vs);
    }
    
    // Clear the reference when unmounting
    if (xgeniaNode) {
      xgeniaNode.reactComponentRef = null;
    }
  }

  shouldComponentUpdate(nextProps, nextState) {
    const isDebugMode = false; // Set to true only for debugging
    
    // Always update if the force update key changes
    if (this.state.forceUpdateKey !== nextState.forceUpdateKey) {
      if (isDebugMode) console.log('[XgeniaReactComponent] Force updating due to state key change:', this.props.xgeniaNode?.name);
      return true;
    }
    
    // Check if style properties that require a full render have changed
    const currentStyle = this.props.xgeniaNode?.style || {};
    const nextStyle = nextProps.xgeniaNode?.style || {};
    
    // List of properties that should always force a re-render when changed
    const visualStyleKeys = [
      'backgroundColor', 'background', 'color',
      'borderColor', 'borderLeftColor', 'borderRightColor', 'borderTopColor', 'borderBottomColor',
      'cornerRadius', 'cornerRadiusTopLeft', 'cornerRadiusTopRight', 'cornerRadiusBottomLeft', 'cornerRadiusBottomRight',
      'borderRadius', 'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius'
    ];
    
    // Check if any visual style property has changed
    for (const key of visualStyleKeys) {
      if (currentStyle[key] !== nextStyle[key]) {
        if (isDebugMode) console.log('[XgeniaReactComponent] Updating due to visual style change:', key, 
                    'Old:', currentStyle[key], 'New:', nextStyle[key], 
                    'Node:', this.props.xgeniaNode?.name);
        return true;
      }
    }
    
    // Default to normal React update behavior
    return true;
  }

  render() {
    // Add logging at the start of render - only in debug mode
    const isDebugMode = false; // Set to true only for debugging
    const DEBUG_PREFIX_HELPER = '[XGENIA Core Mod]'; // Prefix for logs
    if (isDebugMode) console.log(DEBUG_PREFIX_HELPER + `Render: Called for "${this.props.xgeniaNode?.name}" (ID: ${this.props.xgeniaNode?.id})`);

    const { xgeniaNode, style, ...otherProps } = this.props;

    // ─── NEVER HAND Layout THE NODE'S OWN STYLE OBJECT (2026-08-15) ──────────────
    // Layout.size/align MUTATE what they are given — flexShrink, flexGrow, position,
    // calc() widths. On the no-style-prop path this used to be `xgeniaNode.style`
    // itself, so every render wrote its computed layout back into the node's shared
    // style and the next render started from a polluted baseline. It also produced the
    // runtime warning the console capture surfaced on 2026-08-15:
    //   "Cannot set style property 'flexShrink' to '0'. Property might be read-only."
    // — Layout's own try/catch reporting that the object it was handed was frozen.
    //
    // Same lesson the attrs/dom channels below already learned ("without mutating the
    // node's own shared attrs object"); style just never got the same treatment. Nothing
    // reads the layout output back off a node's style, so a fresh object each render is
    // a straight fix rather than a behaviour change.
    const finalStyleBase = style
      ? { ...xgeniaNode.style, ...style }
      : { ...xgeniaNode.style };
    let finalStyle = finalStyleBase;

    const props = {
      ref: (ref) => {
        xgeniaNode.innerReactComponentRef = ref;
      },
      style: finalStyle,
      ...xgeniaNode.props,
      ...otherProps
    };

    if (xgeniaNode.xgeniaNodeAsProp) {
      props.xgeniaNode = xgeniaNode;
      const parent = xgeniaNode.getVisualParentNode();
      if (parent && parent.props.layout) {
        props.parentLayout = parent.props.layout;
      }
    }

    // Add data attributes for inspector functionality
    // This allows the inspector to identify XGENIA nodes in the rendered DOM
    if (!props['data-xgenia-node-id']) {
      props['data-xgenia-node-id'] = xgeniaNode.id;
    }
    if (!props['data-xgenia-component']) {
      props['data-xgenia-component'] = xgeniaNode.name;
    }
    // (2026-06-23, trace 1782197236224 issue #3) Emit the node LABEL too. Repo-wide,
    // ~8 consumers read `data-xgenia-node-label` (inspector.js, webview-preload-viewer.js,
    // get_full_webpage_html selector/grep) but NOTHING ever wrote it, so label/type
    // lookups against the rendered HTML always failed and fell back to the UUID. Without
    // this, the AI can't map a DOM node back to its @label.
    if (!props['data-xgenia-node-label']) {
      // AUTHORED LABEL ONLY — never the type. (2026-08-18, traces 1787010262432 /
      // 1787027583089) `xgeniaNode.name` is the node TYPE, so using it as a silent fallback
      // published data-xgenia-node-label="Group" for every Group and
      // "net.xgenia.controls.button" for every Button. Consumers then could not find a node
      // by the name it was given, which is exactly what the attribute exists for: the
      // documented selector matched nothing, and ui_layout_map reported unaddressable
      // "@Group" culprits. Emitting NOTHING when there is no authored label is honest —
      // the type is already on data-xgenia-component for anyone who wants it.
      // (2026-08-18, trace 1787071170156) THE MODEL is where the label actually lives.
      // The previous fix taught NodeModel.createFromExportData to keep `label`, but
      // Node.setNodeModel only does `this.model = nodeModel` — it never copies the label onto
      // the node — so `xgeniaNode.label` stayed undefined and the DOM attribute never appeared.
      // The QA pass caught it immediately: [data-xgenia-node-label='TestProbe'] still matched 0.
      // Read through the model as well.
      const nodeLabel = xgeniaNode.label
        || (xgeniaNode.model && xgeniaNode.model.label)
        || (xgeniaNode.parameters && (xgeniaNode.parameters.nodeLabel || xgeniaNode.parameters.label))
        || (xgeniaNode.model && xgeniaNode.model.parameters
            && (xgeniaNode.model.parameters.nodeLabel || xgeniaNode.model.parameters.label));
      if (nodeLabel) props['data-xgenia-node-label'] = nodeLabel;
    }

    // (2026-08-02, export 1785709004449) …and ROUTE them to the element. Setting them on
    // `props` alone did nothing: NO visual component spreads `...props`. Group, Text, Image,
    // Circle, Columns and the charts each hand-pick what reaches the DOM —
    //   React.createElement(Tag, { className, ...props.attrs, ...props.dom, ...pointer, style })
    // — so every data-* written above was dropped on the floor. `attrs` only ever carried a
    // hand-set data-testid and `dom` was never populated at all.
    //
    // Consequence, repo-wide: not one rendered element carried its node id or label, so
    // get_rendered_output('@Group') always missed ("_domElementMissing"), the documented
    // selector "[data-xgenia-node-id]" matched nothing, simulate_interaction could only
    // target by visible TEXT, and the editor's own inspector (inspector.js reads
    // data-xgenia-node-id) had nothing to read. The AI could change a container's layout
    // and then had no way to measure the result — it concluded "container layout is not
    // verifiable" and fell back to guessing from screenshots.
    //
    // Write into `attrs`/`dom` — the two channels components DO forward — without mutating
    // the node's own shared attrs object.
    const identityAttrs = {
      'data-xgenia-node-id': props['data-xgenia-node-id'],
      'data-xgenia-component': props['data-xgenia-component'],
    };
    if (props['data-xgenia-node-label']) identityAttrs['data-xgenia-node-label'] = props['data-xgenia-node-label'];
    props.attrs = Object.assign({}, props.attrs, identityAttrs);
    props.dom = Object.assign({}, props.dom, identityAttrs);

    xgeniaNode.renderedAtFrame = xgeniaNode.context.frameNumber;

    if (xgeniaNode.useFrame) {
      if (props.textStyle !== undefined) {
        props.style = finalStyle = Object.assign({}, props.textStyle, finalStyle);
      }
      // Hand Layout the declarations the AUTHOR wrote in styleCss (updateAdvancedStyle
      // stores the parsed set as customCssStyles) so it cannot derive over an explicit
      // flex-grow/flex-shrink. See layout.js AUTHOR_OWNED — trace 1787010262432.
      Layout.size(finalStyle, props, xgeniaNode.customCssStyles);
      Layout.align(finalStyle, props, xgeniaNode.customCssStyles);
    }

    const TargetComponent = xgeniaNode.reactComponent;
    if (isDebugMode) {
      console.log(DEBUG_PREFIX_HELPER + `Target Component Type: ${typeof TargetComponent}, Target Component:`, TargetComponent);
      console.log(DEBUG_PREFIX_HELPER + `Props being passed to target:`, props);
      console.log(DEBUG_PREFIX_HELPER + `Style being passed to target:`, finalStyle);
    }
    
    let childrenResult;
    try {
        childrenResult = xgeniaNode.renderChildren();
        if (isDebugMode) console.log(DEBUG_PREFIX_HELPER + `Result of renderChildren():`, childrenResult);
    } catch (e) {
        console.error(DEBUG_PREFIX_HELPER + `Error calling renderChildren() for "${xgeniaNode.name}":`, e);
        childrenResult = null;
    }

    try {
      if (isDebugMode) {
        console.log(DEBUG_PREFIX_HELPER + `Attempting React.createElement for target component "${xgeniaNode.name}"...`);
      }
      const element = React.createElement(TargetComponent, props, childrenResult);
      if (isDebugMode) console.log(DEBUG_PREFIX_HELPER + `Successfully created element for "${xgeniaNode.name}".`);
      return element;
    } catch (e) {
      console.error(DEBUG_PREFIX_HELPER + `*** CRITICAL ERROR creating React element for target component "${xgeniaNode.name}" (ID: ${xgeniaNode.id}):`, e);
      console.error(DEBUG_PREFIX_HELPER + `TargetComponent was:`, TargetComponent);
      console.error(DEBUG_PREFIX_HELPER + `Props were:`, props);
      return React.createElement('div', 
        { style: { border: '2px dashed red', padding: '10px', color: 'red' } }, 
        `Error rendering ${xgeniaNode.name}: ${e.message}`
      );
    }
  }
}

function setStylesOnDOMNode(rootElement, styles, styleTag) {
  let element = rootElement;

  if (styleTag) {
    if (element.getAttribute('xgenia-style-tag') !== styleTag) {
      element = rootElement.querySelector(`[xgenia-style-tag=${styleTag}]`);
    }
  }

  if (!element) return;

  for (const p in styles) {
    element.style[p] = styles[p];
  }
}

let reactKeyCounter = 0;

function createNodeFromReactComponent(def) {
  const isDebugMode = false; // Set to true only for debugging
  const DEBUG_PREFIX_HELPER = '[createNodeFromReactComponent] ';
  if (isDebugMode) {
    console.log(DEBUG_PREFIX_HELPER + `Called for node definition: "${def?.name}"`);
  }

  const { frame } = def;
  if (frame !== undefined) {
    if (frame.dimensions) {
      NodeSharedPortDefinitions.addDimensions(def, typeof frame.dimensions === 'object' ? frame.dimensions : undefined);
    }
    if (frame.position) NodeSharedPortDefinitions.addTransformInputs(def);
    if (frame.margins) NodeSharedPortDefinitions.addMarginInputs(def);
    if (frame.padding) NodeSharedPortDefinitions.addPaddingInputs(def);
    if (frame.align) NodeSharedPortDefinitions.addAlignInputs(def);
  }

  const {
    initialize,
    inputs,
    inputProps,
    inputCss,
    outputs,
    outputProps,
    dynamicports,
    defaultCss = {},
    methods
  } = def;

  const startStyle = Object.assign({}, defaultCss);
  const startStyles = {};

  for (const name in inputCss) {
    const input = inputCss[name];
    const hasDefault = input.hasOwnProperty('default') && input.applyDefault !== false;
    if (input.styleTag && !startStyles.hasOwnProperty(input.styleTag)) {
      startStyles[input.styleTag] = {};
    }

    if (hasDefault) {
      const value = input.type.units ? input.default + input.type.defaultUnit : input.default;
      if (input.styleTag) {
        startStyles[input.styleTag][name] = value;
      } else {
        startStyle[name] = value;
      }
    }
  }

  const useVariants = def.useVariants !== undefined ? def.useVariants : true;

  const ReactComponentNode = {
    name: def.name,
    docs: def.docs,
    displayNodeName: def.displayNodeName || def.displayName,
    shortDesc: '',
    category: 'Visual',
    allowChildren: def.allowChildren === undefined ? true : def.allowChildren,
    visualStates: def.visualStates,
    allowAsExportRoot: def.allowAsExportRoot,
    singleton: def.singleton,
    useVariants,
    usePortAsLabel: def.usePortAsLabel,
    portLabelTruncationMode: def.portLabelTruncationMode,
    connectionPanel: def.connectionPanel,
    nodeDoubleClickAction: def.nodeDoubleClickAction,
    initialize() {
      this.reactKey = 'key' + reactKeyCounter++;
      this.children = [];
      if (hasChildCountOutput) {
        this.childrenCount = 0;
      }
      this.props = { styles: {} };
      this.outputPropValues = {};
      this.style = Object.assign({}, startStyle);

      for (const styleTag in startStyles) {
        this.props.styles[styleTag] = Object.assign({}, startStyles[styleTag]);
      }
      this.childIndex = 0;
      this.clientBoundingRect = {};
      this.xgeniaNodeAsProp = def.xgeniaNodeAsProp ? true : false;

      const pollDelay = this.context && this.context.runningInCanvas ? 300 : 0;
      const self = this;
      const boundingBoxObserverCallbackWrapper = function(attribute, rect) {
        self.clientBoundingRect = rect;
        if (attribute === 'x') self.flagOutputDirty('screenPositionX');
        else if (attribute === 'y') self.flagOutputDirty('screenPositionY');
        else if (attribute === 'width') self.flagOutputDirty('boundingWidth');
        else if (attribute === 'height') self.flagOutputDirty('boundingHeight');
      };
      this.boundingBoxObserver = new DOMBoundingBoxObserver(boundingBoxObserverCallbackWrapper, pollDelay);
      this.wantsToBeMounted = true;
      this.useFrame = !!frame;

      for (const name in inputProps) {
        const input = inputProps[name];
        if (input.propPath && !this.props.hasOwnProperty(input.propPath)) {
          this.props[input.propPath] = {};
        }
        const props = input.propPath ? this.props[input.propPath] : this.props;
        if (input.hasOwnProperty('default')) {
          if (input.type.defaultUnit && input.default !== undefined) {
            props[name] = input.default + input.type.defaultUnit;
          } else {
            props[name] = input.default;
          }
        }
      }

      for (const outputName in outputProps) {
        const output = outputProps[outputName];
        if (output.propPath && !this.props.hasOwnProperty(output.propPath)) {
          this.props[output.propPath] = {};
        }
        if (!output.props) {
          addPrimitiveOutputPropHandler(this, outputName, output);
        } else {
          addOutputPropHandler(this, output.props, output.propPath);
        }
      }

      this.reactComponentRef = null;
      try {
        this.reactComponent = def.getReactComponent.call(this);
      } catch (e) {
        console.error(DEBUG_PREFIX_HELPER + `Initialize: Error calling getReactComponent for "${this.name}":`, e);
        this.reactComponent = null;
      }

      if (initialize) {
        initialize.call(this);
      }
    },
    getInspectInfo: def.getInspectInfo,
    nodeScopeDidInitialize: def.nodeScopeDidInitialize,
    dynamicports,
    inputs: {
      cssClassName: {
        index: 100010,
        displayName: 'CSS Class',
        group: 'Advanced HTML',
        type: 'string',
        default: '',
        set(value) {
          this._cssUserClassName = value;
          this._updateClassName();
        }
      },
      styleCss: {
        index: 100011,
        displayName: 'CSS Style',
        group: 'Advanced HTML',
        // Was 'text' (no highlighting at all), then 'css' — but Monaco validates a
        // 'css' model as a COMPLETE stylesheet, and a bare declaration list is a parse
        // error there, so every correct property the user typed got a red squiggle.
        // 'scss' is a CSS superset that also understands the '&' nesting styleCss
        // supports (so bracket matching / folding / auto-indent work inside
        // '&:hover { … }'), and it carries its OWN Monaco diagnostics options —
        // CodeEditor/index.ts turns validation off for scss only, leaving the CSS
        // Definition node's 'css' port fully validated. Highlighting and completion
        // are unaffected. Still opted into the editor's 3-way source merge
        // (NodeGraphNode.isSourceCodePort lists scss) so two branches editing the same
        // node's CSS merge line-by-line instead of conflicting wholesale.
        // No allowEditOnly: the port is connectable, so CSS can be driven from a
        // String, Expression, Variable or JS Function output.
        type: { name: 'string', codeeditor: 'scss' },
        // Was '/* background-color: red; */' — a leftover dev placeholder that
        // leaked into EVERY node's serialized styleCss, cluttering inspects and
        // repeatedly read by the AI as a real/leftover style (trace 1784051747260,
        // bug #10). Empty default keeps nodes clean; real CSS still overrides.
        default: '',
        set(value) {
          this.updateAdvancedStyle({ content: value });
        }
      }
    },
    outputs: {
      childIndex: { displayName: 'Child Index', type: 'number', get() { return this.childIndex; } },
      this: { displayName: 'This', type: 'reference', get() { return this; } },
      screenPositionX: {
        group: 'Bounding Box', displayName: 'Screen Position X', type: 'number',
        get() { return this.clientBoundingRect.x; },
        onFirstConnectionAdded() { this.boundingBoxObserver.addObserver(); },
        onLastConnectionRemoved() { this.boundingBoxObserver.removeObserver(); }
      },
      screenPositionY: {
        group: 'Bounding Box', displayName: 'Screen Position Y', type: 'number',
        get() { return this.clientBoundingRect.y; },
        onFirstConnectionAdded() { this.boundingBoxObserver.addObserver(); },
        onLastConnectionRemoved() { this.boundingBoxObserver.removeObserver(); }
      },
      boundingWidth: {
        group: 'Bounding Box', displayName: 'Width', type: 'number',
        get() { return this.clientBoundingRect.width; },
        onFirstConnectionAdded() { this.boundingBoxObserver.addObserver(); },
        onLastConnectionRemoved() { this.boundingBoxObserver.removeObserver(); }
      },
      boundingHeight: {
        group: 'Bounding Box', displayName: 'Height', type: 'number',
        get() { return this.clientBoundingRect.height; },
        onFirstConnectionAdded() { this.boundingBoxObserver.addObserver(); },
        onLastConnectionRemoved() { this.boundingBoxObserver.removeObserver(); }
      },
      didMount: { group: 'Mounted', displayName: 'Did Mount', type: 'signal' },
      willUnmount: { group: 'Mounted', displayName: 'Will Unmount', type: 'signal' }
    },
    methods: {
      updateAdvancedStyle(params) {
        if (this.customCssStyles) {
          this.removeStyle(Object.keys(this.customCssStyles));
          this.customCssStyles = undefined;
        }

        // Tolerant semantics: apply every valid declaration, report the bad
        // ones as a warning — one bad declaration no longer drops the block.
        // Nested blocks are split off first: `&:hover { … }`, `> * { … }`,
        // `@media … { … }` and `@keyframes … { … }` become real CSS rules scoped
        // to this node, while the bare declarations around them stay inline.
        const { style, blocks, errors } = parseStyleCss(params.content);

        // Unconditional application (parity with the pre-tolerant code):
        // when the parse yields zero keys (e.g. styleCss cleared to ''), the
        // removeStyle of the prior keys above IS the runtime clear path —
        // setStyle({}) is a no-op merge, and customCssStyles = {} keeps the
        // bookkeeping identical to the old `style && this.setStyle(style)` /
        // `this.customCssStyles = style` behavior.
        this.setStyle(style);
        this.customCssStyles = style;

        this.updateScopedCssRules(blocks, errors);

        if (errors.length) {
          this.context.editorConnection.sendWarning(this.nodeScope.componentOwner.name, this.id, 'css-parse-waring', { message: 'styleCss: ' + errors.length + ' declaration(s) skipped:<br>' + errors.join('<br>') });
        } else {
          this.context.editorConnection.clearWarning(this.nodeScope.componentOwner.name, this.id, 'css-parse-waring');
        }
      },

      // The class the node's own rules are scoped under. Prefixed so it can never
      // start with a digit, and sanitized because ids reach us as raw strings.
      cssScopeClassName() {
        return 'xg-css-' + String(this.id).replace(/[^A-Za-z0-9_-]/g, '-');
      },

      // props.className is the union of the user's CSS Class input and the
      // generated scope class — either can change independently, so neither may
      // overwrite the other.
      _updateClassName() {
        const parts = [];
        if (this._cssUserClassName) parts.push(this._cssUserClassName);
        if (this._cssScopeActive) parts.push(this.cssScopeClassName());
        this.props.className = parts.join(' ');
        this.forceUpdate();
      },

      updateScopedCssRules(blocks, errors) {
        // SSR has no document to inject into and no DOM to class.
        if (typeof document === 'undefined') return;

        const scopeClass = this.cssScopeClassName();
        const cssText = blocks && blocks.length ? renderScopedCssRules(blocks, '.' + scopeClass, errors) : '';

        if (!cssText) {
          this.releaseScopedCssRules();
          return;
        }

        let entry = _scopedCssStyleElements.get(scopeClass);
        if (!entry) {
          const el = document.createElement('style');
          el.type = 'text/css';
          el.setAttribute('data-xg-css-scope', scopeClass);
          document.head.appendChild(el);
          entry = { el, refs: 0 };
          _scopedCssStyleElements.set(scopeClass, entry);
        }
        entry.el.textContent = cssText;

        if (!this._cssScopeRegistered) {
          this._cssScopeRegistered = true;
          entry.refs++;
          if (!this._cssScopeDeleteListenerAdded) {
            // The node can be torn down (For Each churn, page switch) without the
            // input ever being cleared, so release on delete too.
            this._cssScopeDeleteListenerAdded = true;
            this.addDeleteListener(() => this.releaseScopedCssRules());
          }
        }

        if (!this._cssScopeActive) {
          this._cssScopeActive = true;
          this._updateClassName();
        }
      },

      releaseScopedCssRules() {
        if (this._cssScopeRegistered) {
          this._cssScopeRegistered = false;
          const scopeClass = this.cssScopeClassName();
          const entry = _scopedCssStyleElements.get(scopeClass);
          if (entry) {
            entry.refs--;
            if (entry.refs <= 0) {
              if (entry.el.parentNode) entry.el.parentNode.removeChild(entry.el);
              _scopedCssStyleElements.delete(scopeClass);
            }
          }
        }
        if (this._cssScopeActive) {
          this._cssScopeActive = false;
          this._updateClassName();
        }
      },

      setChildIndex(index) {
        this.childIndex = index;
        this.flagOutputDirty('childIndex');
      },
      updateChildIndices() {
        let indexOffset = 0;
        for (let i = 0; i < this.children.length; i++) {
          const child = this.children[i];
          if (child.name === 'For Each' || child.name === 'Component Children') {
            indexOffset--;
          }
          child.setChildIndex && child.setChildIndex(i + indexOffset);
        }
      },
      updateChildrenCount() {
        let count = 0;
        this.children.forEach((child) => {
          if (child?.model?.type === 'For Each') {
            count += child.model.children.length;
          } else {
            count++;
          }
        });
        this.childrenCount = count;
        this.flagOutputDirty('childrenCount');
      },
      addChild(child, index) {
        // (trace 1785024174577) IDEMPOTENT: re-attaching a child that is already mounted
        // used to splice it in a SECOND time, rendering the same node twice — the
        // user-reported "the live DOM shows extra Save buttons after remounts", which no
        // amount of graph-side deleting could clear because the graph only had one node.
        // Re-attaching at a NEW index is still honoured (move, not duplicate).
        const existing = this.children.indexOf(child);
        if (existing !== -1) {
          if (index === undefined || index === existing) return; // already exactly where asked
          this.children.splice(existing, 1); // move: drop the old position first
          if (index > existing) index--;
        }
        if (index === undefined) index = this.children.length;
        child.parent = this;
        this.children.splice(index, 0, child);
        this.cachedChildren = undefined;
        this.scheduleUpdateChildCountAndIndicies();
        this.forceUpdate();
      },
      removeChild(child) {
        const index = this.children.indexOf(child);
        if (index !== -1) {
          this.children.splice(index, 1);
          child.parent = undefined;
          this.cachedChildren = undefined;
          this.scheduleUpdateChildCountAndIndicies();
          this.forceUpdate();
        }
      },
      contains(node) {
        if (this.children.indexOf(node) !== -1) return true;
        return this.children.some((child) => child.contains && child.contains(node));
      },
      scheduleUpdateChildCountAndIndicies() {
        if (this.updateChildIndiciesScheduled) return;
        this.updateChildIndiciesScheduled = true;
        this.scheduleAfterInputsHaveUpdated(() => {
          this.updateChildIndices();
          if (hasChildCountOutput) this.updateChildrenCount();
          this.updateChildIndiciesScheduled = false;
        });
      },
      getChildren() { return this.children; },
      isChild(child) { return this.children.indexOf(child) !== -1; },
      getChildRoot() { return this; },
      
      // CHANGE 2: Reworked forceUpdate method to be both effective and non-flickering
      forceUpdate() {
        const isDebugMode = false; // Set to true for deep debugging
        if (isDebugMode) console.log(`[forceUpdate] Request for: ${this.name} (ID: ${this.id})`, this.forceUpdateScheduled ? '(already scheduled)' : '');
        
        if (this.forceUpdateScheduled) return;
        this.forceUpdateScheduled = true;

        if (!this.context || !this.context.eventEmitter) {
          console.warn(`[forceUpdate] Context/eventEmitter missing for node: ${this.id}, ${this.name}`);
          this.forceUpdateScheduled = false;
          return;
        }
          
          this.context.eventEmitter.once('frameEnd', () => {
            this.forceUpdateScheduled = false;
          if (isDebugMode) console.log(`[forceUpdate] FrameEnd for: ${this.name}`);

          if (this.renderedAtFrame === this.context.frameNumber && !isDebugMode) {
             // In debug mode, we might want to force it anyway to see the flow.
             // Otherwise, skip if already rendered this frame.
              return;
            }

          // STRATEGY 1: SELF-UPDATE (for standard wrapped components)
          // If the node has its own wrapper component instance, we can just update its state.
          // This is efficient and self-contained.
          if (this.reactComponentRef && typeof this.reactComponentRef.setState === 'function') {
            if (isDebugMode) console.log(`[forceUpdate] Using SELF-UPDATE strategy for ${this.name}`);
            this.reactComponentRef.setState({ forceUpdateKey: Math.random() });
            return; // Update is handled, we're done.
          }

          // STRATEGY 2: PARENT-DRIVEN UPDATE (for direct-rendered children like Pixi)
          // This node cannot update itself. We must ask its parent to re-render it.
          if (isDebugMode) console.log(`[forceUpdate] Using PARENT-DRIVEN strategy for ${this.name}`);
          const parent = this.getVisualParentNode();
          if (parent) {
            // CRITICAL FIX: Invalidate the parent's child cache. Without this,
            // the parent will re-render using its old, cached children, and
            // the UI will not reflect the change.
            if (isDebugMode) console.log(`[forceUpdate] Invalidating cache for parent: ${parent.name}`);
            parent.cachedChildren = undefined;
            
            // Now, trigger the parent's update cycle. It will now re-run its
            // `renderChildren` logic and pick up the changes.
            parent.forceUpdate();
            } else {
            // This is a root node with no parent. Fallback to a global update.
            if (isDebugMode) console.log(`[forceUpdate] Node ${this.name} is a root. Using global scheduleUpdate.`);
            if (this.context && this.context.scheduleUpdate) {
                this.context.scheduleUpdate();
            }
          }
        });
        
        // Always schedule a global update to ensure the 'frameEnd' event fires.
          this.context.scheduleUpdate();
      },
      
      _resetReactVirtualDOM() {
        const isDebugMode = false;
        if (isDebugMode) console.log(`[forceUpdate] MANUALLY RESETTING VDOM for: ${this.id}, ${this.name}. This may cause a flicker.`);
        // This is a "sledgehammer" method and should be avoided in normal operation.
        // It causes a flicker by unmounting and remounting the component.
        this.reactKey = 'key' + reactKeyCounter++;
        const parent = this.getVisualParentNode();
        if (parent) {
          if (isDebugMode) console.log(`[forceUpdate] Resetting parent (${parent.name}) cached children and forcing update.`);
          parent.cachedChildren = undefined;
          parent.forceUpdate();
        } else {
          if (isDebugMode) console.warn(`[forceUpdate] No parent found for VDOM reset of: ${this.id}, ${this.name}`);
        }
      },
      
      triggerDidMount() {
        if (this.wantsToBeMounted && !this.didCallTriggerDidMount) {
          this.didCallTriggerDidMount = true;
          if (this.hasOutput('didMount')) this.sendSignalOnOutput('didMount');
          if (this.props.didMount) this.props.didMount();
          if (this.didMount) this.didMount();
        }
        this.children.forEach((child) => {
          child.triggerDidMount && child.triggerDidMount();
        });
      },

      render() {
        const isDebugMode = false;
        const DEBUG_PREFIX_HELPER = '[XGENIA Core Mod]';
        if (isDebugMode) console.log(DEBUG_PREFIX_HELPER + `Render: Called for "${this.name}" (ID: ${this.id}).`);

        if (!this.wantsToBeMounted) {
          if (isDebugMode) console.log(DEBUG_PREFIX_HELPER + `Render: Node "${this.name}" not mounted.`);
          return null;
        }
        
        const isPixiNode = this.name && this.name.startsWith('pixi.');
        const parentNode = this.getVisualParentNode();
        const isParentPixiStage = parentNode && parentNode.name === 'pixi.Stage';
        const isParentPixiContainer = parentNode && parentNode.name === 'pixi.Container';
        const isPixiStage = this.name === 'pixi.Stage';
        const shouldUseDirectRendering = isPixiStage || (isPixiNode && (isParentPixiStage || isParentPixiContainer));
        
        if (isDebugMode && isPixiNode) {
          console.log(DEBUG_PREFIX_HELPER + `Detected Pixi component: ${this.name}. Parent is Pixi Stage: ${isParentPixiStage}, Parent is Pixi Container: ${isParentPixiContainer}`);
        }

        if (shouldUseDirectRendering) {
          if (isDebugMode) console.log(DEBUG_PREFIX_HELPER + `Direct rendering for Pixi component: ${this.name}.`);
          if (!this.reactComponent) {
            console.error(DEBUG_PREFIX_HELPER + `Render: FAILED for Pixi component (${this.name}). this.reactComponent is invalid.`);
            return null; 
          }
          const directProps = {
            key: this.reactKey,
            ref: (ref) => {
              this.innerReactComponentRef = ref;
              this.reactComponentRef = {current: ref};
            },
            style: this.style,
            ...this.props,
            xgeniaNode: this
          };
          if (parentNode && parentNode.props && parentNode.props.layout) {
            directProps.parentLayout = parentNode.props.layout;
          }
          const children = this.renderChildren();
          try {
            return React.createElement(this.reactComponent, directProps, children);
          } catch (e) {
            console.error(DEBUG_PREFIX_HELPER + `Error creating direct Pixi component:`, e);
            return React.createElement('div', { style: { border: '2px dashed orange', padding: '5px', color: 'orange' } }, `Error rendering ${this.name}: ${e.message}`);
          }
        } else {
          if (isDebugMode) console.log(DEBUG_PREFIX_HELPER + `Standard rendering for ${this.name}`);
          if (!this.reactComponent) {
            console.error(DEBUG_PREFIX_HELPER + `Render: FAILED for "${this.name}". this.reactComponent is invalid.`);
            return null;
          }
          try {
            return React.createElement(XgeniaReactComponent, {
              key: this.reactKey,
              xgeniaNode: this,
              ref: (ref) => { this.reactComponentRef = ref; }
            });
          } catch (e) {
            console.error(DEBUG_PREFIX_HELPER + `Error creating XgeniaReactComponent:`, e);
            return React.createElement('div', { style: { border: '2px dashed red', padding: '5px', color: 'red' } }, `Error wrapping ${this.name}: ${e.message}`);
          }
        }
      },

      renderChildren() {
        if (!this.cachedChildren) {
          let c = this.children.map((child) => {
            if (typeof child?.render === 'function') {
              return child.render();
            } else {
              const isDebugMode = false;
              if (isDebugMode) console.warn(`[renderChildren] Child node "${child?.name}" (ID: ${child?.id}) is missing render(). Skipping.`);
              return null;
            }
          });
          let children = [];
          flattenArray(children, c);
          if (children.length === 0) children = null;
          else if (children.length === 1) children = children[0];
          this.cachedChildren = children;
        }
        return this.cachedChildren;
      },

      setStyle(newStyles, styleTag) {
        const styleObject = styleTag ? this.props.styles[styleTag] : this.style;
        for (const p in newStyles) {
          styleObject[p] = newStyles[p];
        }
        const domElement = this.getDOMElement();
        if (!domElement) {
          this.forceUpdate();
          return;
        }
        let forceUpdate = false;
        if (!styleTag) {
          forceUpdate = newStyles.hasOwnProperty('opacity') && ((domElement.style.opacity === '0' && newStyles.opacity > 0) || (domElement.style.opacity !== '0' && newStyles.opacity === 0));
          if (newStyles.transform) {
            let transform = newStyles.transform;
            const parent = this.getVisualParentNode();
            if (this.style.position === 'absolute' || !parent || !parent.style.flexDirection) {
              if (this.props.alignX === 'center' && !(domElement.style.marginLeft && domElement.style.marginRight)) transform = 'translateX(-50%) ' + transform;
              if (this.props.alignY === 'center' && !(domElement.style.marginTop && domElement.style.marginBottom)) transform = 'translateY(-50%) ' + transform;
            }
            newStyles.transform = transform;
          }
          const marginsChanged = newStyles.hasOwnProperty('marginLeft') || newStyles.hasOwnProperty('marginRight') || newStyles.hasOwnProperty('marginTop') || newStyles.hasOwnProperty('marginBottom');
          const sizeInPercent = (this.props.width && this.props.width.endsWith('%')) || (this.props.height && this.props.height.endsWith('%'));
          if (sizeInPercent && marginsChanged) forceUpdate = true;
          if (newStyles.position || newStyles.flexDirection || newStyles.clip) forceUpdate = true;
          if (newStyles.hasOwnProperty('backgroundColor') || newStyles.hasOwnProperty('background') || newStyles.hasOwnProperty('color') || newStyles.hasOwnProperty('borderColor') || newStyles.hasOwnProperty('borderLeftColor') || newStyles.hasOwnProperty('borderRightColor') || newStyles.hasOwnProperty('borderTopColor') || newStyles.hasOwnProperty('borderBottomColor') || newStyles.hasOwnProperty('cornerRadius') || newStyles.hasOwnProperty('cornerRadiusTopLeft') || newStyles.hasOwnProperty('cornerRadiusTopRight') || newStyles.hasOwnProperty('cornerRadiusBottomLeft') || newStyles.hasOwnProperty('cornerRadiusBottomRight') || newStyles.hasOwnProperty('borderRadius') || newStyles.hasOwnProperty('borderBottomLeftRadius') || newStyles.hasOwnProperty('borderBottomRightRadius') || newStyles.hasOwnProperty('borderTopLeftRadius') || newStyles.hasOwnProperty('borderTopRightRadius')) {
            forceUpdate = true;
          }
        }
        if (forceUpdate) {
          this.forceUpdate();
        } else {
          setStylesOnDOMNode(domElement, newStyles, styleTag);
        }
      },
      
      removeStyle(styles, styleTag) {
        const styleObject = styleTag ? this.props.styles[styleTag] : this.style;
        for (const p of styles) delete styleObject[p];
        const domElement = this.getDOMElement();
        if (!domElement) {
          this.forceUpdate();
          return;
        }
        let forceUpdate = false;
        if (!styleTag) {
          const forceUpdateAttributes = { marginTop: true, marginBottom: true, marginLeft: true, marginRight: true };
          for (const p of styles) if (forceUpdateAttributes[p]) forceUpdate = true;
        }
        const newStyles = {};
        for (const p of styles) newStyles[p] = '';
        setStylesOnDOMNode(domElement, newStyles, styleTag);
        if (forceUpdate) this.forceUpdate();
      },
      
      getStyle(style) { return this.style[style]; },
      getRef() { return this.reactComponentRef; },

      getDOMElement() {
        const ref = this.getRef();
        if (!ref) return null;
        if (ref.current) {
          if (ref.current instanceof HTMLElement) return ref.current;
          if (ref.current.domElement instanceof HTMLElement) return ref.current.domElement;
        }
        if (ref instanceof HTMLElement) return ref;
        if (ref.domElement instanceof HTMLElement) return ref.domElement;
        if (ref.elementRef && ref.elementRef.current instanceof HTMLElement) return ref.elementRef.current;
        if (ref._owner && ref._owner.stateNode instanceof HTMLElement) return ref._owner.stateNode;
        return null;
      },
      
      getVisualParentNode() {
        if (this.parent) return this.parent;
        let component = this.nodeScope.componentOwner;
        while (!component.parent && component.parentNodeScope) {
          component = component.parentNodeScope.componentOwner;
        }
        return component ? component.parent : undefined;
      },
      
      setVariant(variant) {
        this._stopStateTransitions();
        this.variant = variant;
        const parameters = {};
        variant && mergeDeep(parameters, variant.parameters);
        mergeDeep(parameters, this.model.parameters);
        if (this.currentVisualStates) {
          const stateParameters = this.getParametersForStates(this.currentVisualStates);
          mergeDeep(parameters, stateParameters);
        }
        const parametersToSet = Object.keys(parameters).filter((p) => !this._hasInputBeenSetFromAConnection(p));
        for (const inputName of parametersToSet) {
          this.registerInputIfNeeded(inputName);
          if (this.hasInput(inputName)) {
            this.queueInput(inputName, parameters[inputName]);
          }
        }
      },
      
      getParameter(name) {
        if (this.model.parameters.hasOwnProperty(name)) return this.model.parameters[name];
        else if (this.variant && this.variant.parameters.hasOwnProperty(name)) return this.variant.parameters[name];
        else return this.context.getDefaultValueForInput(this.model.type, name);
      },
      
      getParametersForStates(states) {
        const params = {};
        if (this.variant) {
          for (const state of states) {
            if (this.variant.stateParameters && this.variant.stateParameters.hasOwnProperty(state)) {
              mergeDeep(params, this.variant.stateParameters[state]);
            }
          }
        }
        for (const param in params) {
          if (this.model.parameters.hasOwnProperty(param)) {
            if (isObject(params[param])) mergeDeep(params[param], this.model.parameters[param]);
            else params[param] = this.model.parameters[param];
          }
        }
        if (this.model.stateParameters) {
          for (const state of states) {
            if (this.model.stateParameters.hasOwnProperty(state)) {
              mergeDeep(params, this.model.stateParameters[state]);
            }
          }
        }
        return params;
      },
      
      _getNewState(prevStates, newStates) {
        const addedStates = newStates.filter((value) => !(prevStates || []).includes(value));
        const newState = addedStates.length ? addedStates[0] : 'neutral';
        return newState === '' ? 'neutral' : newState;
      },
      
      _getDefaultTransition(state) {
        if (this.model.defaultStateTransitions && this.model.defaultStateTransitions[state] && this.model.defaultStateTransitions[state].curve) return this.model.defaultStateTransitions[state];
        else if (this.variant && this.variant.defaultStateTransitions && this.variant.defaultStateTransitions[state] && this.variant.defaultStateTransitions[state].curve) return this.variant.defaultStateTransitions[state];
      },
      
      _getStateTransition(state) {
        let transitions = {};
        if (this.model.stateTransitions && this.model.stateTransitions[state]) Object.assign(transitions, this.model.stateTransitions[state]);
        if (this.variant && this.variant.stateTransitions && this.variant.stateTransitions[state]) Object.assign(transitions, this.variant.stateTransitions[state]);
        return transitions;
      },
      
      setVisualStates(newStates) {
        if (!this.model) return;
        const statesAreEqual = this.currentVisualStates && newStates.length === this.currentVisualStates.length && newStates.every((val, index) => val === this.currentVisualStates[index]);
        if (statesAreEqual) return;
        const prevStateParams = this.currentVisualStates ? this.getParametersForStates(this.currentVisualStates) : {};
        const newStateParams = this.getParametersForStates(newStates);
        const newState = this._getNewState(this.currentVisualStates, newStates);
        this.currentVisualStates = newStates;
        const newValues = {};
        for (const param in prevStateParams) {
          if (!newStateParams.hasOwnProperty(param) && !this._hasInputBeenSetFromAConnection(param)) {
            const value = this.getParameter(param);
            if (value !== undefined) newValues[param] = this.getParameter(param);
            }
          }
        for (const param in newStateParams) {
          if (!this._hasInputBeenSetFromAConnection(param) && newStateParams[param] !== undefined) {
            newValues[param] = newStateParams[param];
          }
        }
        const defaultTransition = this._getDefaultTransition(newState);
        const stateTransition = this._getStateTransition(newState);
        for (const param in newValues) {
          if (stateTransition[param] && stateTransition[param].curve) transitionParameter(this, param, newValues[param], stateTransition[param]);
          else if (!stateTransition[param] && defaultTransition) transitionParameter(this, param, newValues[param], defaultTransition);
          else {
            if (this._transitions && this._transitions[param]) {
              this._transitions[param].stop();
              delete this._transitions[param];
            }
            this.queueInput(param, newValues[param]);
          }
        }
      },
      
      _getVisualStates() { return this.currentVisualStates || []; },
      
      _stopStateTransitions() {
        if (!this._transitions) return;
        for (const name in this._transitions) {
          this._transitions[name].stop();
          delete this._transitions[name];
        }
      }
    }
  };

  if (useVariants) {
    ReactComponentNode.inputs.variant = {
      displayName: 'Variant', group: 'General', type: { name: 'string', allowConnectionsOnly: true },
      set(variantName) {
        if (this.variant && this.variant.name === variantName) return;
        const variant = this.context.variants.getVariant(this.model.type, variantName);
        variant && this.setVariant(variant);
      }
    };
  }

  if (def.mountedInput !== false) {
    ReactComponentNode.inputs.mounted = {
      displayName: 'Mounted', index: 9999, type: 'boolean', group: 'General', default: true,
      set(value) {
        value = !!value;
        if (this.wantsToBeMounted !== value) {
          this.wantsToBeMounted = value;
          const parent = this.getVisualParentNode();
          if (parent) {
            parent.cachedChildren = undefined;
            parent.forceUpdate();
          }
        }
      }
    };
  }

  const hasChildCountOutput = ReactComponentNode.allowChildren || ReactComponentNode.displayName;
  if (hasChildCountOutput) {
    ReactComponentNode.outputs.childrenCount = { displayName: 'Children Count', type: 'number', get() { return this.childrenCount; } };
  }

  for (const name in inputs) ReactComponentNode.inputs[name] = inputs[name];
  
  for (const inputName in inputProps) {
    const input = inputProps[inputName];
    if (input.type === 'node') {
      input.type = 'reference';
      input.set = function (value) {
        const props = input.propPath ? this.props[input.propPath] : this.props;
        if (value !== undefined) props[inputName] = value.render();
        else delete props[inputName];
        this.forceUpdate();
      };
    } else {
      if (input.type === 'signal') console.error(`Error: Signals not supported as a react prop. node: '${def.name}' input: '${inputName}'`);
      else defineRegularInputProp(input, inputName);
    }
    ReactComponentNode.inputs[inputName] = input;
  }

  for (const name in inputCss) {
    const input = inputCss[name];
    const styleTargetName = input.targetStyleProperty || name;
    if (input.type.units) {
      input.set = function (value) {
        if (typeof value !== 'object' && input.type.defaultUnit) value = { value, unit: input.type.defaultUnit };
        if (typeof value === 'object' && value.value !== undefined) this.setStyle({ [styleTargetName]: joinDimensionValue(value) }, input.styleTag);
        else if (value !== undefined) this.setStyle({ [styleTargetName]: value }, input.styleTag);
        else this.removeStyle([styleTargetName], input.styleTag);
        if (input.onChange) input.onChange.call(this, value);
      };
    } else {
      input.set = function (value) {
        if (value !== undefined) this.setStyle({ [styleTargetName]: value }, input.styleTag);
        else this.removeStyle([styleTargetName], input.styleTag);
        if (input.onChange) input.onChange.call(this, value);
      };
    }
    ReactComponentNode.inputs[name] = input;
  }

  for (const name in outputs) ReactComponentNode.outputs[name] = outputs[name];

  for (const name in outputProps) {
    const output = outputProps[name];
    if (output.type !== 'signal') {
      output.get = function () { return this.outputPropValues[name]; };
    }
    ReactComponentNode.outputs[name] = output;
  }

  for (const name in methods) ReactComponentNode.methods[name] = methods[name];
  
  // No-op closure wrappers are unnecessary as the methods are defined within the object scope and called with .call(this) or .apply(this)
  
  return {
    node: ReactComponentNode,
    setup: def.setup
  };
}

function isObject(item) {
  return item && typeof item === 'object' && !Array.isArray(item);
}

export { createNodeFromReactComponent };
