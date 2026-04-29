'use strict';

import React from 'react';

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
        props[name] = value.value + value.unit;
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

    let finalStyle = xgeniaNode.style;

    if (style) {
      finalStyle = {
        ...xgeniaNode.style,
        ...style
      };
    }

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

    xgeniaNode.renderedAtFrame = xgeniaNode.context.frameNumber;

    if (xgeniaNode.useFrame) {
      if (props.textStyle !== undefined) {
        props.style = finalStyle = Object.assign({}, props.textStyle, finalStyle);
      }
      Layout.size(finalStyle, props);
      Layout.align(finalStyle, props);
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
          this.props.className = value;
          this.forceUpdate();
        }
      },
      styleCss: {
        index: 100011,
        displayName: 'CSS Style',
        group: 'Advanced HTML',
        type: { name: 'string', codeeditor: 'text', allowEditOnly: true },
        default: '/* background-color: red; */',
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

        let style;
        let errorMessage = '';
        let rawCss = (params.content || '').replace('\n', '');
        let css = '';
        while (rawCss.length) {
          let nextComment = rawCss.indexOf('/*');
          if (nextComment === -1) nextComment = rawCss.length;
          css += rawCss.substring(0, nextComment);
          rawCss = rawCss.substring(nextComment);
          if (rawCss.length) {
            let endComment = rawCss.indexOf('*/');
            if (endComment === -1) endComment = rawCss.length;
            rawCss = rawCss.substring(endComment + 2);
          }
        }
        function trim(s) { return s.replace(/^\s+|\s+$/gm, ''); }
        const styles = css.split(';').map(trim).filter((s) => s.length);
        style = {};
        for (const s of styles) {
          const parts = s.split(':').map(trim);
          if (s.indexOf('\n') !== -1) errorMessage += 'Missing semicolon: ' + s.split('\n')[0];
          else if (parts.length !== 2) errorMessage += 'Syntax error: ' + s;
          else {
            const nameParts = parts[0].split('-');
            for (let i = 1; i < nameParts.length; i++) {
              nameParts[i] = nameParts[i][0].toUpperCase() + nameParts[i].substring(1);
            }
            style[nameParts.join('')] = parts[1];
          }
        }

        if (errorMessage) {
          this.context.editorConnection.sendWarning(this.nodeScope.componentOwner.name, this.id, 'css-parse-waring', { message: 'Error in CSS Style<br>' + errorMessage });
        } else {
          this.context.editorConnection.clearWarning(this.nodeScope.componentOwner.name, this.id, 'css-parse-waring');
          style && this.setStyle(style);
          this.customCssStyles = style;
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
        if (typeof value === 'object' && value.value !== undefined) this.setStyle({ [styleTargetName]: value.value + value.unit }, input.styleTag);
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
