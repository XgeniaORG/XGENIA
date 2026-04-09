/**
 * XGENIA External Node Module Loader
 * 
 * SPDX-License-Identifier: GPL-3.0-or-later
 * Based on original Noodl Editor (now XGENIA), Copyright (C) 2024 Future Platforms AB
 * Modifications Copyright (C) 2024-2026 XGENIA
 * 
 * This module provides an interface for loading external node modules
 * into the XGENIA runtime. External modules can be proprietary or
 * open source - this loader is GPL-3 licensed but the modules it
 * loads can have any license.
 */

'use strict';

/**
 * External modules that have been registered
 */
const registeredModules = [];

/**
 * Nodes that have been registered from external modules
 */
const externalNodes = new Map();

/**
 * Callback functions to notify when modules are registered
 */
const moduleListeners = [];

/**
 * Register an external node module with the runtime
 * 
 * @param {Object} module - The module to register
 * @param {string} module.name - Module identifier
 * @param {string} module.version - Module version
 * @param {Array} module.nodes - Array of node definitions
 * @returns {boolean} - Whether registration was successful
 */
function registerNodeModule(module) {
    if (!module || !module.name) {
        console.error('[ExternalModuleLoader] Invalid module - must have a name');
        return false;
    }

    // Check if already registered
    if (registeredModules.find(m => m.name === module.name)) {
        console.warn(`[ExternalModuleLoader] Module "${module.name}" already registered`);
        return false;
    }

    console.log(`[ExternalModuleLoader] Registering module: ${module.name} v${module.version || '1.0.0'}`);

    // Store the module
    registeredModules.push(module);

    // Register each node
    // Access nodes property (could be a getter, so access it explicitly)
    let nodes = null;
    try {
        nodes = module.nodes;
        console.log(`[ExternalModuleLoader] Module "${module.name}" has ${nodes ? (Array.isArray(nodes) ? nodes.length : 'non-array') : 'no'} nodes property`);
    } catch (e) {
        console.error(`[ExternalModuleLoader] Error accessing nodes property:`, e);
    }

    if (Array.isArray(nodes)) {
        console.log(`[ExternalModuleLoader] Registering ${nodes.length} nodes from module "${module.name}"`);
        nodes.forEach((node, index) => {
            // Handle different node formats:
            // 1. Direct node definition: { name: 'NodeName', ... }
            // 2. Wrapped node: { node: { name: 'NodeName', ... } }
            // 3. ES6 module: { default: { name: 'NodeName', ... } }
            let nodeDef = node;

            // Check if it's an ES6 module with default export
            if (node && typeof node === 'object' && 'default' in node && !node.name) {
                nodeDef = node.default;
            }

            // Check if it's wrapped in a 'node' property
            if (nodeDef && typeof nodeDef === 'object' && 'node' in nodeDef && !nodeDef.name) {
                nodeDef = nodeDef.node;
            }

            // Validate the node has a name (after unwrapping)
            const nodeName = nodeDef?.name;
            if (nodeName) {
                console.log(`[ExternalModuleLoader] Registering node ${index + 1}/${nodes.length}: ${nodeName}`);
                registerExternalNode(nodeDef, module.name);
            } else {
                console.warn(`[ExternalModuleLoader] Skipping invalid node at index ${index}:`, node, 'Extracted:', nodeDef);
            }
        });
    } else {
        console.warn(`[ExternalModuleLoader] Module "${module.name}" has invalid or missing nodes array. Nodes type:`, typeof nodes, 'Value:', nodes);
    }

    // Notify listeners
    moduleListeners.forEach(listener => {
        try {
            listener(module);
        } catch (error) {
            console.error('[ExternalModuleLoader] Error in module listener:', error);
        }
    });

    const nodeCount = Array.isArray(nodes) ? nodes.length : 0;
    console.log(`[ExternalModuleLoader] Module "${module.name}" registered with ${nodeCount} nodes`);
    return true;
}

/**
 * Register a single external node
 * 
 * @param {Object} nodeDefinition - The node definition
 * @param {string} moduleName - The source module name
 */
function registerExternalNode(nodeDefinition, moduleName) {
    if (!nodeDefinition || !nodeDefinition.name) {
        console.error('[ExternalModuleLoader] Invalid node definition');
        return;
    }

    const nodeName = nodeDefinition.name;

    // Store with source module info
    externalNodes.set(nodeName, {
        definition: nodeDefinition,
        sourceModule: moduleName
    });

    // Register with the runtime if NodeLibrary is available
    if (typeof window !== 'undefined') {
        const NodeLibrary = window.NodeLibrary || window.NodeGraphContextTmp?.NodeLibrary;

        if (NodeLibrary && typeof NodeLibrary.registerNode === 'function') {
            try {
                NodeLibrary.registerNode(nodeDefinition);
                console.log(`[ExternalModuleLoader] Registered node: ${nodeName}`);
            } catch (error) {
                console.error(`[ExternalModuleLoader] Error registering node ${nodeName}:`, error);
            }
        } else {
            // Queue for later registration when NodeLibrary becomes available
            console.log(`[ExternalModuleLoader] Queued node for later: ${nodeName}`);
        }
    }
}

/**
 * Get all registered external modules
 * 
 * @returns {Array} - Array of registered modules
 */
function getRegisteredModules() {
    return [...registeredModules];
}

/**
 * Get all external nodes
 * 
 * @returns {Map} - Map of node name to node info
 */
function getExternalNodes() {
    return new Map(externalNodes);
}

/**
 * Check if a node is from an external module
 * 
 * @param {string} nodeName - The node name to check
 * @returns {boolean}
 */
function isExternalNode(nodeName) {
    return externalNodes.has(nodeName);
}

/**
 * Get module info for a node
 * 
 * @param {string} nodeName - The node name
 * @returns {Object|null} - Module info or null
 */
function getNodeModuleInfo(nodeName) {
    const nodeInfo = externalNodes.get(nodeName);
    if (!nodeInfo) return null;

    const module = registeredModules.find(m => m.name === nodeInfo.sourceModule);
    return {
        nodeName,
        moduleName: nodeInfo.sourceModule,
        moduleVersion: module?.version || 'unknown',
        moduleLicense: module?.license || 'unknown'
    };
}

/**
 * Add a listener for module registration
 * 
 * @param {Function} listener - Callback for when modules are registered
 * @returns {Function} - Unsubscribe function
 */
function onModuleRegistered(listener) {
    moduleListeners.push(listener);
    return () => {
        const index = moduleListeners.indexOf(listener);
        if (index !== -1) {
            moduleListeners.splice(index, 1);
        }
    };
}

/**
 * Process pending modules that were registered before runtime was ready
 */
function processPendingModules() {
    if (typeof window !== 'undefined' && window.XGENIA?.pendingModules) {
        const pending = window.XGENIA.pendingModules;
        console.log(`[ExternalModuleLoader] Processing ${pending.length} pending modules`);

        pending.forEach(module => {
            registerNodeModule(module);
        });

        window.XGENIA.pendingModules = [];
    }
}

/**
 * Attempt to load the @xgenia/pro-nodes package if available
 * This enables proprietary nodes when the Pro package is installed.
 * 
 * @returns {boolean} - Whether loading was successful
 */
function tryLoadProNodes() {
    console.log('[ExternalModuleLoader] Checking for @xgenia/pro-nodes...');
    console.log('[ExternalModuleLoader] window.XGENIA state:', {
        exists: typeof window !== 'undefined' && !!window.XGENIA,
        hasProNodes: typeof window !== 'undefined' && !!window.XGENIA?.ProNodes,
        hasRegisterNodeModule: typeof window !== 'undefined' && typeof window.XGENIA?.registerNodeModule === 'function'
    });

    // Get the native Node.js require function (not Webpack's)
    let nodeRequire = null;

    // Strategy 1: window.require (Electron with nodeIntegration) - MOST RELIABLE
    if (typeof window !== 'undefined' && typeof window.require === 'function') {
        nodeRequire = window.require;
        console.log('[ExternalModuleLoader] Using window.require');
    }
    // Strategy 2: global.require (Node.js / Electron main process)
    else if (typeof global !== 'undefined' && typeof global.require === 'function') {
        nodeRequire = global.require;
        console.log('[ExternalModuleLoader] Using global.require');
    }
    // Strategy 3: __non_webpack_require__ (Webpack escape hatch)
    else if (typeof __non_webpack_require__ !== 'undefined') {
        nodeRequire = __non_webpack_require__;
        console.log('[ExternalModuleLoader] Using __non_webpack_require__');
    }
    // Strategy 4: eval trick for pure Node.js (no window)
    else if (typeof window === 'undefined' && typeof process !== 'undefined') {
        try {
            nodeRequire = eval('require');
            console.log('[ExternalModuleLoader] Using eval(require) for Node.js');
        } catch (e) {
            console.warn('[ExternalModuleLoader] eval(require) failed:', e.message);
        }
    }

    // Strategy 5: Check if already on window FIRST (Webpack-bundled modules)
    // This should be checked before Node.js require since Webpack bundles the modules
    if (typeof window !== 'undefined' && window.XGENIA?.ProNodes) {
        try {
            console.log('[ExternalModuleLoader] Found @xgenia/pro-nodes on window.XGENIA.ProNodes');
            const proNodes = window.XGENIA.ProNodes;

            // Log full module structure for debugging
            console.log('[ExternalModuleLoader] ProNodes module structure:', {
                hasRegisterWithRuntime: typeof proNodes.registerWithRuntime === 'function',
                hasNodes: !!proNodes.nodes,
                nodeCount: proNodes.nodes ? (Array.isArray(proNodes.nodes) ? proNodes.nodes.length : 'not-array') : 'no-nodes',
                hasName: !!proNodes.name,
                name: proNodes.name,
                keys: Object.keys(proNodes || {}).slice(0, 20)
            });

            // Log the actual nodes property if it exists
            if (proNodes.nodes) {
                console.log('[ExternalModuleLoader] ProNodes.nodes type:', typeof proNodes.nodes, 'isArray:', Array.isArray(proNodes.nodes));
                if (Array.isArray(proNodes.nodes) && proNodes.nodes.length > 0) {
                    console.log('[ExternalModuleLoader] First few node names:', proNodes.nodes.slice(0, 5).map(n => n?.name || 'unnamed'));
                }
            }

            if (typeof proNodes.registerWithRuntime === 'function') {
                console.log('[ExternalModuleLoader] Calling registerWithRuntime()...');
                const result = proNodes.registerWithRuntime();
                console.log('[ExternalModuleLoader] registerWithRuntime result:', result);
                console.log('[ExternalModuleLoader] ✓ @xgenia/pro-nodes loaded from window.XGENIA');
                return true;
            } else if (proNodes.nodes) {
                // Module loaded but no registerWithRuntime - register manually
                console.log('[ExternalModuleLoader] Registering nodes manually from window, count:', proNodes.nodes?.length || 0);
                registerNodeModule(proNodes);
                console.log('[ExternalModuleLoader] ✓ @xgenia/pro-nodes registered manually from window');
                return true;
            } else {
                console.warn('[ExternalModuleLoader] window.XGENIA.ProNodes found but invalid structure. Full object:', JSON.stringify(proNodes, null, 2).substring(0, 500));
            }
        } catch (e) {
            console.warn('[ExternalModuleLoader] Error registering ProNodes from window:', e.message);
            console.warn('[ExternalModuleLoader] Stack:', e.stack);
        }
    } else {
        console.log('[ExternalModuleLoader] window.XGENIA.ProNodes not found. window.XGENIA exists:', typeof window !== 'undefined' && !!window.XGENIA);
    }

    // Strategy 6: Try Node.js require (for Electron/Node.js environments)
    if (nodeRequire) {
        try {
            console.log('[ExternalModuleLoader] Attempting to load @xgenia/pro-nodes via Node.js require...');
            const proNodes = nodeRequire('@xgenia/pro-nodes');
            console.log('[ExternalModuleLoader] Module loaded, checking exports:', Object.keys(proNodes || {}));

            if (proNodes && typeof proNodes.registerWithRuntime === 'function') {
                const result = proNodes.registerWithRuntime();
                console.log('[ExternalModuleLoader] registerWithRuntime result:', result);
                console.log('[ExternalModuleLoader] ✓ @xgenia/pro-nodes loaded successfully via Node.js');
                return true;
            } else if (proNodes && proNodes.nodes) {
                // Module loaded but no registerWithRuntime - register manually
                console.log('[ExternalModuleLoader] Registering nodes manually, count:', proNodes.nodes?.length || 0);
                registerNodeModule(proNodes);
                console.log('[ExternalModuleLoader] ✓ @xgenia/pro-nodes registered manually');
                return true;
            } else {
                console.error('[ExternalModuleLoader] @xgenia/pro-nodes loaded but invalid structure:', proNodes);
            }
        } catch (e) {
            console.warn('[ExternalModuleLoader] Failed to load @xgenia/pro-nodes via Node.js require:', e.message);
            // Don't log full stack for expected errors (like pixi.js import issues)
            if (!e.message.includes('pixi.js')) {
                console.warn('[ExternalModuleLoader] Stack:', e.stack);
            }
        }
    } else {
        console.log('[ExternalModuleLoader] No Node.js require available');
    }

    console.log('[ExternalModuleLoader] @xgenia/pro-nodes not found - running in open source mode');
    return false;
}

/**
 * Attempt to load the @xgenia/agent-nodes package if available
 * This enables agent nodes when the Agent package is installed.
 * 
 * @returns {boolean} - Whether loading was successful
 */
function tryLoadAgentNodes() {
    console.log('[ExternalModuleLoader] Checking for @xgenia/agent-nodes...');

    // Strategy 1: Check if already on window (Webpack-bundled via load-agent-nodes.js)
    if (typeof window !== 'undefined' && window.XGENIA?.AgentNodes) {
        try {
            console.log('[ExternalModuleLoader] Found @xgenia/agent-nodes on window.XGENIA.AgentNodes');
            const agentNodes = window.XGENIA.AgentNodes;

            console.log('[ExternalModuleLoader] AgentNodes module structure:', {
                hasRegisterWithRuntime: typeof agentNodes.registerWithRuntime === 'function',
                hasNodes: !!agentNodes.nodes,
                nodeCount: agentNodes.nodes ? (Array.isArray(agentNodes.nodes) ? agentNodes.nodes.length : 'not-array') : 'no-nodes',
                hasName: !!agentNodes.name,
                name: agentNodes.name,
                keys: Object.keys(agentNodes || {}).slice(0, 20)
            });

            if (typeof agentNodes.registerWithRuntime === 'function') {
                console.log('[ExternalModuleLoader] Calling registerWithRuntime() for agent-nodes...');
                const result = agentNodes.registerWithRuntime();
                console.log('[ExternalModuleLoader] registerWithRuntime result:', result);
                console.log('[ExternalModuleLoader] ✓ @xgenia/agent-nodes loaded from window.XGENIA');
                return true;
            } else if (agentNodes.nodes) {
                console.log('[ExternalModuleLoader] Registering agent nodes manually from window, count:', agentNodes.nodes?.length || 0);
                registerNodeModule(agentNodes);
                console.log('[ExternalModuleLoader] ✓ @xgenia/agent-nodes registered manually from window');
                return true;
            } else {
                console.warn('[ExternalModuleLoader] window.XGENIA.AgentNodes found but invalid structure.');
            }
        } catch (e) {
            console.warn('[ExternalModuleLoader] Error registering AgentNodes from window:', e.message);
        }
    } else {
        console.log('[ExternalModuleLoader] window.XGENIA.AgentNodes not found.');
    }

    // Strategy 2: Try Node.js require (for Electron/Node.js environments)
    let nodeRequire = null;
    if (typeof window !== 'undefined' && typeof window.require === 'function') {
        nodeRequire = window.require;
    } else if (typeof global !== 'undefined' && typeof global.require === 'function') {
        nodeRequire = global.require;
    } else if (typeof __non_webpack_require__ !== 'undefined') {
        nodeRequire = __non_webpack_require__;
    }

    if (nodeRequire) {
        try {
            const agentNodes = nodeRequire('@xgenia/agent-nodes');
            if (agentNodes && typeof agentNodes.registerWithRuntime === 'function') {
                agentNodes.registerWithRuntime();
                console.log('[ExternalModuleLoader] ✓ @xgenia/agent-nodes loaded via Node.js require');
                return true;
            } else if (agentNodes && agentNodes.nodes) {
                registerNodeModule(agentNodes);
                console.log('[ExternalModuleLoader] ✓ @xgenia/agent-nodes registered manually');
                return true;
            }
        } catch (e) {
            console.warn('[ExternalModuleLoader] Failed to load @xgenia/agent-nodes via require:', e.message);
        }
    }

    console.log('[ExternalModuleLoader] @xgenia/agent-nodes not found');
    return false;
}

/**
 * Check if Pro nodes are available
 * 
 * @returns {boolean}
 */
function areProNodesAvailable() {
    return registeredModules.some(m => m.name === '@xgenia/pro-nodes');
}

/**
 * Check if Agent nodes are available
 * 
 * @returns {boolean}
 */
function areAgentNodesAvailable() {
    return registeredModules.some(m => m.name === '@xgenia/agent-nodes');
}

/**
 * Initialize the external module loader and auto-discover proprietary packages
 */
function initialize() {
    console.log('[ExternalModuleLoader] Initializing...');

    // Process any pending modules first
    processPendingModules();

    // Try to load Pro nodes if available
    // Use a small delay to ensure load-pro-nodes.js has finished executing
    if (typeof window !== 'undefined') {
        // Check immediately first
        if (!tryLoadProNodes()) {
            setTimeout(() => {
                console.log('[ExternalModuleLoader] Retrying pro-nodes load after delay...');
                tryLoadProNodes();
            }, 100);
        }
        // Also try to load Agent nodes
        if (!tryLoadAgentNodes()) {
            setTimeout(() => {
                console.log('[ExternalModuleLoader] Retrying agent-nodes load after delay...');
                tryLoadAgentNodes();
            }, 150);
        }
    } else {
        tryLoadProNodes();
        tryLoadAgentNodes();
    }

    console.log('[ExternalModuleLoader] Initialization complete. ' +
        `${registeredModules.length} module(s) loaded, ` +
        `${externalNodes.size} node(s) registered.`);
}

// Export the API
module.exports = {
    registerNodeModule,
    getRegisteredModules,
    getExternalNodes,
    isExternalNode,
    getNodeModuleInfo,
    onModuleRegistered,
    processPendingModules,
    tryLoadProNodes,
    tryLoadAgentNodes,
    areProNodesAvailable,
    areAgentNodesAvailable,
    initialize
};

// Make available on window for external modules to use
if (typeof window !== 'undefined') {
    window.XGENIA = window.XGENIA || {};
    window.XGENIA.registerNodeModule = registerNodeModule;
    window.XGENIA.getRegisteredModules = getRegisteredModules;
    window.XGENIA.isExternalNode = isExternalNode;

    // Process any modules that registered before we were ready
    setTimeout(processPendingModules, 0);
}
