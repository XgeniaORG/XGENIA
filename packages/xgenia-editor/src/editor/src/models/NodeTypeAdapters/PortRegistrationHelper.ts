/**
 * Helper for node type port registration
 */

// Get access to node library
function getNodeLibrary() {
  return require('@xgenia-models/nodelibrary').NodeLibrary.instance;
}

/**
 * Register common action ports for control components
 * @param nodeType The node type to register action ports for
 */
export function registerCommonActionPorts(nodeType) {
  try {
    const nodeLibrary = getNodeLibrary();
    if (!nodeLibrary) {
      // Node library not available yet, skip silently
      return;
    }
    
    const type = nodeLibrary.getNodeTypeWithName(nodeType);
    
    if (!type) {
      // During node library reload, nodes might be temporarily unavailable
      // This is normal and expected, so we'll skip silently instead of warning
      return;
    }
    
    // Common action ports for controls.
    // (trace 1784998058885) Only `onClick` is a real control output. onDoubleClick/onMouseDown/
    // onMouseUp were phantom — the runtime control source (viewer-react controls/utils.ts
    // addControlEventsAndStates) never emits them as signals (they exist only as DOM handlers driving
    // pressedState/pointerDown). Registering them here made the editor offer dead, never-firing wires.
    // The real pointer/focus signals (hoverStart/hoverEnd/pointerDown/pointerUp/onFocus/onBlur) come
    // from the node definition itself, so they are not re-added here.
    const commonPorts = [
      { name: 'onClick', type: 'action', displayName: 'Click', group: 'Actions' }
    ];
    
    // Add ports if they don't exist already
    commonPorts.forEach(port => {
      if (!type.ports.some(p => p.name === port.name)) {
        if (typeof type.addPort === 'function') {
          type.addPort(port);
        } else {
          // If addPort method doesn't exist, add directly to ports array
          type.ports.push(port);
        }
      }
    });
  } catch (error: any) {
    // If there's any error accessing the node library, skip silently
    // This can happen during initialization or reload
    return;
  }
}

/**
 * Register dynamic ports based on node type
 * @param node The node to register dynamic ports for
 */
export function registerDynamicPorts(node) {
  if (!node || !node.typename) return;
  
  try {
    // Handle specific node types
    if (node.typename.includes('net.xgenia.controls.button')) {
      registerCommonActionPorts(node.typename);
    }
    
    // Handle other node types that need dynamic port registration
    if (node.typename.includes('net.xgenia.controls.textinput')) {
      const nodeLibrary = getNodeLibrary();
      if (!nodeLibrary) return;
      
      const type = nodeLibrary.getNodeTypeWithName(node.typename);
      
      if (type) {
      // Text input specific ports.
      // (trace 1784998058885) The runtime control (viewer-react controls/text-input.ts) emits
      // `textChanged` (not `onChange`) and exposes the text via `onTextChanged`/`startValue` —
      // there is NO `onChange` or `value` port. Registering those made the editor offer dead,
      // never-firing wires. onFocus/onBlur come from the node definition (addControlEventsAndStates)
      // but re-declaring them here is harmless (the loop below dedupes by name).
      const textInputPorts = [
        { name: 'textChanged', type: 'action', displayName: 'Text Changed', group: 'Actions' },
        { name: 'onEnter', type: 'action', displayName: 'Enter', group: 'Actions' },
        { name: 'onFocus', type: 'action', displayName: 'Focus', group: 'Actions' },
        { name: 'onBlur', type: 'action', displayName: 'Blur', group: 'Actions' }
      ];
      
      textInputPorts.forEach(port => {
        if (!type.ports.some(p => p.name === port.name)) {
          if (typeof type.addPort === 'function') {
            type.addPort(port);
          } else {
            // If addPort method doesn't exist, add directly to ports array
            type.ports.push(port);
          }
        }
      });
    }
  }
  } catch (error: any) {
    // If there's any error accessing the node library, skip silently
    // This can happen during initialization or reload
    return;
  }
}
