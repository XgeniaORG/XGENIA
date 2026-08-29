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
let _isRotating = false;        // Whether user is currently rotating
let _dragStart = null;          // Drag start coordinates
let _dragAxis = null;           // 'x' | 'y' when dragging via an axis arrow
let _resizeHandle = null;       // Which handle is being dragged
let _originalRect = null;       // Element rect at start of interaction
let _rotateStartAngle = 0;      // Pointer angle at rotation start (radians)
let _rotateDeltaDeg = 0;        // Accumulated rotation delta (degrees)
let _gizmo = null;              // Handle/lollipop/arrow elements on the selection frame
let _selectedCaps = null;       // Capabilities of the selected node (from editor)
let _livePreviewBase = '';      // Element's computed transform at gesture start


function _injectSelectionStyles() {
  if (document.getElementById('xgenia-selection-styles')) return;
  const style = document.createElement('style');
  style.id = 'xgenia-selection-styles';
  style.textContent = `
    .xg-hover-overlay {
      display: none !important; /* highlight appears on selection only */
    }
    .xg-selection-overlay {
      position: fixed;
      pointer-events: none;
      border: 1px solid rgba(255, 255, 255, 0.85);
      border-radius: 3px;
      box-shadow:
        0 0 0 1px rgba(10, 132, 255, 0.65),
        0 0 0 4px rgba(10, 132, 255, 0.10),
        0 10px 28px rgba(0, 0, 0, 0.20);
      background: transparent;
      z-index: 999999;
      display: none;
    }
    .xg-label-badge {
      position: fixed;
      pointer-events: none;
      z-index: 1000000;
      display: none;
      padding: 3px 9px;
      border-radius: 8px;
      font-size: 11px;
      font-weight: 500;
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif;
      color: rgba(255,255,255,0.95);
      background: rgba(28, 28, 30, 0.68);
      border: 0.5px solid rgba(255, 255, 255, 0.16);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      box-shadow: 0 4px 14px rgba(0,0,0,0.25);
      white-space: nowrap;
      letter-spacing: 0.2px;
      transform: translateX(-50%);
    }
    .xg-size-badge {
      position: fixed;
      pointer-events: none;
      z-index: 1000000;
      display: none;
      padding: 2px 7px;
      border-radius: 7px;
      font-size: 10px;
      font-weight: 500;
      font-family: -apple-system, BlinkMacSystemFont, 'SF Mono', 'Menlo', monospace;
      font-variant-numeric: tabular-nums;
      color: rgba(255,255,255,0.85);
      background: rgba(28, 28, 30, 0.62);
      border: 0.5px solid rgba(255, 255, 255, 0.14);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      box-shadow: 0 4px 14px rgba(0,0,0,0.22);
      white-space: nowrap;
      transform: translateX(-50%);
    }
    .xg-tooltip {
      position: fixed;
      pointer-events: none;
      z-index: 1000001;
      padding: 4px 9px;
      border-radius: 8px;
      font-size: 11px;
      font-weight: 500;
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif;
      color: rgba(255,255,255,0.95);
      background: rgba(28, 28, 30, 0.72);
      border: 0.5px solid rgba(255, 255, 255, 0.18);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      box-shadow: 0 6px 18px rgba(0,0,0,0.3);
      white-space: nowrap;
      transform: translate(-50%, -135%);
      opacity: 0;
      transition: opacity 0.12s ease-out;
    }
    .xg-tooltip.xg-tip-on { opacity: 1; }
    .xg-handle {
      position: absolute;
      width: 11px;
      height: 11px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.62);
      border: 0.5px solid rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(14px) saturate(180%);
      -webkit-backdrop-filter: blur(14px) saturate(180%);
      box-shadow:
        0 1px 5px rgba(0, 0, 0, 0.28),
        inset 0 0 0 0.5px rgba(255, 255, 255, 0.4);
      transition: transform 0.12s ease-out, box-shadow 0.12s ease-out;
      display: none;
    }
    .xg-handle.xg-hot {
      transform: scale(1.3);
      box-shadow:
        0 0 0 3px rgba(10, 132, 255, 0.28),
        0 2px 8px rgba(0, 0, 0, 0.32),
        inset 0 0 0 0.5px rgba(255, 255, 255, 0.5);
    }
    .xg-handle-nw { left: -6px; top: -6px; }
    .xg-handle-n  { left: calc(50% - 6px); top: -6px; }
    .xg-handle-ne { right: -6px; top: -6px; }
    .xg-handle-e  { right: -6px; top: calc(50% - 6px); }
    .xg-handle-se { right: -6px; bottom: -6px; }
    .xg-handle-s  { left: calc(50% - 6px); bottom: -6px; }
    .xg-handle-sw { left: -6px; bottom: -6px; }
    .xg-handle-w  { left: -6px; top: calc(50% - 6px); }
    .xg-rotate-stem {
      position: absolute;
      left: 50%;
      top: -26px;
      width: 0;
      height: 26px;
      border-left: 1px solid rgba(255, 255, 255, 0.45);
      display: none;
    }
    .xg-rotate-handle {
      position: absolute;
      left: 50%;
      top: -38px;
      width: 14px;
      height: 14px;
      margin-left: -7px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.62);
      border: 0.5px solid rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(14px) saturate(180%);
      -webkit-backdrop-filter: blur(14px) saturate(180%);
      box-shadow:
        0 1px 5px rgba(0, 0, 0, 0.28),
        inset 0 0 0 0.5px rgba(255, 255, 255, 0.4);
      transition: transform 0.12s ease-out, box-shadow 0.12s ease-out;
      display: none;
    }
    .xg-rotate-handle.xg-hot {
      transform: scale(1.25);
      box-shadow:
        0 0 0 3px rgba(10, 132, 255, 0.28),
        0 2px 8px rgba(0, 0, 0, 0.32);
    }
    .xg-pivot {
      position: absolute;
      width: 9px;
      height: 9px;
      margin: -4.5px 0 0 -4.5px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.55);
      border: 0.5px solid rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px) saturate(180%);
      -webkit-backdrop-filter: blur(10px) saturate(180%);
      box-shadow: 0 0 0 2px rgba(10, 132, 255, 0.35), 0 1px 4px rgba(0,0,0,0.3);
      display: none;
    }
    .xg-pivot::before, .xg-pivot::after {
      content: '';
      position: absolute;
      background: rgba(10, 132, 255, 0.9);
    }
    .xg-pivot::before { left: 50%; top: 2px; bottom: 2px; width: 1px; margin-left: -0.5px; }
    .xg-pivot::after  { top: 50%; left: 2px; right: 2px; height: 1px; margin-top: -0.5px; }
    .xg-axis {
      position: absolute;
      display: none;
      transition: filter 0.12s ease-out;
    }
    .xg-axis.xg-hot { filter: brightness(1.25) drop-shadow(0 0 4px rgba(255,255,255,0.5)); }
    .xg-axis-x {
      left: 50%;
      top: 50%;
      width: 52px;
      height: 3px;
      margin-top: -1.5px;
      border-radius: 2px;
      background: linear-gradient(90deg, rgba(255,105,97,0.35), rgba(255,105,97,0.95));
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
    }
    .xg-axis-x::after {
      content: '';
      position: absolute;
      right: -9px;
      top: 50%;
      transform: translateY(-50%);
      border-left: 9px solid rgba(255,105,97,0.98);
      border-top: 5.5px solid transparent;
      border-bottom: 5.5px solid transparent;
      filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3));
    }
    .xg-axis-y {
      left: 50%;
      top: 50%;
      width: 3px;
      height: 52px;
      margin-left: -1.5px;
      border-radius: 2px;
      transform: translateY(-100%);
      background: linear-gradient(0deg, rgba(48,209,88,0.35), rgba(48,209,88,0.95));
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
    }
    .xg-axis-y::after {
      content: '';
      position: absolute;
      top: -9px;
      left: 50%;
      transform: translateX(-50%);
      border-bottom: 9px solid rgba(48,209,88,0.98);
      border-left: 5.5px solid transparent;
      border-right: 5.5px solid transparent;
      filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3));
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

  // Selection overlay (shown on click/select) with gizmo children:
  // 8 resize handles, rotation lollipop, X/Y axis arrows. Which of them are
  // visible is decided per selection by viewportCapabilities.
  _selectionOverlay = document.createElement('div');
  _selectionOverlay.className = 'xg-selection-overlay';
  _gizmo = { handles: [], handleByName: {}, stem: null, rotate: null, axisX: null, axisY: null, pivot: null, tooltip: null };
  for (const name of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
    const h = document.createElement('div');
    h.className = 'xg-handle xg-handle-' + name;
    _selectionOverlay.appendChild(h);
    _gizmo.handles.push(h);
    _gizmo.handleByName[name] = h;
  }
  _gizmo.pivot = document.createElement('div');
  _gizmo.pivot.className = 'xg-pivot';
  _selectionOverlay.appendChild(_gizmo.pivot);
  _gizmo.tooltip = document.createElement('div');
  _gizmo.tooltip.className = 'xg-tooltip';
  document.body.appendChild(_gizmo.tooltip);
  _gizmo.stem = document.createElement('div');
  _gizmo.stem.className = 'xg-rotate-stem';
  _selectionOverlay.appendChild(_gizmo.stem);
  _gizmo.rotate = document.createElement('div');
  _gizmo.rotate.className = 'xg-rotate-handle';
  _selectionOverlay.appendChild(_gizmo.rotate);
  _gizmo.axisX = document.createElement('div');
  _gizmo.axisX.className = 'xg-axis xg-axis-x';
  _selectionOverlay.appendChild(_gizmo.axisX);
  _gizmo.axisY = document.createElement('div');
  _gizmo.axisY.className = 'xg-axis xg-axis-y';
  _selectionOverlay.appendChild(_gizmo.axisY);
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

  // Fetch what this node can do; gizmo affordances stay hidden until known.
  // A dead response channel must be VISIBLE, not silently gizmo-less — that
  // exact silence hid the webview response-routing bug this watchdog guards.
  _selectedCaps = null;
  _applyGizmoCaps();
  const capsTimer = setTimeout(() => {
    console.warn('[InteractiveEdit] viewportCapabilities: no response from editor — IPC response routing broken?');
    _flashBlocked('editor-link');
  }, 1200);
  makeEditorAPIRequest('viewportCapabilities', {
    nodeId: nodeId,
    kind: 'dom',
    ancestorTransformed: _hasTransformedAncestor(element)
  }, (caps) => {
    clearTimeout(capsTimer);
    if (_selectedNodeId !== nodeId) return; // selection changed meanwhile
    _selectedCaps = caps && !caps.error ? caps : null;
    _applyGizmoCaps();
  });

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
  _clearLivePreview();
  _hideActionTip();
  _setHotZone(null);
  _selectedElement = null;
  _selectedNodeId = null;
  _selectedCaps = null;
  if (_selectionOverlay) {
    _selectionOverlay.style.display = 'none';
    _selectionOverlay.style.transform = '';
  }
  if (_labelBadge) _labelBadge.style.display = 'none';
  if (_sizeBadge) _sizeBadge.style.display = 'none';
}

// Show only the affordances the resolver would accept for this node.
function _applyGizmoCaps() {
  if (!_gizmo) return;
  const caps = _selectedCaps;
  const show = (el, on) => { el.style.display = on ? 'block' : 'none'; };
  for (const h of _gizmo.handles) show(h, !!(caps && caps.resizable));
  show(_gizmo.stem, !!(caps && caps.rotatable));
  show(_gizmo.rotate, !!(caps && caps.rotatable));
  show(_gizmo.axisX, !!(caps && caps.movable));
  show(_gizmo.axisY, !!(caps && caps.movable));
  show(_gizmo.pivot, !!(caps && (caps.rotatable || caps.movable)));
  _positionPivot();
}

// The pivot marks the element's actual transform-origin — the point the
// node rotates and scales around, as the graph has it wired — not just the
// visual center of the box.
function _transformOriginOf(el) {
  const parts = (getComputedStyle(el).transformOrigin || '').split(' ');
  const ox = parseFloat(parts[0]);
  const oy = parseFloat(parts[1]);
  const r = el.getBoundingClientRect();
  return {
    x: isNaN(ox) ? r.width / 2 : ox,
    y: isNaN(oy) ? r.height / 2 : oy
  };
}

function _positionPivot() {
  if (!_gizmo || !_gizmo.pivot || !_selectedElement) return;
  const o = _transformOriginOf(_selectedElement);
  _gizmo.pivot.style.left = o.x + 'px';
  _gizmo.pivot.style.top = o.y + 'px';
}

// --- Action tooltip (glass pill naming the gesture under the cursor) ---
const _TIP_LABELS = {
  rotate: 'Rotate · ⇧ 15°',
  x: 'Move X',
  y: 'Move Y',
  resize: 'Resize · ⇧ ratio',
  move: 'Move'
};

function _showActionTip(kind, x, y) {
  if (!_gizmo || !_gizmo.tooltip) return;
  _gizmo.tooltip.textContent = _TIP_LABELS[kind] || '';
  _gizmo.tooltip.style.left = x + 'px';
  _gizmo.tooltip.style.top = (y - 10) + 'px';
  _gizmo.tooltip.classList.add('xg-tip-on');
}

function _hideActionTip() {
  if (!_gizmo || !_gizmo.tooltip) return;
  _gizmo.tooltip.classList.remove('xg-tip-on');
}

// Highlight the hovered control so the gizmo answers before it is touched.
function _setHotZone(zone) {
  if (!_gizmo) return;
  for (const h of _gizmo.handles) h.classList.remove('xg-hot');
  _gizmo.rotate.classList.remove('xg-hot');
  _gizmo.axisX.classList.remove('xg-hot');
  _gizmo.axisY.classList.remove('xg-hot');
  if (!zone) return;
  if (zone === 'rotate') _gizmo.rotate.classList.add('xg-hot');
  else if (zone === 'x') _gizmo.axisX.classList.add('xg-hot');
  else if (zone === 'y') _gizmo.axisY.classList.add('xg-hot');
  else if (_gizmo.handleByName[zone]) _gizmo.handleByName[zone].classList.add('xg-hot');
}

function _cleanupOverlays() {
  hideHighlight();
  _hideSelection();
  [_hoverOverlay, _selectionOverlay, _labelBadge, _sizeBadge, _gizmo && _gizmo.tooltip].forEach(el => {
    if (el && el.parentNode) el.parentNode.removeChild(el);
  });
  _hoverOverlay = null;
  _selectionOverlay = null;
  _labelBadge = null;
  _sizeBadge = null;
  _gizmo = null;
  const styleEl = document.getElementById('xgenia-selection-styles');
  if (styleEl) styleEl.remove();
}

// --- Live element preview during gestures ---
// The element must move IN TANDEM with the frame (Unity/Figma feel), so we
// preview with inline styles while the gesture runs and let the committed
// params take over on re-render. Inline transform only — layout params are
// never touched mid-gesture.

let _livePreviewInline = null;   // element's own inline styles at gesture start
let _livePreviewApplied = null;  // the exact values WE wrote, per property
let _lastPreviewRect = null;     // where the preview left the element (screen)

function _captureLivePreviewBase() {
  if (!_selectedElement) { _livePreviewBase = ''; _livePreviewInline = null; _livePreviewApplied = null; return; }
  const t = getComputedStyle(_selectedElement).transform;
  _livePreviewBase = (t && t !== 'none') ? t : '';
  // React authors styles inline. We must be able to hand each property back:
  // to React's NEW value when the commit re-rendered it, or to this captured
  // value when React never touched it (or the gesture was blocked).
  const s = _selectedElement.style;
  _livePreviewInline = {
    transform: s.transform,
    width: s.width,
    height: s.height,
    willChange: s.willChange
  };
  _livePreviewApplied = {};
  _lastPreviewRect = null;
}

function _writePreviewStyle(prop, value) {
  _selectedElement.style[prop] = value;
  _livePreviewApplied[prop] = value;
}

// Prepend keeps the delta in screen space even when the element's own
// transform contains rotation (leftmost operation applies outermost).
function _applyLiveMove(dx, dy) {
  if (!_selectedElement || !_livePreviewApplied) return;
  _writePreviewStyle('willChange', 'transform');
  _writePreviewStyle('transform', 'translate(' + dx + 'px, ' + dy + 'px) ' + _livePreviewBase);
  _lastPreviewRect = {
    left: _originalRect.left + dx, top: _originalRect.top + dy,
    width: _originalRect.width, height: _originalRect.height
  };
}

function _applyLiveResize(newRect) {
  if (!_selectedElement || !_livePreviewApplied) return;
  const dx = newRect.left - _originalRect.left;
  const dy = newRect.top - _originalRect.top;
  _writePreviewStyle('willChange', 'transform');
  _writePreviewStyle('width', newRect.width + 'px');
  _writePreviewStyle('height', newRect.height + 'px');
  _writePreviewStyle('transform', 'translate(' + dx + 'px, ' + dy + 'px) ' + _livePreviewBase);
  _lastPreviewRect = { left: newRect.left, top: newRect.top, width: newRect.width, height: newRect.height };
}

function _applyLiveRotate(deltaDeg) {
  if (!_selectedElement || !_livePreviewApplied) return;
  _writePreviewStyle('willChange', 'transform');
  _writePreviewStyle('transform', _livePreviewBase + ' rotate(' + deltaDeg + 'deg)');
  _lastPreviewRect = null; // AABB comparison is meaningless for rotation
}

/**
 * Remove OUR preview values only. A property whose inline value is no longer
 * the one we wrote was re-rendered by React from the committed params — it is
 * newer truth and must be left alone. Restoring the captured pre-gesture
 * value over it is what made elements revert until a manual refresh.
 */
function _clearLivePreview() {
  if (!_selectedElement || !_livePreviewInline || !_livePreviewApplied) {
    _livePreviewInline = null;
    _livePreviewApplied = null;
    return;
  }
  const s = _selectedElement.style;
  for (const prop of ['transform', 'width', 'height', 'willChange']) {
    if (prop in _livePreviewApplied && s[prop] === _livePreviewApplied[prop]) {
      s[prop] = _livePreviewInline[prop];
    }
  }
  _livePreviewInline = null;
  _livePreviewApplied = null;
}

// --- Drag to move ---
let _dragActive = false; // True once movement exceeds threshold
const DRAG_THRESHOLD = 4; // px before drag actually starts

function _startDrag(e) {
  if (!_selectedElement || _isResizing) return;
  _isDragging = true;
  _dragActive = false; // Not active until threshold exceeded
  _dragStart = { x: e.clientX, y: e.clientY };
  _originalRect = _selectedElement.getBoundingClientRect();
  _captureLivePreviewBase();
  _hideActionTip();
  e.preventDefault();
  e.stopPropagation();
}

function _onDrag(e) {
  if (!_isDragging) return;
  const locked = _lockDeltas(e.clientX - _dragStart.x, e.clientY - _dragStart.y, e.shiftKey);
  const dx = locked.dx;
  const dy = locked.dy;

  // Don't activate until threshold exceeded (prevents accidental drag on click)
  if (!_dragActive) {
    if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
    _dragActive = true;
    document.body.style.cursor = 'grabbing';
  }

  // Frame and element move in tandem: overlay repositions, element gets a
  // screen-space translate preview (params untouched until commit).
  const newRect = {
    left: _originalRect.left + dx,
    top: _originalRect.top + dy,
    width: _originalRect.width,
    height: _originalRect.height,
    right: _originalRect.right + dx,
    bottom: _originalRect.bottom + dy,
  };
  _updateSelectionPosition(newRect);
  _applyLiveMove(dx, dy);
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

  if (!wasDragActive) { _dragAxis = null; _clearLivePreview(); return; } // Just a click

  const locked = _lockDeltas(e.clientX - _dragStart.x, e.clientY - _dragStart.y, e.shiftKey);
  _dragAxis = null;

  _sendDomGesture('move', { deltaX: locked.dx, deltaY: locked.dy });
  // Overlay stays at new position — preview will re-render when parameters update
}

// --- Resize (overlay-only — never modifies actual DOM) ---
function _startResize(e, handleName) {
  if (!_selectedElement) return;
  _isResizing = true;
  _resizeHandle = handleName;
  _dragStart = { x: e.clientX, y: e.clientY };
  _originalRect = _selectedElement.getBoundingClientRect();
  _captureLivePreviewBase();
  _hideActionTip();
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

  // Frame and element resize in tandem (inline preview, committed on release)
  const visualRect = {
    left: newL, top: newT,
    width: newW, height: newH,
    right: newL + newW, bottom: newT + newH,
  };
  _updateSelectionPosition(visualRect);
  _applyLiveResize(visualRect);
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
  } else {
    _clearLivePreview();
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
  if (_isRotating) { _onRotate(e); return; }
}

function _globalMouseUp(e) {
  if (_isDragging) { _endDrag(e); return; }
  if (_isResizing) { _endResize(e); return; }
  if (_isRotating) { _endRotate(e); return; }
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
    'no-parent-box': 'No parent box to measure against',
    'unit-mismatch': 'Offset uses % — set a px value first',
    'size-mode-gated': 'Size is content-driven on this node',
    'editor-link': 'Editor link unavailable'
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
  const labels = { move: 'Move element', resize: 'Resize element', rotate: 'Rotate element' };
  const payload = {
    label: labels[gesture] || 'Edit element',
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
    if (blocked) {
      _clearLivePreview(); // snap back — nothing was written
      _flashBlocked(blocked.reason);
    } else {
      _settleAfterCommit();
    }
  });
}

// After a committed gesture: keep the preview up until the committed params
// have OBSERVABLY re-rendered the element, then hand off. A fixed timer here
// raced the model→viewer propagation and caused release-jumps.
function _settleAfterCommit() {
  const nodeId = _selectedNodeId;
  const expected = _lastPreviewRect; // null for rotation
  const baseTransform = _livePreviewBase;
  const startedAt = Date.now();
  const POLL_MS = 120;
  const TIMEOUT_MS = 4000;

  const finish = () => {
    _clearLivePreview();
    _selectionOverlay.style.transform = '';
    const rect = _selectedElement.getBoundingClientRect();
    _updateSelectionPosition(rect);
    _labelBadge.style.left = (rect.left + rect.width / 2) + 'px';
    _labelBadge.style.top = (rect.top - 20) + 'px';
    _labelBadge.style.display = 'block';
    _sizeBadge.textContent = Math.round(rect.width) + ' × ' + Math.round(rect.height);
    _sizeBadge.style.left = (rect.left + rect.width / 2) + 'px';
    _sizeBadge.style.top = (rect.bottom + 4) + 'px';
    makeEditorAPIRequest('viewportCapabilities', {
      nodeId: nodeId,
      kind: 'dom',
      ancestorTransformed: _hasTransformedAncestor(_selectedElement)
    }, (caps) => {
      if (_selectedNodeId !== nodeId) return;
      _selectedCaps = caps && !caps.error ? caps : null;
      _applyGizmoCaps();
    });
  };

  const tick = () => {
    if (_selectedNodeId !== nodeId || !_selectedElement) return; // selection moved on

    // React may have replaced the DOM node on re-render; the fresh node
    // carries only committed styles — adopt it and we are settled.
    const fresh = document.querySelector('[data-xgenia-node-id="' + nodeId + '"]');
    if (fresh && fresh !== _selectedElement) {
      _selectedElement = fresh;
      _livePreviewInline = null;
      _livePreviewApplied = null;
      finish();
      return;
    }

    // Synchronously lift our preview values, measure the underlying truth,
    // and decide — nothing paints between these writes.
    const s = _selectedElement.style;
    const lifted = {};
    if (_livePreviewApplied && _livePreviewInline) {
      for (const prop of ['transform', 'width', 'height']) {
        if (prop in _livePreviewApplied && s[prop] === _livePreviewApplied[prop]) {
          lifted[prop] = _livePreviewApplied[prop];
          s[prop] = _livePreviewInline[prop];
        }
      }
    }
    const r = _selectedElement.getBoundingClientRect();
    const t = getComputedStyle(_selectedElement).transform;
    const converged = expected
      ? (Math.abs(r.left - expected.left) <= 1.5 &&
         Math.abs(r.top - expected.top) <= 1.5 &&
         Math.abs(r.width - expected.width) <= 1.5 &&
         Math.abs(r.height - expected.height) <= 1.5)
      : ((t === 'none' ? '' : t) !== baseTransform); // rotation: transform recomputed

    if (converged) {
      finish();
      return;
    }

    // Not yet — put the preview back before the browser paints.
    for (const prop in lifted) s[prop] = lifted[prop];

    if (Date.now() - startedAt > TIMEOUT_MS) {
      console.warn('[InteractiveEdit] Commit not visible after ' + TIMEOUT_MS + 'ms — releasing preview; check model→viewer sync');
      finish();
      return;
    }
    setTimeout(tick, POLL_MS);
  };

  setTimeout(tick, POLL_MS);
}

// --- Gizmo zone hit-tests (screen space, matching the CSS geometry) ---

const AXIS_LEN = 52;
function _selectionCenter() {
  const r = _selectedElement.getBoundingClientRect();
  return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, rect: r };
}

function _isOnRotateHandle(x, y) {
  if (!_selectedElement || !(_selectedCaps && _selectedCaps.rotatable)) return false;
  const r = _selectedElement.getBoundingClientRect();
  const hx = r.left + r.width / 2;
  const hy = r.top - 31; // lollipop circle center (top: -38px, 14px tall)
  return Math.hypot(x - hx, y - hy) <= 10;
}

function _axisArrowAtPoint(x, y) {
  if (!_selectedElement || !(_selectedCaps && _selectedCaps.movable)) return null;
  const { cx, cy } = _selectionCenter();
  if (x >= cx + 6 && x <= cx + AXIS_LEN + 12 && Math.abs(y - cy) <= 7) return 'x';
  if (y <= cy - 6 && y >= cy - AXIS_LEN - 12 && Math.abs(x - cx) <= 7) return 'y';
  return null;
}

// Constrain a free/axis drag: explicit arrow lock wins, else Shift locks
// to the dominant axis (standard professional-editor behavior).
function _lockDeltas(dx, dy, shiftKey) {
  if (_dragAxis === 'x') return { dx, dy: 0 };
  if (_dragAxis === 'y') return { dx: 0, dy };
  if (shiftKey) {
    return Math.abs(dx) >= Math.abs(dy) ? { dx, dy: 0 } : { dx: 0, dy };
  }
  return { dx, dy };
}

// Pixi gizmo hover events reuse the same glass tooltip as the DOM gizmo.
window.addEventListener('xg-gizmo-hover', (e) => {
  if (!_gizmo || !_gizmo.tooltip || !e.detail) return;
  const z = e.detail.zone;
  if (!z) { _hideActionTip(); return; }
  const kind = (z === 'rotate') ? 'rotate' : (z === 'x' || z === 'y') ? z : 'resize';
  _showActionTip(kind, e.detail.clientX, e.detail.clientY);
});

// --- Rotation gesture (overlay-only preview; commits transformRotation) ---

let _rotatePivot = null; // screen-space pivot; the element's transform-origin

function _startRotate(e) {
  if (!_selectedElement) return;
  _isRotating = true;
  _rotateDeltaDeg = 0;
  _originalRect = _selectedElement.getBoundingClientRect();
  _captureLivePreviewBase();
  // Rotate around the node's wired transform-origin, not the box center.
  const o = _transformOriginOf(_selectedElement);
  _rotatePivot = { x: _originalRect.left + o.x, y: _originalRect.top + o.y };
  _selectionOverlay.style.transformOrigin = o.x + 'px ' + o.y + 'px';
  _rotateStartAngle = Math.atan2(e.clientY - _rotatePivot.y, e.clientX - _rotatePivot.x);
  document.body.style.cursor = 'grabbing';
  _hideActionTip();
  if (_labelBadge) _labelBadge.style.display = 'none';
  e.preventDefault();
  e.stopPropagation();
}

function _onRotate(e) {
  if (!_isRotating || !_selectedElement) return;
  const cx = _rotatePivot.x;
  const cy = _rotatePivot.y;
  const angle = Math.atan2(e.clientY - cy, e.clientX - cx);
  let deltaDeg = (angle - _rotateStartAngle) * 180 / Math.PI;
  if (e.shiftKey) deltaDeg = Math.round(deltaDeg / 15) * 15; // snap to 15°
  _rotateDeltaDeg = deltaDeg;

  // Frame and element rotate in tandem (inline preview, committed on release)
  _selectionOverlay.style.transform = 'rotate(' + deltaDeg + 'deg)';
  _applyLiveRotate(deltaDeg);
  _sizeBadge.textContent = Math.round(deltaDeg) + '°';
  _sizeBadge.style.left = (cx) + 'px';
  _sizeBadge.style.top = (_originalRect.bottom + 4) + 'px';
  _sizeBadge.style.display = 'block';
}

function _endRotate(e) {
  if (!_isRotating) return;
  _isRotating = false;
  document.body.style.cursor = 'crosshair';
  const deltaDeg = Math.round(_rotateDeltaDeg * 10) / 10;
  _selectionOverlay.style.transform = '';
  _selectionOverlay.style.transformOrigin = '';
  if (_labelBadge) _labelBadge.style.display = 'block';
  if (Math.abs(deltaDeg) >= 0.5) {
    _sendDomGesture('rotate', { deltaDeg: deltaDeg });
  } else {
    _clearLivePreview();
  }
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
        // Skip if a gesture is in progress (those run via _globalMouseMove)
        if (_isDragging || _isResizing || _isRotating) return;

        // Gizmo cursors, hot states and action tooltips around the selection.
        // Every control answers on hover: what it does, before it is touched.
        if (_selectedElement) {
          const axis = _axisArrowAtPoint(e.clientX, e.clientY);
          const handle = (_selectedCaps && _selectedCaps.resizable)
            ? _handleAtPoint(e.clientX, e.clientY) : null;
          if (_isOnRotateHandle(e.clientX, e.clientY)) {
            document.body.style.cursor = 'grab';
            _setHotZone('rotate');
            _showActionTip('rotate', e.clientX, e.clientY);
          } else if (axis) {
            document.body.style.cursor = axis === 'x' ? 'ew-resize' : 'ns-resize';
            _setHotZone(axis);
            _showActionTip(axis, e.clientX, e.clientY);
          } else if (handle) {
            document.body.style.cursor = handle + '-resize';
            _setHotZone(handle);
            _showActionTip('resize', e.clientX, e.clientY);
          } else if (_isInsideSelection(e.clientX, e.clientY)) {
            document.body.style.cursor = (_selectedCaps && _selectedCaps.movable) ? 'move' : 'crosshair';
            _setHotZone(null);
            if (_selectedCaps && _selectedCaps.movable) {
              _showActionTip('move', e.clientX, e.clientY);
            } else {
              _hideActionTip();
            }
          } else {
            document.body.style.cursor = 'crosshair';
            _setHotZone(null);
            _hideActionTip();
          }
        }

        const element = document.elementFromPoint(e.clientX, e.clientY);
        if (!element) return;

        // Skip our own overlay elements
        if (element.closest('.xg-hover-overlay, .xg-selection-overlay, .xg-label-badge, .xg-size-badge, .xg-tooltip')) return;

        // No pre-selection highlight: selection chrome appears on click only.
        // The editor is still told what is under the cursor.
        const xgeniaNode = findXgeniaNodeForElement(element);
        if (xgeniaNode && !(_selectedElement && element === _selectedElement)) {
          ipcRenderer.sendToHost('inspector-node-found', {
            nodeId: xgeniaNode,
            elementInfo: {
              tagName: element.tagName,
              className: element.className,
              id: element.id
            }
          });
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

      // --- Double-click: send the node as a reference to the chat panel ---
      const dblclickHandler = (e) => {
        const element = document.elementFromPoint(e.clientX, e.clientY);
        if (!element) return;
        if (element.closest('.xg-hover-overlay, .xg-selection-overlay, .xg-label-badge, .xg-size-badge, .xg-tooltip')) return;
        const nodeId = findXgeniaNodeForElement(element);
        if (!nodeId) return;
        e.preventDefault();
        e.stopPropagation();
        let nodeLabel = element.getAttribute('data-xgenia-node-label') ||
          element.getAttribute('data-node-label') || 'Element';
        ipcRenderer.sendToHost('inspector-node-dblclick', { nodeId: nodeId, nodeLabel: nodeLabel });
      };

      // --- Mousedown handler: entry point for rotate, axis-move, edge-resize
      // and free drag. Affordances are capability-gated (viewportCapabilities)
      // so nothing is offered that the resolver would refuse; the resolver
      // still fails closed if state changed between fetch and gesture.
      const mousedownHandler = (e) => {
        if (e.button !== 0) return;
        if (_isOnRotateHandle(e.clientX, e.clientY)) {
          _startRotate(e);
          return;
        }
        const axis = _axisArrowAtPoint(e.clientX, e.clientY);
        if (axis) {
          _startDrag(e);
          _dragAxis = axis;
          return;
        }
        if (_selectedCaps && _selectedCaps.resizable) {
          const handle = _handleAtPoint(e.clientX, e.clientY);
          if (handle) {
            _startResize(e, handle);
            return;
          }
        }
        if (_isInsideSelection(e.clientX, e.clientY)) {
          if (_selectedCaps && _selectedCaps.movable) {
            _startDrag(e);
            _dragAxis = null;
          } else if (_selectedCaps && _selectedCaps.moveReason) {
            _flashBlocked(_selectedCaps.moveReason);
          }
        }
        // Otherwise fall through: clickHandler does selection/deselection.
      };

      // Attach all listeners
      document.addEventListener('mousemove', mouseMoveHandler, true);
      document.addEventListener('click', clickHandler, true);
      document.addEventListener('dblclick', dblclickHandler, true);
      document.addEventListener('mousedown', mousedownHandler, true);
      document.addEventListener('mousemove', _globalMouseMove, true);
      document.addEventListener('mouseup', _globalMouseUp, true);

      // No separate handle listeners needed — mousedownHandler handles resize

      // Store handlers for cleanup
      window._inspectorMouseHandler = mouseMoveHandler;
      window._inspectorClickHandler = clickHandler;
      window._inspectorDblclickHandler = dblclickHandler;
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
      if (window._inspectorDblclickHandler) {
        document.removeEventListener('dblclick', window._inspectorDblclickHandler, true);
        window._inspectorDblclickHandler = null;
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
