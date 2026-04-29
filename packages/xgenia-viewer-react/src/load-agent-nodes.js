/**
 * Conditionally load agent-nodes if available
 * This file ensures agent-nodes are bundled by webpack when available.
 * Follows the same pattern as load-pro-nodes.js.
 */

console.log('[Viewer] load-agent-nodes.js: Starting to load agent-nodes...');

let agentNodesModule = null;

// Try to load agent-nodes - webpack will bundle it if the alias is configured
try {
    // Use require so webpack can statically analyze and bundle it
    // eslint-disable-next-line
    agentNodesModule = require('@xgenia/agent-nodes');
    console.log('[Viewer] load-agent-nodes.js: require(@xgenia/agent-nodes) succeeded');
    console.log('[Viewer] load-agent-nodes.js: Module structure:', {
        hasModule: !!agentNodesModule,
        hasRegisterWithRuntime: agentNodesModule && typeof agentNodesModule.registerWithRuntime === 'function',
        hasNodes: !!agentNodesModule?.nodes,
        nodeCount: agentNodesModule?.nodes ? (Array.isArray(agentNodesModule.nodes) ? agentNodesModule.nodes.length : 'not-array') : 'no-nodes',
        keys: agentNodesModule ? Object.keys(agentNodesModule).slice(0, 10) : []
    });

    // Store on window for runtime access
    if (agentNodesModule && typeof window !== 'undefined') {
        window.XGENIA = window.XGENIA || {};
        window.XGENIA.AgentNodes = agentNodesModule;
        console.log('[Viewer] load-agent-nodes.js: Stored agent-nodes on window.XGENIA.AgentNodes');

        // Try to register immediately if runtime is ready
        if (typeof agentNodesModule.registerWithRuntime === 'function') {
            if (typeof window.XGENIA.registerNodeModule === 'function') {
                try {
                    console.log('[Viewer] load-agent-nodes.js: Runtime ready, attempting immediate registration...');
                    agentNodesModule.registerWithRuntime();
                    console.log('[Viewer] load-agent-nodes.js: Agent-nodes registered immediately');
                } catch (e) {
                    console.warn('[Viewer] load-agent-nodes.js: Failed to register agent-nodes immediately:', e.message);
                }
            } else {
                console.log('[Viewer] load-agent-nodes.js: Runtime not ready yet, waiting for external-module-loader');
            }
        } else {
            console.log('[Viewer] load-agent-nodes.js: Module stored on window, will be registered by external-module-loader');
        }
    }
} catch (e) {
    // Agent-nodes not available - this is expected if the private package isn't available
    console.warn('[Viewer] load-agent-nodes.js: Failed to load agent-nodes:', e.message);
}

console.log('[Viewer] load-agent-nodes.js: Finished loading agent-nodes');

export default agentNodesModule;
