const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

function FloatingWindow() {
  this.window = null;
  this.eventListeners = new Map(); // Store event listeners for cleanup
  this.isWindowReady = false; // Track if window is ready to receive messages
  this.queuedEvents = []; // Queue events until window is ready
  this.MAX_QUEUED_EVENTS = 100; // REDUCED: Prevent memory leaks (was 100)
  
  // EMERGENCY FIX: Add throttling to prevent runaway loops
  this.lastEventTimes = new Map(); // Track last time each event was processed
  this.THROTTLE_MS = 100; // Minimum time between same events (100ms)
  this.totalEventCount = 0;
  this.eventCountResetTime = Date.now();
  this.MAX_EVENTS_PER_SECOND = 40; // Circuit breaker: max 20 events per second
  this.isCircuitBreakerActive = false;
}

FloatingWindow.prototype.open = function ({ x, y, width, height, minWidth, minHeight, parent, url, alwaysShadow }) {
  if (this.window) return; //already open

  this.dockedInParent = true;
  const parentBounds = parent.getBounds();

  this.position = { x, y };

  this.alwaysShadow = alwaysShadow || false;

  // Reset ready state
  this.isWindowReady = false;
  this.queuedEvents = [];

  // Use the correct preload script for the floating window (not webview preload)
  let preloadPath = '';
  const { app } = require('electron');
  
  if (app.isPackaged) {
    // Production: Use the editor preload script
    preloadPath = path.join(__dirname, '../../editor/preload.js');
  } else {
    // Development: Use the editor preload script - resolve absolute path
    preloadPath = path.resolve(__dirname, '../../editor/preload.js');
  }
  
  console.log('[FloatingWindow] Using preload path:', preloadPath);
  
  // Verify the preload script exists
  let preloadExists = false;
  try {
    if (fs.existsSync(preloadPath)) {
      console.log('[FloatingWindow] Preload script exists at:', preloadPath);
      preloadExists = true;
    } else {
      console.error('[FloatingWindow] Preload script NOT FOUND at:', preloadPath);
      // Try alternative paths
      const altPaths = [
        path.resolve(__dirname, '../../../editor/preload.js'),
        path.resolve(__dirname, '../../../../preload.js'), // Root preload.js
        path.resolve(__dirname, '../../../src/editor/preload.js')
      ];
      
      for (const altPath of altPaths) {
        if (fs.existsSync(altPath)) {
          console.log('[FloatingWindow] Found preload script at alternative path:', altPath);
          preloadPath = altPath;
          preloadExists = true;
          break;
        }
      }
      
      if (!preloadExists) {
        console.warn('[FloatingWindow] No preload script found, continuing without preload');
        preloadPath = null; // Set to null if no preload script found
      }
    }
  } catch (err) {
    console.error('[FloatingWindow] Error checking preload script:', err);
    preloadPath = null; // Set to null on error
  }

  // Configure webPreferences with conditional preload
  const webPreferences = {
    webSecurity: false,
    allowRunningInsecureContent: true,
    nodeIntegration: true,
    contextIsolation: false,
    webviewTag: true,
    backgroundThrottling: false,
    // Only include preload if the script exists
    ...(preloadExists && preloadPath ? { preload: preloadPath } : {})
  };

  this.window = new BrowserWindow({
    x: parentBounds.x + x,
    y: parentBounds.y + y,
    width,
    height,
    minWidth,
    minHeight,
    parent,
    resizable: true,
    frame: false,
    acceptFirstMouse: true,
    hasShadow: this.alwaysShadow,
    minimizable: false,
    webPreferences,
    backgroundThrottling: false,
    closable: false,
    fullscreenable: false,
    backgroundColor: '#131313'
  });

  require('@electron/remote/main').enable(this.window.webContents);

  // Add error handling for preload script issues
  this.window.webContents.on('console-message', (event, level, message, line, sourceId) => {
    if (message.includes('[Preload]')) {
      console.log(`[FloatingWindow] Preload log: ${message}`);
    }
  });

  this.window.webContents.on('crashed', (event, killed) => {
    console.error('[FloatingWindow] WebContents crashed. Killed:', killed);
  });

  this.window.webContents.on('unresponsive', () => {
    console.error('[FloatingWindow] WebContents became unresponsive');
  });

  this.window.webContents.on('render-process-gone', (event, details) => {
    console.error('[FloatingWindow] Render process gone:', details);
  });

  this.window.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error(`[FloatingWindow] Failed to load URL: ${validatedURL}. Error ${errorCode}: ${errorDescription}`);
  });

  // Set up very permissive CSP headers for development to avoid blocking any resources
  this.window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; script-src * 'unsafe-inline' 'unsafe-eval' data: blob:; connect-src * 'unsafe-inline' ws: wss: data: blob:; style-src * 'unsafe-inline' data: blob:; img-src * 'unsafe-inline' data: blob:; font-src * 'unsafe-inline' data: blob:; frame-src * 'unsafe-inline' data: blob:; object-src * 'unsafe-inline' data: blob:; media-src * 'unsafe-inline' data: blob:; child-src * 'unsafe-inline' data: blob:;"
        ]
      }
    });
  });

  // Wait for window to be fully ready before allowing IPC forwarding
  this.window.webContents.once('did-finish-load', () => {
    console.log('[FloatingWindow] Window finished loading, setting ready state');
    this.isWindowReady = true;
    
    // Process any queued events
    this.processQueuedEvents();
  });

  // Also set ready on dom-ready as a backup
  this.window.webContents.once('dom-ready', () => {
    console.log('[FloatingWindow] Window DOM ready');
    if (!this.isWindowReady) {
      this.isWindowReady = true;
      this.processQueuedEvents();
    }
  });

  this.window.loadURL(url);
  console.log(`[FloatingWindow] Attempting to load URL: ${url}`);

  this.onParentClosed = () => {
    this.close();
  };

  parent.on('closed', this.onParentClosed);

  if (process.platform !== 'darwin') {
    /* parent.on('move', () => {
      if(!this.dockedInParent || !this.window) return;

      const parentBounds = parent.getBounds();
      this.window.setPosition(parentBounds.x + this.position.x, parentBounds.y + this.position.y);
    });*/
  }

  this.window.on('move', () => {
    const parentBounds = parent.getBounds();
    const bounds = this.window.getBounds();

    const inside =
      bounds.x >= parentBounds.x &&
      bounds.x <= parentBounds.x + parentBounds.width &&
      bounds.y >= parentBounds.y &&
      bounds.y <= parentBounds.y + parentBounds.height;

    //set parent window to null when outside the editor so the viewer doesn't follow
    //the main window anymore.
    //This has no effect on windows, but since windows also doesn't move child
    //windows relative to the parent it's not needed
    if (process.platform !== 'win32') {
      if (!inside && this.dockedInParent) {
        this.window.setParentWindow(null);
      } else if (inside && !this.dockedInParent) {
        this.window.setParentWindow(parent);
      }
    }

    this.dockedInParent = inside;
    if (!this.alwaysShadow) {
      this.window.setHasShadow(!inside); //only works on osx
    }

    if (process.platform !== 'darwin') {
      //on macOS a child window moves with the parent, on the other platforms
      //we have implement it ourselves. Keep track of the relative position of the window
      this.position.x = bounds.x - parentBounds.x;
      this.position.y = bounds.y - parentBounds.y;
    }
  });
};

// New method to process queued events
FloatingWindow.prototype.processQueuedEvents = function () {
  console.log(`[FloatingWindow] Processing ${this.queuedEvents.length} queued events`);
  
  while (this.queuedEvents.length > 0) {
    const { eventName, args } = this.queuedEvents.shift();
    console.log(`[FloatingWindow] Processing queued event: ${eventName}`);
    this.sendToWindow(eventName, ...args);
  }
};

// New method to safely send to window
FloatingWindow.prototype.sendToWindow = function (eventName, ...args) {
  if (this.window && this.window.webContents && !this.window.webContents.isDestroyed()) {
    console.log(`[FloatingWindow] Sending ${eventName} to window`);
    this.window.webContents.send(eventName, ...args);
  } else {
    console.warn(`[FloatingWindow] Cannot send ${eventName}, window not available`);
  }
};

FloatingWindow.prototype.close = function () {
  if (!this.window || this.window.isDestroyed()) return;
  
  // Reset ready state
  this.isWindowReady = false;
  this.queuedEvents = [];
  
  // EMERGENCY FIX: Reset throttling state
  this.lastEventTimes.clear();
  this.totalEventCount = 0;
  this.eventCountResetTime = Date.now();
  this.isCircuitBreakerActive = false;
  
  // Remove all event listeners when closing
  this.removeAllEventListeners();
  
  const parent = this.window.getParentWindow();
  if (parent) {
    parent.off('closed', this.onParentClosed);
  }
  this.window.destroy();
  this.window = null;
};

FloatingWindow.prototype.show = function () {
  if (!this.window || this.window.isVisible()) return;

  this.window.show();
  if (this.lastPosition) {
    this.window.setPosition(this.lastPosition[0], this.lastPosition[1], false);
    this.lastPosition = undefined;
  }
};

FloatingWindow.prototype.hide = function () {
  if (!this.window) return;

  this.lastPosition = this.window.getPosition();
  this.window.hide();
};

FloatingWindow.prototype.openDevTools = function () {
  if (!this.window) return;

  if (this.window.webContents.isDevToolsOpened()) {
    this.window.webContents.closeDevTools();
  }

  if (this.window.webContents.isDevToolsOpened()) {
    this.window.webContents.closeDevTools();
    this.window.webContents.openDevTools();
  } else {
    this.window.webContents.openDevTools();
  }
};

FloatingWindow.prototype.send = function (event, ...args) {
  this.sendToWindow(event, ...args);
};

FloatingWindow.reload = function () {
  this.window && this.window.webContents.reload();
};

// Remove old event listeners
FloatingWindow.prototype.removeAllEventListeners = function () {
  for (const [eventName, listener] of this.eventListeners) {
    console.log(`[FloatingWindow] Removing listener for event: ${eventName}`);
    ipcMain.removeListener(eventName, listener);
  }
  this.eventListeners.clear();
};

FloatingWindow.prototype.forwardIpcEvents = function (events) {
  // Remove any existing listeners for these events first
  this.removeAllEventListeners();
  
  for (const eventName of events) {
    // Create the listener function
    const listener = (e, ...args) => {
      console.log(`[FloatingWindow] Received IPC event '${eventName}' on ipcMain. Ready: ${this.isWindowReady}`);
      
      // EMERGENCY FIX: Implement throttling and circuit breaker
      const now = Date.now();
      
      // Reset event count every second
      if (now - this.eventCountResetTime > 1000) {
        this.totalEventCount = 0;
        this.eventCountResetTime = now;
        if (this.isCircuitBreakerActive) {
          console.log('[FloatingWindow] Circuit breaker reset - resuming event processing');
          this.isCircuitBreakerActive = false;
        }
      }
      
      // Circuit breaker: Too many events per second
      if (this.totalEventCount > this.MAX_EVENTS_PER_SECOND) {
        if (!this.isCircuitBreakerActive) {
          console.error(`[FloatingWindow] CIRCUIT BREAKER ACTIVATED: Too many events (${this.totalEventCount}/sec). Dropping events to prevent crash.`);
          this.isCircuitBreakerActive = true;
        }
        return; // Drop the event
      }
      
      // Event-specific throttling
      const lastTime = this.lastEventTimes.get(eventName) || 0;
      if (now - lastTime < this.THROTTLE_MS) {
        console.log(`[FloatingWindow] Throttling ${eventName} (${now - lastTime}ms since last)`);
        return; // Drop the event if too frequent
      }
      
      this.lastEventTimes.set(eventName, now);
      this.totalEventCount++;
      
      if (this.isWindowReady) {
        // Window is ready, send immediately
        this.sendToWindow(eventName, ...args);
      } else {
        // Window not ready, queue the event
        if (this.queuedEvents.length < this.MAX_QUEUED_EVENTS) {
          console.log(`[FloatingWindow] Queueing event '${eventName}' until window is ready`);
          this.queuedEvents.push({ eventName, args });
        } else {
          console.warn(`[FloatingWindow] Event queue full for ${eventName}. Dropping event to prevent crash.`);
        }
      }
    };
    
    // Store the listener for cleanup
    this.eventListeners.set(eventName, listener);
    
    // Add the listener
    ipcMain.on(eventName, listener);
    console.log(`[FloatingWindow] Added listener for event: ${eventName}`);
  }
};

FloatingWindow.prototype.isOpen = function () {
  return this.window ? true : false;
};

module.exports = FloatingWindow;
