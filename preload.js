// preload.js - Bridge between Electron main process and webview content
const { ipcRenderer } = require('electron');

// Log when preload script is executed
console.log('[Preload] Script loaded');

// Store pending messages
const pendingMessages = [];

// Set up IPC event listeners
ipcRenderer.on('editor-api-response', (event, args) => {
  console.log('[Preload] Received editor-api-response:', args);
  
  // Store the message for later processing
  pendingMessages.push(args);
  
  // Try to process immediately if possible
  processMessages();
});

// Function to process pending messages
function processMessages() {
  if (typeof window.handleEditorApiResponse === 'function' && pendingMessages.length > 0) {
    console.log(`[Preload] Processing ${pendingMessages.length} pending messages`);
    
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
// This is less secure but more compatible with existing code
window.XgeniaEditorAPI = {
  // Method to send messages to the main process
  sendMessage: (channel, data) => {
    console.log(`[Preload] Sending message to channel ${channel}:`, data);
    try {
      ipcRenderer.send(channel, data);
    } catch (e) {
      console.error('[Preload] Error sending message:', e);
    }
  },
  
  // Method to set up a handler for editor API responses
  setResponseHandler: (handler) => {
    console.log('[Preload] Setting up response handler');
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

// Patch for React 19 compatibility
window.addEventListener('DOMContentLoaded', () => {
  console.log('[Preload] DOM content loaded');
  
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
    
    // Patch for React 19 component instance node issue
    try {
      // Add a global error handler to catch and log errors
      window.addEventListener('error', function(event) {
        console.error('[Injected] Global error:', event.error);
      });
      
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

// Log that preload script has completed
console.log('[Preload] Setup complete');
