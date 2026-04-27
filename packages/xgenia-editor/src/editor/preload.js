// preload.js - Bridge between Electron main process and webview content

// Guard against uncaught realpathSync errors on Windows (NTFS junction/symlink permission issue).
// On Windows, Node's module resolver calls fs.realpathSync() which can throw "TypeError: no access"
// when following npm workspace symlinks/junctions without Developer Mode enabled.
// This MUST be registered before any require() that triggers module resolution.
process.on('uncaughtException', (err) => {
  if (err && err.message && err.message.includes('no access')) {
    console.warn('[Preload] Caught realpathSync "no access" error (Windows NTFS symlink issue):', err.message);
    console.warn('[Preload] Tip: Enable "Developer Mode" in Windows Settings to fix this permanently.');
    // Swallow the error — the MCP service will fall back to IPC
  } else {
    // Re-throw non-filesystem errors so they are not silently swallowed
    console.error('[Preload] Uncaught exception:', err);
    throw err;
  }
});

const { ipcRenderer } = require('electron');

// Expose Node's require to window for dynamic module loading (needed for @xgenia/pro-nodes)
window.require = require;

// Log when preload script is executed
console.debug('[Preload] Script loaded');

// Try to load the shared MCP service from the dedicated package
let sharedMCPService = null;
try {
  const { sharedMCPService: service } = require('@xgenia/mcp');
  sharedMCPService = service;
  console.debug('[Preload] Shared MCP service loaded successfully');
} catch (error) {
  console.debug('[Preload] Shared MCP service not available, using IPC fallback:', error.message);
}

// Set up the window.mcpAPI interface
window.mcpAPI = {
  loadAllMcpServers: async () => {
    if (sharedMCPService) {
      return sharedMCPService.loadAllMcpServers();
    }
    return ipcRenderer.invoke('mcp:loadAllMcpServers');
  },
  addOrUpdateMcpServer: async (serverConfig) => {
    if (sharedMCPService) {
      return sharedMCPService.addOrUpdateServer(serverConfig);
    }
    return ipcRenderer.invoke('mcp:addOrUpdateServer', serverConfig);
  },
  removeMcpServer: async (serverName) => {
    if (sharedMCPService) {
      return sharedMCPService.removeServer(serverName);
    }
    return ipcRenderer.invoke('mcp:removeServer', serverName);
  },
  fetchTools: (serverName) => {
    if (sharedMCPService) {
      return sharedMCPService.getTools(serverName);
    }
    return ipcRenderer.invoke('mcp:fetchTools', serverName);
  },
  callTool: (serverName, toolName, inputSchema) => {
    if (sharedMCPService) {
      return sharedMCPService.callTool(serverName, toolName, inputSchema);
    }
    return ipcRenderer.invoke('mcp:callTool', serverName, toolName, inputSchema);
  },
  isInitialized: () => {
    if (sharedMCPService) {
      return sharedMCPService.isServiceReady();
    }
    return true; // Assume IPC is always available
  },
  onInitialized: (callback) => {
    if (sharedMCPService) {
      if (sharedMCPService.isServiceReady()) {
        callback();
      } else {
        sharedMCPService.initialize().then(() => callback());
      }
    } else {
      // For IPC, assume it's always ready
      callback();
    }
  },
  // OAuth authentication methods
  startOAuthServer: async () => {
    return ipcRenderer.invoke('mcp:startOAuthServer');
  },
  setOAuthRedirectUri: (uri) => {
    if (sharedMCPService) {
      sharedMCPService.setOAuthRedirectUri(uri);
    }
  },
  registerOAuthClient: async (serverName) => {
    if (sharedMCPService) {
      return sharedMCPService.registerOAuthClient(serverName);
    }
    return ipcRenderer.invoke('mcp:registerOAuthClient', serverName);
  },
  initiateOAuthFlow: async (serverName) => {
    if (sharedMCPService) {
      return sharedMCPService.initiateOAuthFlow(serverName);
    }
    return ipcRenderer.invoke('mcp:initiateOAuthFlow', serverName);
  },
  handleOAuthCallback: async (serverName, code, state, expectedState) => {
    if (sharedMCPService) {
      return sharedMCPService.handleOAuthCallback(serverName, code, state, expectedState);
    }
    return ipcRenderer.invoke('mcp:handleOAuthCallback', serverName, code, state, expectedState);
  },

  handleMCPOAuthTokens: async (serverName, tokens) => {
    if (sharedMCPService) {
      return sharedMCPService.handleMCPOAuthTokens(serverName, tokens);
    }
    return ipcRenderer.invoke('mcp:handleMCPOAuthTokens', serverName, tokens);
  },
  refreshOAuthToken: async (serverName) => {
    if (sharedMCPService) {
      return sharedMCPService.refreshOAuthToken(serverName);
    }
    return ipcRenderer.invoke('mcp:refreshOAuthToken', serverName);
  },
  isTokenExpired: async (serverName) => {
    if (sharedMCPService) {
      return sharedMCPService.isTokenExpired(serverName);
    }
    return ipcRenderer.invoke('mcp:isTokenExpired', serverName);
  },
  // Subscription to server changes
  onServersChanged: (callback) => {
    if (sharedMCPService) {
      // Attempt direct subscription; also mirror via IPC to be safe
      try {
        sharedMCPService.onServersChanged(callback);
      } catch { }
    }
    try {
      ipcRenderer.on('mcp:serversChanged', callback);
    } catch { }
    return () => {
      try { ipcRenderer.removeListener('mcp:serversChanged', callback); } catch { }
    };
  }
};
// Store pending messages
const pendingMessages = [];

// Set up IPC event listeners
ipcRenderer.on('editor-api-response', (event, args) => {
  console.debug('[Preload] Received editor-api-response:', args);

  // Store the message for later processing
  pendingMessages.push(args);

  // Try to process immediately if possible
  processMessages();
});

// Function to process pending messages
function processMessages() {
  if (typeof window.handleEditorApiResponse === 'function' && pendingMessages.length > 0) {
    console.debug(`[Preload] Processing ${pendingMessages.length} pending messages`);

    // Process all pending messages
    while (pendingMessages.length > 0) {
      const args = pendingMessages.shift();
      try {
        window.handleEditorApiResponse(args);
      } catch (e) {
        console.error('[Preload] Error handling API response:', e);
      }
    }
  }
}

// Expose APIs directly to the window object for compatibility
window.XgeniaEditorAPI = {
  // Method to send messages to the main process
  sendMessage: (channel, data) => {
    console.debug(`[Preload] Sending message to channel ${channel}:`, data);
    try {
      ipcRenderer.send(channel, data);
    } catch (e) {
      console.error('[Preload] Error sending message:', e);
    }
  },

  // Method to set up a handler for editor API responses
  setResponseHandler: (handler) => {
    console.debug('[Preload] Setting up response handler');
    window.handleEditorApiResponse = handler;

    // Process any pending messages
    processMessages();
  }
};

// Expose Inspector API
window.XgeniaEditorInspectorAPI = {
  setEnabled: (enabled) => {
    console.log('[Preload] Setting inspector enabled:', enabled);
    if (typeof window.setInspectorEnabled === 'function') {
      try {
        window.setInspectorEnabled(enabled);
      } catch (e) {
        console.error('[Preload] Error setting inspector enabled:', e);
      }
    } else {
      console.warn('[Preload] window.setInspectorEnabled is not defined');
      window.setInspectorEnabled = (enabled) => {
        console.log('[Preload] Inspector enabled (default handler):', enabled);
      };
    }
  }
};

// Expose Highlight API
window.XgeniaEditorHighlightAPI = {
  selectNode: (nodeId) => {
    console.log('[Preload] Selecting node:', nodeId);
    if (typeof window.highlightNode === 'function') {
      try {
        window.highlightNode(nodeId);
      } catch (e) {
        console.error('[Preload] Error highlighting node:', e);
      }
    } else {
      console.warn('[Preload] window.highlightNode is not defined');
      window.highlightNode = (nodeId) => {
        console.log('[Preload] Highlight node (default handler):', nodeId);
      };
    }
  }
};

// Patch for React 19 compatibility and hot reload issues
window.addEventListener('DOMContentLoaded', () => {
  console.debug('[Preload] DOM content loaded');

  // Inject a script to check if the page is ready for IPC
  const script = document.createElement('script');
  script.textContent = `
    console.log('[Injected] Checking if page is ready for IPC');
    
    // Check if APIs are available
    if (window.XgeniaEditorAPI) {
      console.log('[Injected] XgeniaEditorAPI is available');
    } else {
      console.warn('[Injected] XgeniaEditorAPI is not available');
    }
    
    // Patch for React 19 component instance node issue and hot reload stability
    try {
      // Add a global error handler to catch and log errors
      window.addEventListener('error', function(event) {
        console.error('[Injected] Global error:', event.error);
        
        // Check if this is a hot reload related error
        if (event.error && event.error.message && 
            (event.error.message.includes('Cannot read properties of undefined') ||
             event.error.message.includes('target') ||
             event.error.message.includes('module hot update'))) {
          console.warn('[Injected] Hot reload related error detected, attempting to recover');
          
          // Prevent the error from causing a black screen
          event.preventDefault();
          event.stopPropagation();
          
          // Try to reload after a short delay to avoid infinite loops
          setTimeout(() => {
            if (window.location) {
              console.log('[Injected] Attempting controlled reload');
              window.location.reload();
            }
          }, 1000);
        }
      });
      
      // Patch for hot module replacement stability
      if (module && module.hot) {
        console.log('[Injected] HMR detected, setting up stability patches');
        
        // Store original accept method
        const originalAccept = module.hot.accept;
        
        // Wrap accept method to add error handling
        module.hot.accept = function(...args) {
          try {
            return originalAccept.apply(this, args);
          } catch (e) {
            console.error('[Injected] HMR accept error:', e);
            // Don't let HMR errors crash the app
            return false;
          }
        };
      }
      
      // Patch for "Cannot read properties of undefined (reading 'target')" error
      if (typeof NodeScope !== 'undefined' && NodeScope.prototype) {
        const originalCreateNode = NodeScope.prototype.createNode;
        NodeScope.prototype.createNode = function(...args) {
          try {
            // Add safety checks before calling original method
            if (!args[0] || typeof args[0] !== 'object') {
              console.warn('[Injected] Invalid args to createNode:', args);
              return null;
            }
            return originalCreateNode.apply(this, args);
          } catch (e) {
            console.error('[Injected] Error in createNode patch:', e);
            return null;
          }
        };
        console.log('[Injected] NodeScope.createNode patched for safety');
      }
    } catch (e) {
      console.error('[Injected] Error applying patches:', e);
    }
  `;

  // Add the script to the document
  document.head.appendChild(script);
});

// Enhanced hot reload detection and stability
let reloadAttempts = 0;
const maxReloadAttempts = 3;

// Listen for webpack hot reload events
if (typeof module !== 'undefined' && module.hot) {
  console.log('[Preload] Setting up HMR error handling');

  module.hot.addStatusHandler((status) => {
    console.log('[Preload] HMR Status:', status);

    if (status === 'fail') {
      console.warn('[Preload] HMR failed, attempting recovery');

      if (reloadAttempts < maxReloadAttempts) {
        reloadAttempts++;
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      } else {
        console.error('[Preload] Max reload attempts reached, manual intervention required');
      }
    } else if (status === 'idle') {
      // Reset reload attempts on successful update
      reloadAttempts = 0;
    }
  });
}

// Forward OAuth callbacks from main process to OAuthFlowManager.waitForCallback()
// The OAuthFlowManager sets window.__oauthCallbackHandler and polls pendingFlows.
// Without this bridge, the AIWizard's OpenRouter OAuth flow hangs after authorization.
ipcRenderer.on('oauth-callback', (event, data) => {
  console.log('[Preload] OAuth callback received, forwarding to handler:', data);
  if (typeof window.__oauthCallbackHandler === 'function') {
    window.__oauthCallbackHandler(data);
  }
});

ipcRenderer.on('oauth-callback-error', (event, data) => {
  console.log('[Preload] OAuth error received:', data);
  if (typeof window.__oauthCallbackHandler === 'function') {
    window.__oauthCallbackHandler({ error: data.error, error_description: data.error_description });
  }
});

// Log that preload script has completed
console.debug('[Preload] Setup complete');
