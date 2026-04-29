/**
 * Conditionally load pro-nodes if available
 * This file ensures pro-nodes are bundled by webpack when available
 */

console.log('[Viewer] load-pro-nodes.js: Starting to load pro-nodes...');

let proNodesModule = null;

// Try to load pro-nodes - webpack will bundle it if the alias is configured
try {
  // Use require so webpack can statically analyze and bundle it
  // eslint-disable-next-line
  proNodesModule = require('@xgenia/pro-nodes');
  console.log('[Viewer] load-pro-nodes.js: require(@xgenia/pro-nodes) succeeded');
  console.log('[Viewer] load-pro-nodes.js: Module structure:', {
    hasModule: !!proNodesModule,
    hasRegisterWithRuntime: proNodesModule && typeof proNodesModule.registerWithRuntime === 'function',
    hasNodes: !!proNodesModule?.nodes,
    nodeCount: proNodesModule?.nodes ? (Array.isArray(proNodesModule.nodes) ? proNodesModule.nodes.length : 'not-array') : 'no-nodes',
    keys: proNodesModule ? Object.keys(proNodesModule).slice(0, 10) : []
  });
  
  // Store on window for runtime access (even if registerWithRuntime doesn't exist)
  if (proNodesModule && typeof window !== 'undefined') {
    window.XGENIA = window.XGENIA || {};
    window.XGENIA.ProNodes = proNodesModule;
    console.log('[Viewer] load-pro-nodes.js: Stored pro-nodes on window.XGENIA.ProNodes');
    console.log('[Viewer] load-pro-nodes.js: window.XGENIA structure:', {
      hasProNodes: !!window.XGENIA.ProNodes,
      hasRegisterNodeModule: typeof window.XGENIA.registerNodeModule === 'function',
      hasRegisterWithRuntime: typeof proNodesModule.registerWithRuntime === 'function',
      hasNodes: !!proNodesModule.nodes
    });
    
    // Try to register immediately if runtime is ready
    if (typeof proNodesModule.registerWithRuntime === 'function') {
      if (typeof window.XGENIA.registerNodeModule === 'function') {
        try {
          console.log('[Viewer] load-pro-nodes.js: Runtime ready, attempting immediate registration...');
          proNodesModule.registerWithRuntime();
          console.log('[Viewer] load-pro-nodes.js: Pro-nodes registered immediately');
        } catch (e) {
          console.warn('[Viewer] load-pro-nodes.js: Failed to register pro-nodes immediately:', e.message);
          console.warn('[Viewer] load-pro-nodes.js: Error stack:', e.stack);
        }
      } else {
        // Runtime not ready yet - will be registered by external-module-loader
        console.log('[Viewer] load-pro-nodes.js: Runtime not ready yet, waiting for external-module-loader');
      }
    } else {
      // No registerWithRuntime - external-module-loader will handle manual registration
      console.log('[Viewer] load-pro-nodes.js: Module stored on window, will be registered by external-module-loader');
    }
  } else if (!proNodesModule) {
    console.warn('[Viewer] load-pro-nodes.js: Pro-nodes module is null or undefined');
  } else {
    console.warn('[Viewer] load-pro-nodes.js: window is undefined, cannot store pro-nodes');
  }
} catch (e) {
  // Pro-nodes not available - running in open source mode
  // This is expected if the private package isn't available
  console.warn('[Viewer] load-pro-nodes.js: Failed to load pro-nodes:', e.message);
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[Viewer] load-pro-nodes.js: Error stack:', e.stack);
  }
}

console.log('[Viewer] load-pro-nodes.js: Finished loading pro-nodes');

export default proNodesModule;
