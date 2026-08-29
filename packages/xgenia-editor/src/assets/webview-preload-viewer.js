const { ipcRenderer, contextBridge } = require('electron');
const path = require('path');

// Import CSP configs using relative path
const cspConfig = require('./webview-csp-config.js'); // REVERTED

// ------------- REMOVE PIXI REQUIRE ------------- 
// let PIXI = null;
// console.log(`[Preload Viewer] Attempting require from __dirname: ${__dirname}`); // Log __dirname
// try {
//   // Try resolving the path first
//   const pixiPath = require.resolve('pixi.js');
//   console.log(`[Preload Viewer] Resolved pixi.js path: ${pixiPath}`);
//   PIXI = require(pixiPath);
//   // Original require as fallback (might be needed if resolve fails in weird ways)
//   // PIXI = require('pixi.js'); 
//   console.log('[Preload Viewer] Successfully required pixi.js', PIXI.VERSION);
// } catch (err) {
//   console.error('[Preload Viewer] Failed to require pixi.js:', err);
// }
// ------------------------------------------

// Apply CSP as early as possible before any DOM manipulation
document.addEventListener('DOMContentLoaded', () => {
  // Apply CSP meta tag to the document head
  const cspMeta = document.createElement('meta');
  cspMeta.setAttribute('http-equiv', 'Content-Security-Policy');

  // Use development CSP in dev mode, production CSP otherwise
  if (process.env.NODE_ENV === 'development') {
    cspMeta.setAttribute('content', cspConfig.developmentCSP);
  } else {
    cspMeta.setAttribute('content', cspConfig.productionCSP);
  }

  document.head.appendChild(cspMeta);

  // Force repaint to ensure CSP takes effect
  document.body.style.display = 'none';
  setTimeout(() => {
    document.body.style.display = '';

    // After content loads, trigger popstate to ensure Router components reset based on current URL
    // This is needed because when CanvasView loads a new URL, it doesn't trigger popstate automatically
    // All Router/PageStack components listen for popstate to reset their navigation state
    setTimeout(() => {
      console.log('[Preload Viewer] Triggering popstate event to reset Router components for current URL:', window.location.href);
      window.dispatchEvent(new PopStateEvent('popstate', {}));
    }, 100); // Give React components time to mount first
  }, 10);
});

// Callback storage
const _editorAPICallbacks = {};
let _responseHandler = null;

// Helper function for generating unique IDs
function guid() {
  function s4() {
    return Math.floor((1 + Math.random()) * 0x10000)
      .toString(16)
      .substring(1);
  }
  return s4() + s4() + '-' + s4() + '-' + s4() + '-' + s4() + '-' + s4() + s4() + s4();
}

// Function to make API requests
function makeEditorAPIRequest(api, args, callback) {
  const t = guid();
  _editorAPICallbacks[t] = function (r) {
    callback && callback(r.response);
  };
  ipcRenderer.send('editor-api-request', { api: api, token: t, args: args });
}

// Handle API responses
ipcRenderer.on('editor-api-response', function (event, args) {
  const token = args.token;

  if (!_editorAPICallbacks[token]) return;
  _editorAPICallbacks[token](args);
  delete _editorAPICallbacks[token];

  // Also call the global response handler if it exists
  if (_responseHandler) {
    _responseHandler(args);
  }
});

// NOTE: Removed redundant viewer-capture-thumb handler
// The proper screenshot capture flow is:
// 1. viewer.js receives 'viewer-capture-thumb' IPC message
// 2. viewer.js calls this.canvasView.captureThumbnail()  
// 3. captureThumbnail() uses webview.capturePage() to get screenshot
// 4. viewer.js sends the result via 'screenshot-captured-in-viewer'

// Log when this preload script is loaded
console.log('[Preload Viewer] 🚀 PRELOAD SCRIPT LOADED - VERSION 2.1 WITH INSPECTOR DEBUGGING');

// Expose API to renderer process (Directly, requires contextIsolation: false)
window.XgeniaEditorAPI = {
  keyDown(event, cb) {
    makeEditorAPIRequest('keyDown', event, cb);
  },
  inspectNodes(params, cb) {
    // Handle both old format (array) and new format (object with nodeIds and position info)
    let nodeIds;
    let positionInfo = {};

    if (Array.isArray(params)) {
      // Old format: just array of nodeIds
      nodeIds = params;
    } else if (params && params.nodeIds) {
      // New format: object with nodeIds and position info
      nodeIds = params.nodeIds;
      positionInfo = {
        clickX: params.clickX,
        clickY: params.clickY,
        elementRect: params.elementRect,
        nodeLabel: params.nodeLabel
      };
    } else {
      // Fallback: assume it's nodeIds
      nodeIds = params;
    }

    makeEditorAPIRequest('inspectNodes', { nodeIds }, cb);

    // Also send inspector-node-selected IPC message with position info for inline chat
    // This allows CanvasView to show inline chat at the correct position
    const firstNodeId = Array.isArray(nodeIds) ? nodeIds[0] : nodeIds;
    if (firstNodeId) {
      console.log('[Preload Viewer] 📤 Sending inspector-node-selected IPC:', {
        nodeId: firstNodeId,
        nodeLabel: positionInfo.nodeLabel,
        clickX: positionInfo.clickX,
        clickY: positionInfo.clickY,
        elementRect: positionInfo.elementRect,
        scrollX: window.scrollX,
        scrollY: window.scrollY
      });

      // getBoundingClientRect() returns coordinates relative to viewport (already includes scroll)
      // These need to be converted to main window coordinates by adding webview position
      ipcRenderer.sendToHost('inspector-node-selected', {
        nodeId: firstNodeId,
        nodeLabel: positionInfo.nodeLabel || 'Selected Element',
        clickX: positionInfo.clickX,
        clickY: positionInfo.clickY,
        elementRect: positionInfo.elementRect
      });

      console.log('[Preload Viewer] ✅ inspector-node-selected IPC sent via sendToHost');
    }
  },
  // Get project data for inspector integration
  getProjectData(cb) {
    makeEditorAPIRequest('getProjectData', {}, cb);
  },
  // Add setResponseHandler method
  setResponseHandler(callback) {
    // Store the callback for future use
    _responseHandler = callback;
  }
};
console.log('[Preload Viewer] Successfully exposed XgeniaEditorAPI to window');

// ============================================
// Interactive Selection System
// Apple-style selection overlay with drag & resize
// ============================================

let _hoverOverlay = null;       // Thin border on hover (before selection)
let _selectionOverlay = null;   // Full selection frame with handles
let _labelBadge = null;         // Node label badge (top-left)
let _sizeBadge = null;          // Size badge (bottom-right)
let _selectedElement = null;    // Currently selected DOM element
let _selectedNodeId = null;     // Currently selected node ID
let _isDragging = false;        // Whether user is currently dragging
let _isResizing = false;        // Whether user is currently resizing
let _dragStart = null;          // Drag start coordinates
let _resizeHandle = null;       // Which handle is being dragged
let _originalRect = null;       // Element rect at start of interaction


function _injectSelectionStyles() {
  if (document.getElementById('xgenia-selection-styles')) return;
  const style = document.createElement('style');
  style.id = 'xgenia-selection-styles';
  style.textContent = `
    .xg-hover-overlay {
      position: fixed;
      pointer-events: none;
      border: 1px solid rgba(103, 222, 146, 0.5);
      background: rgba(103, 222, 146, 0.04);
      z-index: 999998;
      display: none;
      transition: all 0.06s ease-out;
    }
    .xg-selection-overlay {
      position: fixed;
      pointer-events: none;
      border: 1px solid #67DE92;
      background: transparent;
      z-index: 999999;
      display: none;
    }
    .xg-label-badge {
      position: fixed;
      pointer-events: none;
      z-index: 1000000;
      display: none;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 10px;
      font-weight: 500;
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif;
      color: rgba(255,255,255,0.9);
      background: rgba(30, 30, 32, 0.85);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      white-space: nowrap;
      letter-spacing: 0.2px;
      transform: translateX(-50%);
    }
    .xg-size-badge {
      position: fixed;
      pointer-events: none;
      z-index: 1000000;
      display: none;
      padding: 1px 5px;
      border-radius: 3px;
      font-size: 9px;
      font-weight: 400;
      font-family: -apple-system, BlinkMacSystemFont, 'SF Mono', 'Menlo', monospace;
      color: rgba(255,255,255,0.6);
      background: rgba(30, 30, 32, 0.75);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      white-space: nowrap;
      transform: translateX(-50%);
    }
  `;
  document.head.appendChild(style);
}

function _createOverlayElements() {
  if (_hoverOverlay) return; // Already created
  _injectSelectionStyles();

  // Hover overlay (shown on mousemove)
  _hoverOverlay = document.createElement('div');
  _hoverOverlay.className = 'xg-hover-overlay';
  document.body.appendChild(_hoverOverlay);

  // Selection overlay (shown on click/select)
  _selectionOverlay = document.createElement('div');
  _selectionOverlay.className = 'xg-selection-overlay';
  document.body.appendChild(_selectionOverlay);

  // Label badge
  _labelBadge = document.createElement('div');
  _labelBadge.className = 'xg-label-badge';
  document.body.appendChild(_labelBadge);

  // Size badge
  _sizeBadge = document.createElement('div');
  _sizeBadge.className = 'xg-size-badge';
  document.body.appendChild(_sizeBadge);

}

function showHighlight(element) {
  _createOverlayElements();
  const rect = element.getBoundingClientRect();
  _hoverOverlay.style.left = rect.left + 'px';
  _hoverOverlay.style.top = rect.top + 'px';
  _hoverOverlay.style.width = rect.width + 'px';
  _hoverOverlay.style.height = rect.height + 'px';
  _hoverOverlay.style.display = 'block';
}

function hideHighlight() {
  if (_hoverOverlay) _hoverOverlay.style.display = 'none';
}

function _showSelection(element, nodeId, nodeLabel) {
  _createOverlayElements();
  _selectedElement = element;
  _selectedNodeId = nodeId;

  const rect = element.getBoundingClientRect();
  _updateSelectionPosition(rect);

  // Label badge — centered 20px above element
  const label = nodeLabel || nodeId || 'Element';
  _labelBadge.textContent = label;
  _labelBadge.style.left = (rect.left + rect.width / 2) + 'px';
  _labelBadge.style.top = (rect.top - 20) + 'px';
  _labelBadge.style.display = 'block';

  // Size badge — centered below element
  _sizeBadge.textContent = Math.round(rect.width) + ' × ' + Math.round(rect.height);
  _sizeBadge.style.left = (rect.left + rect.width / 2) + 'px';
  _sizeBadge.style.top = (rect.bottom + 4) + 'px';
  _sizeBadge.style.display = 'block';

  // Show selection border
  _selectionOverlay.style.display = 'block';

  // Hide hover overlay while selected
  _hoverOverlay.style.display = 'none';
}

function _updateSelectionPosition(rect) {
  _selectionOverlay.style.left = rect.left + 'px';
  _selectionOverlay.style.top = rect.top + 'px';
  _selectionOverlay.style.width = rect.width + 'px';
  _selectionOverlay.style.height = rect.height + 'px';
}

function _hideSelection() {
  _selectedElement = null;
  _selectedNodeId = null;
  if (_selectionOverlay) _selectionOverlay.style.display = 'none';
  if (_labelBadge) _labelBadge.style.display = 'none';
  if (_sizeBadge) _sizeBadge.style.display = 'none';
}

function _cleanupOverlays() {
  hideHighlight();
  _hideSelection();
  [_hoverOverlay, _selectionOverlay, _labelBadge, _sizeBadge].forEach(el => {
    if (el && el.parentNode) el.parentNode.removeChild(el);
  });
  _hoverOverlay = null;
  _selectionOverlay = null;
  _labelBadge = null;
  _sizeBadge = null;
  const styleEl = document.getElementById('xgenia-selection-styles');
  if (styleEl) styleEl.remove();
}

// --- Drag to move (overlay-only — never modifies actual DOM) ---
let _dragActive = false; // True once movement exceeds threshold
const DRAG_THRESHOLD = 4; // px before drag actually starts

function _startDrag(e) {
  if (!_selectedElement || _isResizing) return;
  _isDragging = true;
  _dragActive = false; // Not active until threshold exceeded
  _dragStart = { x: e.clientX, y: e.clientY };
  _originalRect = _selectedElement.getBoundingClientRect();
  e.preventDefault();
  e.stopPropagation();
}

function _onDrag(e) {
  if (!_isDragging) return;
  const dx = e.clientX - _dragStart.x;
  const dy = e.clientY - _dragStart.y;

  // Don't activate until threshold exceeded (prevents accidental drag on click)
  if (!_dragActive) {
    if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
    _dragActive = true;
    document.body.style.cursor = 'grabbing';
  }

  // Move only the overlay elements — never the actual DOM element
  const newRect = {
    left: _originalRect.left + dx,
    top: _originalRect.top + dy,
    width: _originalRect.width,
    height: _originalRect.height,
    right: _originalRect.right + dx,
    bottom: _originalRect.bottom + dy,
  };
  _updateSelectionPosition(newRect);
  _labelBadge.style.left = newRect.left + 'px';
  _labelBadge.style.top = (newRect.top - 20) + 'px';
  _sizeBadge.style.left = (newRect.right - 60) + 'px';
  _sizeBadge.style.top = (newRect.bottom + 4) + 'px';
}

function _endDrag(e) {
  if (!_isDragging) return;
  const wasDragActive = _dragActive;
  _isDragging = false;
  _dragActive = false;
  document.body.style.cursor = 'crosshair';

  if (!wasDragActive) return; // Was just a click, not a drag

  const dx = e.clientX - _dragStart.x;
  const dy = e.clientY - _dragStart.y;

  _sendDomGesture('move', { deltaX: dx, deltaY: dy });
  // Overlay stays at new position — preview will re-render when parameters update
}

// --- Resize (overlay-only — never modifies actual DOM) ---
function _startResize(e, handleName) {
  if (!_selectedElement) return;
  _isResizing = true;
  _resizeHandle = handleName;
  _dragStart = { x: e.clientX, y: e.clientY };
  _originalRect = _selectedElement.getBoundingClientRect();
  // Hide badges during resize — only the dynamic size badge will be shown
  if (_labelBadge) _labelBadge.style.display = 'none';
  e.preventDefault();
  e.stopPropagation();
}

function _onResize(e) {
  if (!_isResizing) return;
  const dx = e.clientX - _dragStart.x;
  const dy = e.clientY - _dragStart.y;
  const h = _resizeHandle;

  let newW = _originalRect.width;
  let newH = _originalRect.height;
  let newL = _originalRect.left;
  let newT = _originalRect.top;

  if (h.includes('e')) { newW += dx; }
  if (h.includes('w')) { newW -= dx; newL += dx; }
  if (h.includes('s')) { newH += dy; }
  if (h.includes('n')) { newH -= dy; newT += dy; }

  // Shift key = maintain aspect ratio
  if (e.shiftKey && _originalRect.width > 0 && _originalRect.height > 0) {
    const aspect = _originalRect.width / _originalRect.height;
    if (Math.abs(dx) > Math.abs(dy)) {
      newH = newW / aspect;
    } else {
      newW = newH * aspect;
    }
  }

  // Minimum size
  newW = Math.max(newW, 10);
  newH = Math.max(newH, 10);

  // Move only the overlay — never the actual DOM element
  const visualRect = {
    left: newL, top: newT,
    width: newW, height: newH,
    right: newL + newW, bottom: newT + newH,
  };
  _updateSelectionPosition(visualRect);
  _sizeBadge.textContent = Math.round(newW) + ' × ' + Math.round(newH);
  _sizeBadge.style.left = (visualRect.right - 60) + 'px';
  _sizeBadge.style.top = (visualRect.bottom + 4) + 'px';
}

function _endResize(e) {
  if (!_isResizing) return;
  _isResizing = false;

  const dx = e.clientX - _dragStart.x;
  const dy = e.clientY - _dragStart.y;
  const h = _resizeHandle;

  let newW = _originalRect.width;
  let newH = _originalRect.height;
  if (h.includes('e')) { newW += dx; }
  if (h.includes('w')) { newW -= dx; }
  if (h.includes('s')) { newH += dy; }
  if (h.includes('n')) { newH -= dy; }
  newW = Math.max(newW, 10);
  newH = Math.max(newH, 10);

  const dw = newW - _originalRect.width;
  const dh = newH - _originalRect.height;

  if (Math.abs(dw) > 1 || Math.abs(dh) > 1) {
    _sendDomGesture('resize', { width: Math.round(newW), height: Math.round(newH) });
  }
  // Restore label badge after resize
  if (_labelBadge && _selectedElement) {
    const finalRect = _selectedElement.getBoundingClientRect();
    _labelBadge.style.left = finalRect.left + 'px';
    _labelBadge.style.top = (finalRect.bottom + 4) + 'px';
    _labelBadge.style.display = 'block';
  }
  // Overlay stays at new size — preview will re-render when parameters update
}

// Global mouse handlers for drag/resize (attached when inspector is enabled)
function _globalMouseMove(e) {
  if (_isDragging) { _onDrag(e); return; }
  if (_isResizing) { _onResize(e); return; }
}

function _globalMouseUp(e) {
  if (_isDragging) { _endDrag(e); return; }
  if (_isResizing) { _endResize(e); return; }
}

// --- Gesture payload helpers ---

function _rectOf(el) {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

function _parentRectOf(el) {
  const p = el.parentElement;
  return p ? _rectOf(p) : null;
}

// Screen-delta math is wrong under a rotated/scaled ancestor — fail closed.
function _hasTransformedAncestor(el) {
  let cur = el.parentElement;
  while (cur && cur !== document.body) {
    const t = getComputedStyle(cur).transform;
    if (t && t !== 'none') {
      // translate-only matrices are fine: matrix(1, 0, 0, 1, tx, ty)
      const m = t.match(/^matrix\(([-\d.]+), ([-\d.]+), ([-\d.]+), ([-\d.]+),/);
      if (!m || m[1] !== '1' || m[2] !== '0' || m[3] !== '0' || m[4] !== '1') return true;
    }
    cur = cur.parentElement;
  }
  return false;
}

// Which resize handle (if any) does a point on the selection frame correspond to?
// 8px grab zone on edges/corners of the selected element's current rect.
const HANDLE_ZONE = 8;
function _handleAtPoint(x, y) {
  if (!_selectedElement) return null;
  const r = _selectedElement.getBoundingClientRect();
  const nearL = Math.abs(x - r.left) <= HANDLE_ZONE;
  const nearR = Math.abs(x - r.right) <= HANDLE_ZONE;
  const nearT = Math.abs(y - r.top) <= HANDLE_ZONE;
  const nearB = Math.abs(y - r.bottom) <= HANDLE_ZONE;
  const insideX = x >= r.left - HANDLE_ZONE && x <= r.right + HANDLE_ZONE;
  const insideY = y >= r.top - HANDLE_ZONE && y <= r.bottom + HANDLE_ZONE;
  if (!insideX || !insideY) return null;
  let h = '';
  if (nearT) h += 'n'; else if (nearB) h += 's';
  if (nearL) h += 'w'; else if (nearR) h += 'e';
  return h || null;
}

function _isInsideSelection(x, y) {
  if (!_selectedElement) return false;
  const r = _selectedElement.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

// Brief "why nothing moved" feedback on a blocked gesture, reusing the label badge.
function _flashBlocked(reason) {
  if (!_labelBadge || !_selectedElement) return;
  const messages = {
    'in-flow': 'Managed by layout — reorder coming soon',
    'transformed-ancestor': 'Inside a transformed container',
    'rotated-target': 'Rotated — resize not supported yet',
    'no-parent-box': 'No parent box to measure against'
  };
  const prev = _labelBadge.textContent;
  _labelBadge.textContent = messages[reason] || 'Cannot edit this element';
  _labelBadge.style.display = 'block';
  setTimeout(() => {
    if (_labelBadge) _labelBadge.textContent = prev;
    // Overlay may be stale after a blocked drag — resnap it to the element.
    if (_selectedElement) _updateSelectionPosition(_selectedElement.getBoundingClientRect());
  }, 1500);
}

function _sendDomGesture(gesture, fields) {
  if (!_selectedNodeId || !_selectedElement) return;
  const payload = {
    label: gesture === 'move' ? 'Move element' : 'Resize element',
    targets: [Object.assign({
      nodeId: _selectedNodeId,
      kind: 'dom',
      gesture,
      startRect: { width: _originalRect.width, height: _originalRect.height },
      parentRect: _parentRectOf(_selectedElement),
      ancestorTransformed: _hasTransformedAncestor(_selectedElement)
    }, fields)]
  };
  makeEditorAPIRequest('viewportGesture', payload, (res) => {
    const blocked = res && res.blocked && res.blocked[0];
    if (blocked) _flashBlocked(blocked.reason);
  });
}


// --- Viewport Zoom (Chromium native zoom via Electron's webview.setZoomFactor) ---
// Only active in Edit mode (inspector enabled) — Preview mode has normal page behavior
let _lastZoomTime = 0;
let _inspectorEnabled = false; // Set by XgeniaEditorInspectorAPI.setEnabled()

document.addEventListener('wheel', (e) => {
  if (!_inspectorEnabled) return; // Preview mode — don't intercept
  if (e.metaKey || e.ctrlKey) {
    e.preventDefault();
    e.stopPropagation();
    // Throttle: max ~33 zoom messages per second
    const now = Date.now();
    if (now - _lastZoomTime < 30) return;
    _lastZoomTime = now;
    const delta = e.deltaY > 0 ? -0.05 : 0.05;
    ipcRenderer.sendToHost('editor-zoom-viewport', { delta: delta });
  }
}, { passive: false });

document.addEventListener('keydown', (e) => {
  if (!_inspectorEnabled) return; // Preview mode — don't intercept
  if (!(e.metaKey || e.ctrlKey)) return;
  if (e.key === '0') {
    e.preventDefault();
    ipcRenderer.sendToHost('editor-zoom-viewport', { reset: true });
  } else if (e.key === '=' || e.key === '+') {
    e.preventDefault();
    ipcRenderer.sendToHost('editor-zoom-viewport', { delta: 0.1 });
  } else if (e.key === '-') {
    e.preventDefault();
    ipcRenderer.sendToHost('editor-zoom-viewport', { delta: -0.1 });
  }
});

// Expose Inspector API
window.XgeniaEditorInspectorAPI = {
  setEnabled: (enabled) => {
    console.log('[Inspector] setEnabled called:', enabled);
    _inspectorEnabled = enabled; // Gate zoom handlers to edit mode only

    if (enabled) {
      // Enable inspector mode
      document.body.style.cursor = 'crosshair';
      _createOverlayElements();

      // --- Hover handler ---
      const mouseMoveHandler = (e) => {
        // Skip if dragging or resizing
        if (_isDragging || _isResizing) return;

        // Resize/move cursors take precedence around the selected element
        if (_selectedElement) {
          const h = _handleAtPoint(e.clientX, e.clientY);
          if (h) {
            document.body.style.cursor = h + '-resize';
          } else if (_isInsideSelection(e.clientX, e.clientY)) {
            document.body.style.cursor = 'move';
          } else {
            document.body.style.cursor = 'crosshair';
          }
        }

        const element = document.elementFromPoint(e.clientX, e.clientY);
        if (!element) return;

        // Skip our own overlay elements
        if (element.closest('.xg-hover-overlay, .xg-selection-overlay, .xg-label-badge, .xg-size-badge')) return;

        const xgeniaNode = findXgeniaNodeForElement(element);
        if (xgeniaNode) {
          // Don't show hover overlay on the already-selected element
          if (_selectedElement && element === _selectedElement) return;
          showHighlight(element);
          ipcRenderer.sendToHost('inspector-node-found', {
            nodeId: xgeniaNode,
            elementInfo: {
              tagName: element.tagName,
              className: element.className,
              id: element.id
            }
          });
        } else {
          hideHighlight();
        }
      };

      // --- Click handler (select + begin drag) ---
      const clickHandler = (e) => {
        console.log('[Inspector] Click at', e.clientX, e.clientY);

        const elementsToTry = [];
        const elementAtPoint = document.elementFromPoint(e.clientX, e.clientY);
        if (elementAtPoint) elementsToTry.push(elementAtPoint);
        if (e.target && e.target !== elementAtPoint) elementsToTry.push(e.target);
        let current = e.target;
        for (let i = 0; i < 3 && current; i++) {
          if (!elementsToTry.includes(current)) elementsToTry.push(current);
          current = current.parentElement;
        }

        let nodeId = null;
        let foundElement = null;
        for (const element of elementsToTry) {
          // Skip our own overlay elements
          if (element.closest('.xg-hover-overlay, .xg-selection-overlay, .xg-label-badge, .xg-size-badge')) continue;
          nodeId = findXgeniaNodeForElement(element);
          if (nodeId) {
            foundElement = element;
            break;
          }
        }

        if (nodeId && nodeId !== 'none') {
          e.preventDefault();
          e.stopPropagation();

          const elementRect = foundElement ? foundElement.getBoundingClientRect() : null;

          let nodeLabel = 'Selected Element';
          if (foundElement) {
            if (foundElement.getAttribute('data-xgenia-node-label')) {
              nodeLabel = foundElement.getAttribute('data-xgenia-node-label');
            } else if (foundElement.getAttribute('data-node-label')) {
              nodeLabel = foundElement.getAttribute('data-node-label');
            }
          }

          // Show the interactive selection frame
          _showSelection(foundElement, nodeId, nodeLabel);

          const positionData = {
            nodeId: nodeId,
            nodeLabel: nodeLabel,
            clickX: e.clientX,
            clickY: e.clientY,
            elementRect: elementRect ? {
              left: elementRect.left,
              top: elementRect.top,
              width: elementRect.width,
              height: elementRect.height
            } : null
          };

          ipcRenderer.sendToHost('inspector-node-selected', positionData);

          makeEditorAPIRequest('inspectNodes', { nodeIds: [nodeId] }, () => {
            console.log('[Inspector] Node selected:', nodeId);
          });
        } else {
          // Clicked on empty space — deselect
          _hideSelection();
        }
      };

      // --- Mousedown handler: entry point for drag-move and edge-resize ---
      // Constraints live editor-side in TransformCommandResolver; anything it
      // can't translate safely comes back blocked and only flashes a hint.
      const mousedownHandler = (e) => {
        if (e.button !== 0) return;
        const handle = _handleAtPoint(e.clientX, e.clientY);
        if (handle) {
          _startResize(e, handle);
          return;
        }
        if (_isInsideSelection(e.clientX, e.clientY)) {
          _startDrag(e);
        }
        // Otherwise fall through: clickHandler does selection/deselection.
      };

      // Attach all listeners
      document.addEventListener('mousemove', mouseMoveHandler, true);
      document.addEventListener('click', clickHandler, true);
      document.addEventListener('mousedown', mousedownHandler, true);
      document.addEventListener('mousemove', _globalMouseMove, true);
      document.addEventListener('mouseup', _globalMouseUp, true);

      // No separate handle listeners needed — mousedownHandler handles resize

      // Store handlers for cleanup
      window._inspectorMouseHandler = mouseMoveHandler;
      window._inspectorClickHandler = clickHandler;
      window._inspectorMousedownHandler = mousedownHandler;

      // --- PixiJS Editing Bridge IPC ---
      // The PixiEditBridge handles its own mouse events on a canvas overlay.
      // We just need to forward selection/transform events to the editor via IPC.
      //
      // (2026-08-10) TURN THE GIZMO OVERLAY ON. It used to be created by every pixi.Stage on
      // init, everywhere — including plain browser pages and shipped games, where it stacked a
      // second canvas over the stage at z-index 9999 with pointer-events:auto and swallowed
      // clicks on the reels. The bridge now creates it only when the editor asks, and this is
      // the ask. Sticky on the bridge side, so a Stage that initialises before this runs still
      // gets its overlay.
      window.__PIXI_EDIT_BRIDGE?.setEditMode?.(true);
      window.__PIXI_EDIT_CALLBACK = (channel, data) => {
        try {
          if (channel === 'pixi-select-node') {
            // Hide DOM selection overlay — the bridge draws its own gizmos
            _hideSelection();
            hideHighlight();
            // Select node in editor via EditorAPI
            makeEditorAPIRequest('inspectNodes', { nodeIds: [data.nodeId] }, () => {
              console.log('[Inspector] PixiJS node selected:', data.nodeId);
            });
          } else if (channel === 'pixi-deselect-node') {
            // Nothing to do on the editor side for deselection
          } else if (channel === 'pixi-transform-node') {
            // The bridge applies live feedback in-page; the model is written
            // once, on commit, through the same resolver as DOM gestures.
            if (!data.commit) return;
            const gesture = data.rotation !== undefined ? 'rotate'
              : data.width !== undefined ? 'resize' : 'move';
            makeEditorAPIRequest('viewportGesture', {
              label: gesture === 'move' ? 'Move sprite'
                : gesture === 'resize' ? 'Resize sprite' : 'Rotate sprite',
              targets: [{
                nodeId: data.nodeId,
                kind: 'pixi',
                gesture,
                x: data.x, y: data.y,
                width: data.width, height: data.height,
                rotation: data.rotation
              }]
            }, () => { });
          }
        } catch (e) {
          console.error('[Preload] Error in PixiEdit callback:', e);
        }
      };

      console.log('[Inspector] ✅ Interactive editing enabled');
    } else {
      // Disable inspector mode
      document.body.style.cursor = '';

      // Remove event listeners
      if (window._inspectorMouseHandler) {
        document.removeEventListener('mousemove', window._inspectorMouseHandler, true);
        window._inspectorMouseHandler = null;
      }
      if (window._inspectorClickHandler) {
        document.removeEventListener('click', window._inspectorClickHandler, true);
        window._inspectorClickHandler = null;
      }
      if (window._inspectorMousedownHandler) {
        document.removeEventListener('mousedown', window._inspectorMousedownHandler, true);
        window._inspectorMousedownHandler = null;
      }
      document.removeEventListener('mousemove', _globalMouseMove, true);
      document.removeEventListener('mouseup', _globalMouseUp, true);

      // Clean up all overlays
      _cleanupOverlays();

      // Clean up PixiJS bridge callback, and take the gizmo overlay down with it — leaving it
      // behind is how a preview-mode click ends up dragging a sprite.
      window.__PIXI_EDIT_BRIDGE?.setEditMode?.(false);
      window.__PIXI_EDIT_CALLBACK = null;

      console.log('[Inspector] Interactive editing disabled');
    }

    // Call the React app's inspector handler if it exists
    if (typeof window.setInspectorEnabled === 'function') {
      try {
        window.setInspectorEnabled(enabled);
      } catch (e) {
        console.error('[Preload Viewer] Error setting inspector enabled:', e);
      }
    }
  }
};

/**
 * Find XGENIA node ID for a DOM element
 * This function tries multiple strategies to map DOM elements back to XGENIA nodes
 */
function findXgeniaNodeForElement(element) {
  if (!element) return null;

  // Strategy 1: Use the NodeRegistry if available
  if (window.XgeniaNodeRegistry && window.XgeniaNodeRegistry.getNodeId) {
    const nodeId = window.XgeniaNodeRegistry.getNodeId(element);
    if (nodeId) {
      return nodeId;
    }
  }

  // Strategy 2: Check the element itself first, then traverse up
  let currentElement = element;
  let depth = 0;
  while (currentElement && currentElement !== document.body && depth < 10) { // Limit depth to prevent infinite loops

    // Check data attributes
    if (currentElement.hasAttribute('data-xgenia-node-id')) {
      return currentElement.getAttribute('data-xgenia-node-id');
    }
    if (currentElement.hasAttribute('data-node-id')) {
      return currentElement.getAttribute('data-node-id');
    }
    if (currentElement.hasAttribute('data-xgenia-id')) {
      return currentElement.getAttribute('data-xgenia-id');
    }

    // Check if the element ID contains a node ID
    if (currentElement.id) {
      const extractedId = extractNodeIdFromString(currentElement.id);
      if (extractedId) {
        return extractedId;
      }
    }

    // Check if any class contains a node ID
    if (currentElement.className) {
      const classes = currentElement.className.split(' ');
      for (let className of classes) {
        const extractedId = extractNodeIdFromString(className);
        if (extractedId) {
          return extractedId;
        }
      }
    }

    currentElement = currentElement.parentElement;
    depth++;
  }


  // Strategy 3: Try to find React fiber information
  try {
    currentElement = element;
    while (currentElement && currentElement !== document.body) {
      // Check if this element has React fiber data
      const fiberKey = Object.keys(currentElement).find(key =>
        key.startsWith('__reactFiber$') ||
        key.startsWith('__reactInternalInstance$')
      );

      if (fiberKey) {
        const fiber = currentElement[fiberKey];
        if (fiber && fiber.return) {
          // Try to find xgeniaNode in fiber props or state
          const nodeId = findNodeIdInFiber(fiber);
          if (nodeId) {
            return nodeId;
          }
        }
      }
      currentElement = currentElement.parentElement;
    }
  } catch (e) {
    // Silently ignore React fiber access errors
  }


  // Strategy 4: Try to match by class names or IDs (fallback)
  try {
    currentElement = element;
    while (currentElement && currentElement !== document.body) {
      const id = currentElement.id;
      if (id && (id.includes('xgenia') || id.includes('node'))) {
        return id;
      }

      // Check class names for patterns
      const classList = Array.from(currentElement.classList);
      const xgeniaClass = classList.find(cls =>
        cls.includes('xgenia') || cls.includes('node')
      );
      if (xgeniaClass) {
        // Extract potential node ID from class
        const match = xgeniaClass.match(/node-([a-f0-9-]+)/);
        if (match) {
          return match[1];
        }
      }

      currentElement = currentElement.parentElement;
    }
  } catch (e) {
    // Silently ignore fallback matching errors
  }

  return null;
}

/**
 * Try to find node ID in React fiber tree
 */
function findNodeIdInFiber(fiber) {
  try {
    // Check current fiber
    if (fiber.memoizedProps) {
      const props = fiber.memoizedProps;
      if (props['data-xgenia-node-id']) return props['data-xgenia-node-id'];
      if (props['data-node-id']) return props['data-node-id'];
      if (props.xgeniaNodeId) return props.xgeniaNodeId;
      if (props.nodeId) return props.nodeId;
    }

    // Check fiber state
    if (fiber.memoizedState) {
      const state = fiber.memoizedState;
      if (state.xgeniaNodeId) return state.xgeniaNodeId;
      if (state.nodeId) return state.nodeId;
    }

    // Walk up the fiber tree
    let current = fiber.return;
    while (current) {
      if (current.memoizedProps) {
        const props = current.memoizedProps;
        if (props['data-xgenia-node-id']) return props['data-xgenia-node-id'];
        if (props['data-node-id']) return props['data-node-id'];
        if (props.xgeniaNodeId) return props.xgeniaNodeId;
        if (props.nodeId) return props.nodeId;
      }
      current = current.return;
    }
  } catch (e) {
    // Silently ignore fiber traversal errors
  }

  return null;
}

// Expose Highlight API
window.XgeniaEditorHighlightAPI = {
  selectNode: (nodeId) => {
    console.log('[HighlightAPI] selectNode:', nodeId);

    if (!nodeId) {
      _hideSelection();
      return;
    }

    // Find the DOM element for this node
    const element = document.querySelector(`[data-xgenia-node-id="${nodeId}"]`);
    if (element) {
      const label = element.getAttribute('data-xgenia-node-label') || nodeId;
      _showSelection(element, nodeId, label);
    } else {
      // Fallback to old handler
      if (typeof window.highlightNode === 'function') {
        try { window.highlightNode(nodeId); } catch (e) { /* ignore */ }
      }
    }
  }
};

// Expose Node Registration API for components to register their DOM elements
window.XgeniaNodeRegistry = {
  // Store mapping of DOM elements to node IDs
  elementToNodeMap: new WeakMap(),

  // Register a DOM element with its node ID
  registerElement: function (element, nodeId) {
    if (element && nodeId) {
      console.log('[NodeRegistry] Registering element for node:', nodeId);
      this.elementToNodeMap.set(element, nodeId);

      // Add data attribute for easy lookup
      element.setAttribute('data-xgenia-node-id', nodeId);

      // Also try to add it to the closest meaningful element if this one doesn't work
      if (element.tagName === 'DIV' && !element.id && !element.className) {
        // This might be a wrapper div, try to find a more specific child
        const meaningfulChild = element.querySelector('button, input, img, canvas, svg, video, audio, textarea, select');
        if (meaningfulChild) {
          meaningfulChild.setAttribute('data-xgenia-node-id', nodeId);
          this.elementToNodeMap.set(meaningfulChild, nodeId);
        }
      }
    }
  },

  // Get node ID for a DOM element
  getNodeId: function (element) {
    // First try direct lookup
    let nodeId = this.elementToNodeMap.get(element);
    if (nodeId) return nodeId;

    // Try data attribute
    if (element.hasAttribute && element.hasAttribute('data-xgenia-node-id')) {
      return element.getAttribute('data-xgenia-node-id');
    }

    // Walk up the DOM tree to find a registered element
    let currentElement = element.parentElement;
    while (currentElement && currentElement !== document.body) {
      nodeId = this.elementToNodeMap.get(currentElement);
      if (nodeId) return nodeId;

      if (currentElement.hasAttribute && currentElement.hasAttribute('data-xgenia-node-id')) {
        return currentElement.getAttribute('data-xgenia-node-id');
      }

      currentElement = currentElement.parentElement;
    }

    return null;
  }
};

// Initialize inspector integration with real project data
const initializeInspectorIntegration = () => {
  console.log('[Inspector] 🔧 INITIALIZING REAL INSPECTOR INTEGRATION - VERSION 2.0');

  // Get project data from the XGENIA editor
  if (window.XgeniaEditorAPI && window.XgeniaEditorAPI.getProjectData) {
    window.XgeniaEditorAPI.getProjectData((projectData) => {
      if (projectData && projectData.nodes) {
        console.log('[Inspector] Received project data with', projectData.nodes.length, 'nodes');

        // Register all nodes from the project
        projectData.nodes.forEach((node) => {
          // Try multiple strategies to find and register DOM elements for this node
          registerNodeElements(node);
        });

        console.log('[Inspector] ✅ Real node registration complete - registered', projectData.nodes.length, 'nodes');

        // Also scan for any unregistered interactive elements and try to match them
        autoRegisterUnmatchedElements();

        // Set up continuous monitoring for dynamically added elements
        setupDynamicElementMonitoring(projectData.nodes);

      } else {
        console.log('[Inspector] No project data available, falling back to auto-registration');
        autoRegisterUnmatchedElements();
      }
    });
  } else {
    console.log('[Inspector] XgeniaEditorAPI.getProjectData not available, using auto-registration');
    autoRegisterUnmatchedElements();
  }
};

// Monitor for dynamically added elements and register them
const setupDynamicElementMonitoring = (nodes) => {
  console.log('[Inspector] Setting up dynamic element monitoring');

  // Create a map of node IDs to node data for quick lookup
  const nodeMap = new Map();
  nodes.forEach(node => nodeMap.set(node.id, node));

  // Function to check and register new elements
  const checkAndRegisterNewElements = () => {
    // Look for elements with IDs that match node IDs but aren't registered
    nodes.forEach(node => {
      if (!isNodeRegistered(node.id)) {
        const element = document.getElementById(node.id);
        if (element && !element.hasAttribute('data-xgenia-node-id')) {
          console.log(`[Inspector] Found dynamically added element for node: ${node.id}`);
          window.XgeniaNodeRegistry.registerElement(element, node.id);
        }
      }
    });

    // Also check for elements with xgenia-style-tag that might be new
    const styledElements = document.querySelectorAll('[xgenia-style-tag]');
    styledElements.forEach(element => {
      if (element instanceof HTMLElement && !element.hasAttribute('data-xgenia-node-id')) {
        // Try to extract node ID from element attributes
        const nodeId = extractNodeIdFromElement(element);
        if (nodeId && nodeMap.has(nodeId)) {
          console.log(`[Inspector] Registering styled element with node: ${nodeId}`);
          window.XgeniaNodeRegistry.registerElement(element, nodeId);
        }
      }
    });
  };

  // Check immediately
  checkAndRegisterNewElements();

  // Set up periodic checking (every 2 seconds)
  setInterval(checkAndRegisterNewElements, 2000);

  // Also use MutationObserver for immediate detection
  const observer = new MutationObserver((mutations) => {
    let hasNewElements = false;
    mutations.forEach((mutation) => {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        hasNewElements = true;
      }
    });

    if (hasNewElements) {
      // Small delay to let elements settle
      setTimeout(checkAndRegisterNewElements, 100);
    }
  });

  // Start observing
  if (document.body) {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['id', 'class', 'xgenia-style-tag']
    });
  }
};

// Check if a node ID is already registered
const isNodeRegistered = (nodeId) => {
  // Check if any element has this node ID registered
  const elements = document.querySelectorAll('[data-xgenia-node-id]');
  for (let element of elements) {
    if (element.getAttribute('data-xgenia-node-id') === nodeId) {
      return true;
    }
  }
  return false;
};

// Extract node ID from a string (like element ID or class name)
const extractNodeIdFromString = (str) => {
  // Look for UUID pattern in the string
  const uuidPattern = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i;
  const match = str.match(uuidPattern);
  return match ? match[0] : null;
};

// Extract node ID from element attributes
const extractNodeIdFromElement = (element) => {
  // Try various ways to extract node ID from element
  if (element.id) {
    const extractedId = extractNodeIdFromString(element.id);
    if (extractedId) return extractedId;
  }

  // Check class names for node IDs
  if (element.className) {
    const classes = element.className.split(' ');
    for (let className of classes) {
      const extractedId = extractNodeIdFromString(className);
      if (extractedId) return extractedId;
    }
  }

  return null;
};

// Register DOM elements for a specific node
const registerNodeElements = (node) => {
  const elements = findElementsForNode(node);

  elements.forEach((element) => {
    if (element && !element.hasAttribute('data-xgenia-node-id')) {
      window.XgeniaNodeRegistry.registerElement(element, node.id);
      console.log(`[Inspector] Registered element for node: ${node.id} (${node.label || node.type})`);
    }
  });
};

// Auto-register unmatched interactive elements
const autoRegisterUnmatchedElements = () => {
  console.log('[Inspector] 🔍 Scanning for interactive elements...');

  // Find all interactive elements that aren't registered yet
  const selectors = ['button', 'input', 'select', 'textarea', '[role="button"]'];
  let totalElements = 0;

  selectors.forEach(selector => {
    const elements = document.querySelectorAll(selector);
    totalElements += elements.length;
    console.log(`[Inspector] Found ${elements.length} ${selector} elements`);
  });

  console.log(`[Inspector] Total interactive elements found: ${totalElements}`);

  // Find all interactive elements that aren't registered yet
  const unregisteredSelectors = [
    'button:not([data-xgenia-node-id])',
    'input:not([data-xgenia-node-id])',
    'img:not([data-xgenia-node-id])',
    'div[role="button"]:not([data-xgenia-node-id])',
    'a:not([data-xgenia-node-id])'
  ];

  unregisteredSelectors.forEach(selector => {
    const elements = document.querySelectorAll(selector);
    elements.forEach((element, index) => {
      if (element instanceof HTMLElement) {
        // Generate a meaningful ID based on element properties
        const elementId = generateElementId(element, index);
        window.XgeniaNodeRegistry.registerElement(element, elementId);
        console.log(`[Inspector] Auto-registered element: ${elementId} (${element.tagName})`);
      }
    });
  });

  console.log('[Inspector] Auto-registration complete');
};

// Generate a meaningful ID for an element
const generateElementId = (element, index) => {
  // Try to create a meaningful identifier based on element properties
  const parts = [element.tagName.toLowerCase()];

  if (element.id) {
    parts.push(element.id);
  } else if (element.className) {
    parts.push(element.className.split(' ').join('-'));
  } else if (element.textContent && element.textContent.trim()) {
    parts.push(element.textContent.trim().substring(0, 20).replace(/\s+/g, '-'));
  } else if (element.tagName === 'IMG' && element.src) {
    const srcParts = element.src.split('/').pop().split('.');
    if (srcParts[0]) parts.push(srcParts[0]);
  }

  parts.push(index.toString());

  return parts.join('-').replace(/[^a-zA-Z0-9-_]/g, '');
};

// Helper function to find DOM elements that correspond to a XGENIA node
const findElementsForNode = (node) => {
  const elements = [];

  // Try different strategies to find matching elements

  // 1. By data attributes (if the node has them)
  if (node.attributes) {
    if (node.attributes.id) {
      const element = document.getElementById(node.attributes.id);
      if (element) elements.push(element);
    }

    if (node.attributes.className) {
      const classElements = document.querySelectorAll(`.${node.attributes.className}`);
      classElements.forEach(el => elements.push(el));
    }

    if (node.attributes['data-testid']) {
      const testElements = document.querySelectorAll(`[data-testid="${node.attributes['data-testid']}"]`);
      testElements.forEach(el => elements.push(el));
    }

    if (node.attributes.name) {
      const namedElements = document.querySelectorAll(`[name="${node.attributes.name}"]`);
      namedElements.forEach(el => elements.push(el));
    }
  }

  // 2. By node type and content matching
  const typeSelectors = {
    'Button': 'button',
    'Image': 'img',
    'Img': 'img',
    'Input': 'input',
    'TextInput': 'input',
    'TextArea': 'textarea',
    'Select': 'select',
    'Anchor': 'a',
    'Link': 'a'
  };

  const selector = typeSelectors[node.type];
  if (selector) {
    const typeElements = document.querySelectorAll(selector);
    typeElements.forEach(element => {
      // Additional matching logic based on node properties
      if (shouldMatchElement(element, node)) {
        elements.push(element);
      }
    });
  }

  return elements;
};

// Determine if an element should be matched to a node
const shouldMatchElement = (element, node) => {
  // Don't match if already registered
  if (element.hasAttribute('data-xgenia-node-id')) return false;

  // Match by text content for buttons/links
  if ((node.type === 'Button' || node.type === 'Link') && node.label) {
    if (element.textContent && element.textContent.includes(node.label)) {
      return true;
    }
  }

  // Match by src for images
  if (node.type === 'Image' && node.attributes && node.attributes.src) {
    if (element.src && element.src.includes(node.attributes.src)) {
      return true;
    }
  }

  // Match by alt text for images
  if (node.type === 'Image' && node.label) {
    if (element.alt && element.alt.includes(node.label)) {
      return true;
    }
  }

  // Match by placeholder/name for inputs
  if ((node.type === 'Input' || node.type === 'TextInput') && node.attributes) {
    if (node.attributes.placeholder && element.placeholder && element.placeholder.includes(node.attributes.placeholder)) {
      return true;
    }
    if (node.attributes.name && element.name && element.name === node.attributes.name) {
      return true;
    }
  }

  return false; // Default: don't match
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeInspectorIntegration);
} else {
  // DOM already loaded
  setTimeout(initializeInspectorIntegration, 100);
}

console.log('[Preload Viewer] Successfully exposed XgeniaEditorInspectorAPI, XgeniaEditorHighlightAPI, and XgeniaNodeRegistry to window');

// Override getUserMedia to ask user for permission first, but only if mediaDevices exists
if (window.navigator && window.navigator.mediaDevices && window.navigator.mediaDevices.getUserMedia) {
  const _getUserMedia = window.navigator.mediaDevices.getUserMedia;
  window.navigator.mediaDevices.getUserMedia = function (constraints) {
    const types = [];
    if (constraints.video !== undefined && constraints.video !== false) {
      types.push('video');
    }

    if (constraints.audio !== undefined && constraints.audio !== false) {
      types.push('audio');
    }

    return new Promise(function (resolve, reject) {
      // Must request access to media
      ipcRenderer.on('request-media-access-reply', function (event, result) {
        if (result === true) {
          // Continue with getUserMedia request
          _getUserMedia.apply(window.navigator.mediaDevices, [constraints]).then(resolve).catch(reject);
        } else reject(new Error('Could not get access to media device'));
      });
      ipcRenderer.send('request-media-access', types);
    });
  };
}
