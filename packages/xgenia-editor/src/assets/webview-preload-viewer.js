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

// The editor overlay keeps real time even while the preview's clock is paused or slowed
// (_installPreviewClock patches the page's clock functions).
const _realDateNow = Date.now.bind(Date);
const _realPerfNow = performance.now.bind(performance);
const _realRAF = window.requestAnimationFrame.bind(window);
const _realCAF = window.cancelAnimationFrame.bind(window);
const _now = () => _realDateNow();

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

/** Everything the editor draws over the game. Never a pick target. */
const _CHROME_SELECTOR = '.xg-hover-overlay, .xg-selection-overlay, .xg-label-badge, .xg-size-badge, .xg-tooltip, ' +
  '.xg-context-menu, .xg-multi-outline, .xg-marquee, .xg-guide, .xg-align-bar, .xg-anchor-pop, .xg-reorder-line, .xg-safe-area';

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
let _gestureScale = null;       // { ax, ay, ox, oy } screen px per local px at gesture start
let _settling = false;          // A commit is on its way back from the model
let _lastHoverNodeId = null;    // Last node reported under the pointer (dedupes hover IPC)

// --- Coordinate spaces ---
// Measured in this Electron (Chromium 126) with the editor's preview zoom on the document
// element: mouse clientX/clientY and elementFromPoint speak WINDOW pixels, while
// getBoundingClientRect — and the left/top of our position:fixed chrome — speak the page's
// UNZOOMED CSS pixels. Every comparison of the pointer against a rect goes through _pt;
// without it, at zoom 2 the handles sat where the pointer was not and a drag moved the
// element twice as far as the cursor.
function _docZoom() {
  const z = parseFloat(document.documentElement && document.documentElement.style.zoom);
  return z > 0 && isFinite(z) ? z : 1;
}

function _pt(e) {
  const z = _docZoom();
  return { x: e.clientX / z, y: e.clientY / z };
}

// The editor scales this whole frame (fit-to-panel, the zoom menu, wheel zoom), and our chrome
// lives inside it. _uiK is how many page px make one screen px: chrome sizes, offsets and grab
// zones are multiplied by it so handles and bars stay the same size on screen at any zoom, as
// in Figma or Unity. The CSS reads it as --xg-k. The host pushes the scale (setFrameScale).
let _uiK = 1;
function _screenPx(n) {
  return n * _uiK / _docZoom();
}

// Centre a translateX(-50%) chrome element on cx without letting it leave the preview: a bar
// over an element at the edge was cut off, and squeezed until its labels wrapped.
function _placeCentredChrome(el, cx, top) {
  const w = el.offsetWidth * _uiK;
  const vw = window.innerWidth / _docZoom();
  const m = 4 * _uiK;
  const left = w + 2 * m >= vw ? vw / 2 : Math.min(Math.max(cx, m + w / 2), vw - m - w / 2);
  el.style.left = left + 'px';
  el.style.top = top + 'px';
}

// How an element's ancestors map its local CSS pixels onto rect pixels. A scale — the slot
// design canvas's uiScale, a Scale param on a parent — is a clean per-axis factor a gesture
// divides out. A rotation or skew is not, and still fails closed.
function _ancestorScale(el) {
  let sx = 1, sy = 1, blocked = false;
  for (let cur = el && el.parentElement; cur && cur !== document.documentElement; cur = cur.parentElement) {
    const t = getComputedStyle(cur).transform;
    if (!t || t === 'none') continue;
    let m;
    try { m = new DOMMatrixReadOnly(t); } catch (err) { blocked = true; break; }
    if (!m.is2D || Math.abs(m.b) > 1e-6 || Math.abs(m.c) > 1e-6) { blocked = true; break; }
    sx *= m.a;
    sy *= m.d;
  }
  if (!(Math.abs(sx) > 1e-6) || !(Math.abs(sy) > 1e-6)) blocked = true;
  return { sx, sy, blocked };
}

// The element's own scale (its Scale param), which multiplies its box but not its offset:
// the viewer composes translate → rotate → scale, so the offset lives in the parent's space.
function _ownScale(el) {
  const t = getComputedStyle(el).transform;
  if (!t || t === 'none') return { sx: 1, sy: 1 };
  try {
    const m = new DOMMatrixReadOnly(t);
    return { sx: Math.hypot(m.a, m.b) || 1, sy: Math.hypot(m.c, m.d) || 1 };
  } catch (err) {
    return { sx: 1, sy: 1 };
  }
}

function _scalesOf(el) {
  const a = _ancestorScale(el);
  const o = _ownScale(el);
  return { ax: a.blocked ? 1 : a.sx, ay: a.blocked ? 1 : a.sy, ox: o.sx, oy: o.sy };
}

/** An element's box in its own CSS pixels — what the Width/Height params mean. */
function _localSizeOf(el, rect) {
  const g = _scalesOf(el);
  const r = rect || el.getBoundingClientRect();
  return { width: r.width / Math.abs(g.ax * g.ox), height: r.height / Math.abs(g.ay * g.oy) };
}


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
      border: calc(1px * var(--xg-k, 1)) solid rgba(255, 255, 255, 0.85);
      border-radius: calc(3px * var(--xg-k, 1));
      box-shadow:
        0 0 0 calc(1px * var(--xg-k, 1)) rgba(10, 132, 255, 0.65),
        0 0 0 calc(4px * var(--xg-k, 1)) rgba(10, 132, 255, 0.10),
        0 calc(10px * var(--xg-k, 1)) calc(28px * var(--xg-k, 1)) rgba(0, 0, 0, 0.20);
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
      transform-origin: 0 0;
      transform: scale(var(--xg-k, 1)) translateX(-50%);
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
      transform-origin: 0 0;
      transform: scale(var(--xg-k, 1)) translateX(-50%);
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
      transform-origin: 0 0;
      transform: scale(var(--xg-k, 1)) translate(-50%, -135%);
      opacity: 0;
      transition: opacity 0.12s ease-out;
    }
    .xg-tooltip.xg-tip-on { opacity: 1; }
    .xg-context-menu {
      position: fixed;
      z-index: 1000002;
      transform-origin: 0 0;
      transform: scale(var(--xg-k, 1));
      min-width: 220px;
      max-width: 320px;
      padding: 5px;
      border-radius: 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif;
      font-size: 12px;
      color: rgba(255,255,255,0.92);
      background: rgba(28, 28, 30, 0.74);
      border: 0.5px solid rgba(255, 255, 255, 0.16);
      backdrop-filter: blur(24px) saturate(180%);
      -webkit-backdrop-filter: blur(24px) saturate(180%);
      box-shadow: 0 12px 34px rgba(0,0,0,0.38);
      user-select: none;
    }
    .xg-cm-section {
      padding: 6px 9px 3px;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.4px;
      text-transform: uppercase;
      color: rgba(255,255,255,0.45);
    }
    .xg-cm-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 9px;
      border-radius: 7px;
      cursor: default;
      white-space: nowrap;
    }
    .xg-cm-row:hover, .xg-cm-row.xg-cm-active { background: rgba(10, 132, 255, 0.85); color: #fff; }
    .xg-sheet .xg-cm-row:hover { background: none; color: inherit; }
    .xg-cm-row:hover .xg-cm-meta, .xg-cm-row.xg-cm-active .xg-cm-meta { color: rgba(255,255,255,0.8); }
    .xg-cm-label { overflow: hidden; text-overflow: ellipsis; flex: 1; }
    .xg-cm-meta { font-size: 10px; color: rgba(255,255,255,0.45); }
    .xg-cm-sep { height: 0.5px; margin: 4px 6px; background: rgba(255,255,255,0.12); }
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
      transform: scale(var(--xg-k, 1));
      display: none;
    }
    .xg-handle.xg-hot {
      transform: scale(calc(1.3 * var(--xg-k, 1)));
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
      top: calc(-26px * var(--xg-k, 1));
      width: 0;
      height: calc(26px * var(--xg-k, 1));
      border-left: calc(1px * var(--xg-k, 1)) solid rgba(255, 255, 255, 0.45);
      display: none;
    }
    .xg-rotate-handle {
      position: absolute;
      left: 50%;
      top: calc(-31px * var(--xg-k, 1) - 7px);
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
      transform: scale(var(--xg-k, 1));
      display: none;
    }
    .xg-rotate-handle.xg-hot {
      transform: scale(calc(1.25 * var(--xg-k, 1)));
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
      transform: scale(var(--xg-k, 1));
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
    .xg-multi-outline {
      position: fixed;
      pointer-events: none;
      z-index: 999998;
      border: calc(1px * var(--xg-k, 1)) solid rgba(10, 132, 255, 0.9);
      border-radius: 2px;
      box-shadow: 0 0 0 calc(1px * var(--xg-k, 1)) rgba(255, 255, 255, 0.35);
    }
    .xg-selection-overlay.xg-group { border-style: dashed; }
    .xg-marquee {
      position: fixed;
      pointer-events: none;
      z-index: 1000003;
      border: calc(1px * var(--xg-k, 1)) solid rgba(10, 132, 255, 0.95);
      background: rgba(10, 132, 255, 0.12);
      border-radius: 2px;
    }
    .xg-guide {
      position: fixed;
      pointer-events: none;
      z-index: 1000004;
      background: rgba(255, 55, 135, 0.95);
    }
    .xg-rezoom .xg-handle, .xg-rezoom .xg-rotate-handle { transition: none !important; }
    .xg-narrow .xg-handle-n, .xg-narrow .xg-handle-s, .xg-short .xg-handle-e, .xg-short .xg-handle-w { display: none !important; }
    .xg-guide-v { width: calc(1px * var(--xg-k, 1)); }
    .xg-guide-h { height: calc(1px * var(--xg-k, 1)); }
    .xg-gap::after {
      content: attr(data-gap);
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%) scale(var(--xg-k, 1));
      font: 600 10px/14px -apple-system, BlinkMacSystemFont, sans-serif;
      color: #fff;
      background: rgba(255, 55, 135, 0.95);
      border-radius: 3px;
      padding: 0 4px;
    }
    .xg-align-bar {
      position: fixed;
      z-index: 1000002;
      display: none;
      gap: 2px;
      padding: 4px;
      border-radius: 10px;
      background: rgba(28, 28, 30, 0.74);
      border: 0.5px solid rgba(255, 255, 255, 0.16);
      backdrop-filter: blur(24px) saturate(180%);
      -webkit-backdrop-filter: blur(24px) saturate(180%);
      box-shadow: 0 8px 24px rgba(0,0,0,0.32);
      transform-origin: 0 0;
      transform: scale(var(--xg-k, 1)) translateX(-50%);
      user-select: none;
    }
    .xg-align-bar.xg-on { display: flex; }
    .xg-align-btn {
      width: 26px;
      height: 26px;
      border-radius: 7px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: rgba(255,255,255,0.85);
      cursor: default;
    }
    .xg-align-btn:hover { background: rgba(10, 132, 255, 0.85); color: #fff; }
    .xg-align-btn.xg-off { opacity: 0.3; pointer-events: none; }
    .xg-align-sep { width: 0.5px; margin: 4px 3px; background: rgba(255,255,255,0.18); }
    .xg-align-btn.xg-text { width: auto; padding: 0 8px; white-space: nowrap; font: 500 11px -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif; }
    .xg-anchor-pop {
      position: fixed;
      z-index: 1000003;
      display: none;
      grid-template-columns: repeat(3, 22px);
      gap: 4px;
      padding: 8px;
      border-radius: 10px;
      background: rgba(28, 28, 30, 0.82);
      border: 0.5px solid rgba(255, 255, 255, 0.16);
      backdrop-filter: blur(24px) saturate(180%);
      -webkit-backdrop-filter: blur(24px) saturate(180%);
      box-shadow: 0 8px 24px rgba(0,0,0,0.32);
      transform-origin: 0 0;
      transform: scale(var(--xg-k, 1)) translateX(-50%);
    }
    .xg-anchor-pop.xg-on { display: grid; }
    .xg-anchor-cell {
      width: 22px; height: 22px; border-radius: 6px;
      display: flex; align-items: center; justify-content: center;
      background: rgba(255,255,255,0.06);
    }
    .xg-anchor-cell::after { content: ''; width: 6px; height: 6px; border-radius: 50%; background: rgba(255,255,255,0.55); }
    .xg-anchor-cell:hover { background: rgba(10, 132, 255, 0.55); }
    .xg-anchor-cell.xg-current { background: rgba(10, 132, 255, 0.9); }
    .xg-anchor-cell.xg-current::after { background: #fff; }
    .xg-reorder-line {
      position: fixed;
      pointer-events: none;
      z-index: 1000004;
      background: rgba(10, 132, 255, 0.95);
      border-radius: 2px;
      box-shadow: 0 0 0 1px rgba(255,255,255,0.5);
    }
    .xg-axis-x {
      left: 50%;
      top: 50%;
      transform-origin: 0 50%;
      transform: scale(var(--xg-k, 1));
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
      transform-origin: 50% 0;
      transform: scale(var(--xg-k, 1)) translateY(-100%);
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
  _clearLivePreview(); // a preview left on the previous element (settle cut short) goes with it
  _settling = false;
  _clearExtras();
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

  _primaryLabel = nodeLabel || nodeId || 'Element';
  _labelBadge.textContent = _primaryLabel;
  _labelBadge.style.display = 'block';
  _sizeBadge.style.display = 'block';
  _placeBadges(rect);

  // Show selection border
  _selectionOverlay.style.display = 'block';

  // Hide hover overlay while selected
  _hoverOverlay.style.display = 'none';

  _trackedRect = null;
  _startSelectionTracking();
}

// Label centred above the frame, size centred below it. The size is the element's own CSS
// pixels — the numbers the inspector shows — not screen pixels, which differ under a scaled
// design canvas or the preview zoom.
function _placeBadges(rect, sizeText) {
  if (!_labelBadge || !_sizeBadge) return;
  const cx = rect.left + rect.width / 2;
  _placeCentredChrome(_labelBadge, cx, rect.top - 20 * _uiK);
  if (sizeText === undefined && _selectedElement) {
    const local = _localSizeOf(_selectedElement, rect);
    sizeText = Math.round(local.width) + ' × ' + Math.round(local.height);
  }
  if (sizeText !== undefined) _sizeBadge.textContent = sizeText;
  _placeCentredChrome(_sizeBadge, cx, rect.bottom + 4 * _uiK);
}

// --- Selection tracking ---
// The frame follows its element: after Undo, after an animation, after the AI moves it.
// It used to stay where the last gesture left it until the next click.
let _trackRaf = 0;
let _trackedRect = null;

function _startSelectionTracking() {
  if (_trackRaf) return;
  const loop = () => {
    _trackRaf = _realRAF(loop);
    _trackSelection();
  };
  _trackRaf = _realRAF(loop);
}

function _stopSelectionTracking() {
  if (_trackRaf) _realCAF(_trackRaf);
  _trackRaf = 0;
  _trackedRect = null;
}

function _trackSelection() {
  if (!_selectedNodeId || !_selectionOverlay || _isDragging || _isResizing || _isRotating || _settling) return;
  let el = _selectedElement;
  if (!el || !el.isConnected) {
    // React replaced the node on re-render, or it was deleted.
    el = document.querySelector('[data-xgenia-node-id="' + _selectedNodeId + '"]');
    if (!el) { _hideSelection(); return; }
    _selectedElement = el;
  }
  if (_isMulti()) _refreshExtraElements();
  const r = _selectionRect();
  if (_isMulti()) _placeMemberOutlines();
  const t = _trackedRect;
  if (t && t.left === r.left && t.top === r.top && t.width === r.width && t.height === r.height) return;
  _trackedRect = { left: r.left, top: r.top, width: r.width, height: r.height };
  _updateSelectionPosition(r);
  if (_isMulti()) {
    _placeBadges(r, '');
    _placeAlignBar(r);
  } else {
    _placeBadges(r);
    _placeSingleBar(r);
  }
  _positionPivot();
}

// --- Multi-selection ---
// Shift-click adds or removes a node, a box drag selects every node inside it. The frame then
// spans the group: dragging it moves every member in one undo entry, and the align bar lines
// them up. Resize and rotate stay single-node — they mean nothing for a set of boxes.
let _extras = [];        // [{ nodeId, el, caps }] selected alongside the primary
let _memberOutlines = []; // one outline per member while more than one is selected
let _primaryLabel = '';
let _ignoreEditorSelectionUntil = 0;

function _isMulti() {
  return _extras.length > 0 && !!_selectedElement;
}

function _members() {
  const out = [];
  if (_selectedElement && _selectedNodeId) out.push({ nodeId: _selectedNodeId, el: _selectedElement, caps: _selectedCaps });
  for (const x of _extras) out.push(x);
  return out;
}

function _unionRect(rects) {
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  for (const x of rects) {
    if (!x) continue;
    l = Math.min(l, x.left); t = Math.min(t, x.top);
    r = Math.max(r, x.left + x.width); b = Math.max(b, x.top + x.height);
  }
  if (l === Infinity) return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
  return { left: l, top: t, width: r - l, height: b - t, right: r, bottom: b };
}

/** The box the frame and gizmo act on: the node, or the whole group. */
function _selectionRect() {
  if (!_selectedElement) return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
  if (!_isMulti()) return _selectedElement.getBoundingClientRect();
  return _unionRect(_members().map((m) => m.el.getBoundingClientRect()));
}

/** What the gizmo may offer: the node's own answer, or, for a group, moving if all can move. */
function _effectiveCaps() {
  if (!_isMulti()) return _selectedCaps;
  const all = _members().map((m) => m.caps);
  const movable = all.every((c) => c && c.movable);
  const blocker = all.find((c) => c && !c.movable);
  return { movable, resizable: false, rotatable: false, moveReason: movable ? undefined : (blocker && blocker.moveReason) || 'in-flow' };
}

function _refreshExtraElements() {
  _extras = _extras.filter((x) => {
    if (x.el && x.el.isConnected) return true;
    const el = document.querySelector('[data-xgenia-node-id="' + x.nodeId + '"]');
    if (!el) return false;
    x.el = el;
    return true;
  });
}

function _placeMemberOutlines() {
  const members = _members();
  while (_memberOutlines.length < members.length) {
    const o = document.createElement('div');
    o.className = 'xg-multi-outline';
    document.body.appendChild(o);
    _memberOutlines.push(o);
  }
  while (_memberOutlines.length > members.length) {
    const o = _memberOutlines.pop();
    if (o.parentNode) o.parentNode.removeChild(o);
  }
  members.forEach((m, i) => {
    const r = m.el.getBoundingClientRect();
    const o = _memberOutlines[i];
    o.style.left = r.left + 'px';
    o.style.top = r.top + 'px';
    o.style.width = r.width + 'px';
    o.style.height = r.height + 'px';
  });
}

function _fetchCaps(member) {
  makeEditorAPIRequest('viewportCapabilities', {
    nodeId: member.nodeId,
    kind: 'dom',
    ancestorTransformed: _hasTransformedAncestor(member.el)
  }, (caps) => {
    member.caps = caps && !caps.error ? caps : null;
    _applyGizmoCaps();
  });
}

/** Redraw the frame, badges, outlines and align bar for the current membership. */
function _refreshSelectionChrome() {
  if (!_selectionOverlay) return;
  const multi = _isMulti();
  _selectionOverlay.classList.toggle('xg-group', multi);
  if (_labelBadge) _labelBadge.textContent = multi ? (_extras.length + 1) + ' selected' : _primaryLabel;
  if (!multi) {
    for (const o of _memberOutlines) if (o.parentNode) o.parentNode.removeChild(o);
    _memberOutlines = [];
    _hideAlignBar();
  } else {
    _showAlignBar();
    _hideSingleBar();
  }
  _applyGizmoCaps();
  _trackedRect = null;
  _trackSelection();
}

function _toggleMember(nodeId, el) {
  if (!_selectedNodeId) return false;
  if (nodeId === _selectedNodeId) {
    if (!_extras.length) return false;
    const next = _extras.shift();
    _selectedNodeId = next.nodeId;
    _selectedElement = next.el;
    _selectedCaps = next.caps;
    _primaryLabel = next.el.getAttribute('data-xgenia-node-label') || next.nodeId;
  } else {
    const i = _extras.findIndex((x) => x.nodeId === nodeId);
    if (i >= 0) {
      _extras.splice(i, 1);
    } else {
      const member = { nodeId, el, caps: null };
      _extras.push(member);
      _fetchCaps(member);
    }
  }
  _refreshSelectionChrome();
  return true;
}

function _clearExtras() {
  _extras = [];
  for (const o of _memberOutlines) if (o.parentNode) o.parentNode.removeChild(o);
  _memberOutlines = [];
  _hideAlignBar();
  if (_selectionOverlay) _selectionOverlay.classList.remove('xg-group');
}

/** Tell the editor which nodes are selected, so Delete, Copy and Duplicate act on all of them. */
function _syncSelectionToEditor() {
  const ids = _members().map((m) => m.nodeId);
  if (!ids.length) return;
  _ignoreEditorSelectionUntil = _now() + 800;
  makeEditorAPIRequest(ids.length > 1 ? 'selectNodes' : 'inspectNodes', { nodeIds: ids }, () => { });
}

/** Replace the selection with these nodes (box select). */
function _selectMany(entries) {
  if (!entries.length) return;
  _clearExtras();
  const first = entries[0];
  _showSelection(first.el, first.nodeId, first.el.getAttribute('data-xgenia-node-label') || first.nodeId);
  for (const e of entries.slice(1)) {
    const member = { nodeId: e.nodeId, el: e.el, caps: null };
    _extras.push(member);
    _fetchCaps(member);
  }
  _refreshSelectionChrome();
  _syncSelectionToEditor();
}

// --- Single-selection bar: anchor, arrange, ask the AI ---
// Unity keeps these in the RectTransform inspector; here they sit on the selection, where the
// eye already is. Anchor presets keep the node where it is on screen: the new anchor is
// committed, the jump it causes is measured, and a compensating move joins the same undo entry.
let _singleBar = null;
let _anchorPop = null;
const _SINGLE_ICONS = {
  anchor: '<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><circle cx="8" cy="8" r="1.6" fill="currentColor"/><path d="M8 2.5v3M8 10.5v3M2.5 8h3M10.5 8h3"/>',
  front: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.2" fill="currentColor" fill-opacity="0.35"/><rect x="2.5" y="2.5" width="8" height="8" rx="1.2"/>',
  back: '<rect x="2.5" y="2.5" width="8" height="8" rx="1.2" fill="currentColor" fill-opacity="0.35"/><rect x="5.5" y="5.5" width="8" height="8" rx="1.2"/>'
};

function _barButton(act, title, icon, text) {
  const b = document.createElement('div');
  b.className = 'xg-align-btn' + (text ? ' xg-text' : '');
  b.setAttribute('data-act', act);
  b.title = title;
  b.innerHTML = text || ('<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2">' + icon + '</svg>');
  return b;
}

function _ensureSingleBar() {
  if (_singleBar) return _singleBar;
  _injectSelectionStyles();
  const bar = document.createElement('div');
  bar.className = 'xg-align-bar xg-sel-bar';
  bar.appendChild(_barButton('anchor', 'Anchor preset (keeps position)', _SINGLE_ICONS.anchor));
  const sep = document.createElement('div');
  sep.className = 'xg-align-sep';
  bar.appendChild(sep);
  bar.appendChild(_barButton('front', 'Bring to front', _SINGLE_ICONS.front));
  bar.appendChild(_barButton('back', 'Send to back', _SINGLE_ICONS.back));
  const sep2 = document.createElement('div');
  sep2.className = 'xg-align-sep';
  bar.appendChild(sep2);
  bar.appendChild(_barButton('ai', 'Add the selection to the AI chat', '', 'Ask AI'));
  document.body.appendChild(bar);
  _singleBar = bar;

  const pop = document.createElement('div');
  pop.className = 'xg-anchor-pop';
  for (const y of ['top', 'center', 'bottom']) {
    for (const x of ['left', 'center', 'right']) {
      const c = document.createElement('div');
      c.className = 'xg-anchor-cell';
      c.setAttribute('data-anchor', x + ' ' + y);
      c.title = (y === 'center' && x === 'center') ? 'Centre' : (y === 'center' ? '' : y + ' ') + (x === 'center' ? (y === 'center' ? '' : 'centre') : x);
      pop.appendChild(c);
    }
  }
  document.body.appendChild(pop);
  _anchorPop = pop;
  return bar;
}

/** Show the bar for one selected DOM node; hidden for groups, gestures and bridge sprites. */
function _updateSingleBar() {
  if (!_selectedElement || _isMulti() || !_inspectorEnabled) { _hideSingleBar(); return; }
  const bar = _ensureSingleBar();
  const caps = _selectedCaps;
  const free = !!(caps && caps.movable);
  bar.querySelector('[data-act="anchor"]').classList.toggle('xg-off', !free);
  bar.classList.add('xg-on');
  _placeSingleBar(_selectionRect());
}

function _hideSingleBar() {
  if (_singleBar) _singleBar.classList.remove('xg-on');
  if (_anchorPop) _anchorPop.classList.remove('xg-on');
}

function _placeSingleBar(rect) {
  if (!_singleBar || !_singleBar.classList.contains('xg-on')) return;
  _placeCentredChrome(_singleBar, rect.left + rect.width / 2, Math.max(4 * _uiK, rect.top - 74 * _uiK));
  if (_anchorPop && _anchorPop.classList.contains('xg-on')) {
    const b = _singleBar.getBoundingClientRect();
    _placeCentredChrome(_anchorPop, b.left + 18 * _uiK, Math.max(4 * _uiK, b.top - 96 * _uiK));
  }
}

function _toggleAnchorPop() {
  if (!_anchorPop) return;
  const on = !_anchorPop.classList.contains('xg-on');
  _anchorPop.classList.toggle('xg-on', on);
  if (on) {
    const a = (_selectedCaps && _selectedCaps.align) || { x: 'left', y: 'top' };
    for (const c of _anchorPop.querySelectorAll('[data-anchor]')) {
      c.classList.toggle('xg-current', c.getAttribute('data-anchor') === a.x + ' ' + a.y);
    }
    _placeSingleBar(_selectionRect());
  }
}

function _applyAnchor(spec) {
  if (!_selectedElement || !_selectedNodeId) return;
  const [ax, ay] = spec.split(' ');
  _anchorPop.classList.remove('xg-on');
  _originalRect = _selectedElement.getBoundingClientRect();
  _gestureScale = _scalesOf(_selectedElement);
  _captureLivePreviewBase();
  const parent = _selectedElement.parentElement ? _selectedElement.parentElement.getBoundingClientRect() : null;
  _sendDomGesture('anchor', { alignX: ax, alignY: ay }, {
    label: 'Set anchor',
    expect: { left: _originalRect.left, top: _originalRect.top, width: _originalRect.width, height: _originalRect.height },
    maxGap: parent ? { x: parent.width + 2, y: parent.height + 2 } : null
  });
}

/** Paint order among freely placed siblings follows child order: front = last child. */
function _arrange(nodeId, toEnd) {
  makeEditorAPIRequest('viewportReorder', {
    nodeId, toEnd: !!toEnd, toStart: !toEnd, label: toEnd ? 'Bring to front' : 'Send to back'
  }, (res) => { if (res && res.error) _flashBlocked('not-reorderable'); });
}

/** Hand every selected node to the AI chat as a reference: select, then say what to do. */
function _askAiAboutSelection() {
  const ids = _members().map((m) => m.nodeId);
  const bridgeId = _bridgeSelectedNodeId();
  if (!ids.length && bridgeId) ids.push(bridgeId);
  if (!ids.length) return;
  makeEditorAPIRequest('viewportNodeInfo', { nodeIds: ids }, (res) => {
    const infos = res && Array.isArray(res.nodes) ? res.nodes : [];
    for (const info of infos) _referenceNodeInChat(info);
    ipcRenderer.sendToHost('inspector-chat-focus', { count: infos.length });
  });
}

function _singleBarAction(act) {
  if (act === 'anchor') _toggleAnchorPop();
  else if (act === 'front' && _selectedNodeId) _arrange(_selectedNodeId, true);
  else if (act === 'back' && _selectedNodeId) _arrange(_selectedNodeId, false);
  else if (act === 'ai') _askAiAboutSelection();
}

// --- Drag to reorder (nodes a flex layout owns) ---
// A node in a row or column cannot be offset, but it can change places: dragging it shows
// where it will land among its siblings and drops it there (one undo entry). This is the
// "Managed by layout — reorder coming soon" that used to be the only answer.
let _reorder = null; // { start, siblings, axis, before, line }

function _startReorder(e) {
  if (!_selectedElement || _isMulti()) return false;
  const parentEl = _selectedElement.parentElement;
  const parentNodeEl = _closestNodeElement(parentEl);
  const scope = parentNodeEl || document.body;
  const siblings = [];
  const seen = new Set();
  for (const el of scope.querySelectorAll('[data-xgenia-node-id]')) {
    if (el === _selectedElement || el.closest(_CHROME_SELECTOR)) continue;
    if (_closestNodeElement(el.parentElement) !== parentNodeEl) continue;
    const id = el.getAttribute('data-xgenia-node-id');
    if (!id || seen.has(id) || id === _selectedNodeId) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 && r.height <= 0) continue;
    seen.add(id);
    siblings.push({ nodeId: id, el, rect: r });
  }
  const dir = getComputedStyle(parentEl).flexDirection || 'column';
  _reorder = { start: _pt(e), siblings, axis: dir.indexOf('row') === 0 ? 'x' : 'y', before: undefined, line: null, active: false };
  _originalRect = _selectedElement.getBoundingClientRect();
  _gestureScale = _scalesOf(_selectedElement);
  _captureLivePreviewBase();
  e.preventDefault();
  e.stopPropagation();
  return true;
}

function _onReorder(e) {
  const r = _reorder;
  const p = _pt(e);
  const dx = p.x - r.start.x;
  const dy = p.y - r.start.y;
  if (!r.active) {
    if (Math.abs(dx) < _screenPx(DRAG_THRESHOLD) && Math.abs(dy) < _screenPx(DRAG_THRESHOLD)) return;
    r.active = true;
    document.body.style.cursor = 'grabbing';
    r.line = document.createElement('div');
    r.line.className = 'xg-reorder-line';
    document.body.appendChild(r.line);
  }
  // The dragged node follows the pointer, dimmed; layout is untouched until the drop.
  const g = _gestureScale || { ax: 1, ay: 1 };
  _writePreviewStyle('transform', 'translate(' + (dx / g.ax) + 'px, ' + (dy / g.ay) + 'px) ' + _livePreviewBase);
  _writePreviewStyle('opacity', '0.6');
  _updateSelectionPosition({ left: _originalRect.left + dx, top: _originalRect.top + dy, width: _originalRect.width, height: _originalRect.height });

  const horiz = r.axis === 'x';
  const at = horiz ? p.x : p.y;
  let before = null;
  for (const s of r.siblings) {
    const mid = horiz ? s.rect.left + s.rect.width / 2 : s.rect.top + s.rect.height / 2;
    if (at < mid) { before = s; break; }
  }
  r.before = before;
  const last = r.siblings[r.siblings.length - 1];
  const ref = before || last;
  if (!ref) return;
  const pr = _selectedElement.parentElement.getBoundingClientRect();
  const edge = before ? (horiz ? ref.rect.left : ref.rect.top) : (horiz ? ref.rect.left + ref.rect.width : ref.rect.top + ref.rect.height);
  Object.assign(r.line.style, horiz
    ? { left: (edge - 1.5) + 'px', top: pr.top + 'px', width: '3px', height: pr.height + 'px' }
    : { left: pr.left + 'px', top: (edge - 1.5) + 'px', width: pr.width + 'px', height: '3px' });
}

function _endReorder() {
  const r = _reorder;
  _reorder = null;
  if (r.line && r.line.parentNode) r.line.parentNode.removeChild(r.line);
  document.body.style.cursor = 'crosshair';
  if (!r.active) { _clearLivePreview(); return; }
  _suppressClickUntil = _now() + 400;
  const nodeId = _selectedNodeId;
  makeEditorAPIRequest('viewportReorder', {
    nodeId,
    beforeNodeId: r.before ? r.before.nodeId : null,
    toEnd: !r.before,
    label: 'Reorder'
  }, () => {
    // The re-render puts it in its new slot; the tracker moves the frame there.
    setTimeout(() => { if (_selectedNodeId === nodeId) _clearLivePreview(); _trackedRect = null; }, 60);
  });
}

// --- Align bar ---
const _ALIGN_ICONS = {
  left: '<path d="M3 2v12M6 4h7v3H6zM6 9h4v3H6z"/>',
  hcenter: '<path d="M8 2v12M4 4h8v3H4zM5.5 9h5v3h-5z"/>',
  right: '<path d="M13 2v12M3 4h7v3H3zM6 9h4v3H6z"/>',
  top: '<path d="M2 3h12M4 6v7h3V6zM9 6v4h3V6z"/>',
  vmiddle: '<path d="M2 8h12M4 4v8h3V4zM9 5.5v5h3v-5z"/>',
  bottom: '<path d="M2 13h12M4 3v7h3V3zM9 6v4h3V6z"/>',
  hdist: '<path d="M2 2v12M14 2v12M6 5h4v6H6z"/>',
  vdist: '<path d="M2 2h12M2 14h12M5 6h6v4H5z"/>'
};
const _ALIGN_TITLES = {
  left: 'Align left', hcenter: 'Align centres', right: 'Align right',
  top: 'Align top', vmiddle: 'Align middles', bottom: 'Align bottom',
  hdist: 'Distribute horizontally', vdist: 'Distribute vertically'
};
let _alignBar = null;

function _ensureAlignBar() {
  if (_alignBar) return _alignBar;
  _injectSelectionStyles();
  const bar = document.createElement('div');
  bar.className = 'xg-align-bar';
  const groups = [['left', 'hcenter', 'right'], ['top', 'vmiddle', 'bottom'], ['hdist', 'vdist']];
  groups.forEach((g, gi) => {
    if (gi) {
      const sep = document.createElement('div');
      sep.className = 'xg-align-sep';
      bar.appendChild(sep);
    }
    for (const kind of g) {
      const b = document.createElement('div');
      b.className = 'xg-align-btn';
      b.setAttribute('data-align', kind);
      b.title = _ALIGN_TITLES[kind];
      b.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2">' + _ALIGN_ICONS[kind] + '</svg>';
      bar.appendChild(b);
    }
  });
  const sep = document.createElement('div');
  sep.className = 'xg-align-sep';
  bar.appendChild(sep);
  bar.appendChild(_barButton('ai', 'Add the selected nodes to the AI chat', '', 'Ask AI'));
  document.body.appendChild(bar);
  _alignBar = bar;
  return bar;
}

function _showAlignBar() {
  const bar = _ensureAlignBar();
  const n = _members().length;
  for (const b of bar.querySelectorAll('[data-align]')) {
    const kind = b.getAttribute('data-align');
    b.classList.toggle('xg-off', (kind === 'hdist' || kind === 'vdist') && n < 3);
  }
  bar.classList.add('xg-on');
  _placeAlignBar(_selectionRect());
}

function _hideAlignBar() {
  if (_alignBar) _alignBar.classList.remove('xg-on');
}

function _placeAlignBar(rect) {
  if (!_alignBar || !_alignBar.classList.contains('xg-on')) return;
  _placeCentredChrome(_alignBar, rect.left + rect.width / 2, Math.max(4 * _uiK, rect.top - 74 * _uiK));
}

/**
 * Line the members up on the group's box, or space them evenly between its two outermost
 * members. Each member moves by a screen delta converted to its own pixels; the whole action
 * is one gesture, so one undo entry.
 */
function _alignSelection(kind) {
  const members = _members();
  if (members.length < 2) return;
  const items = members.map((m) => ({ m, r: m.el.getBoundingClientRect(), g: _scalesOf(m.el) }));
  const box = _unionRect(items.map((i) => i.r));
  const moves = new Map(); // nodeId → { dx, dy } in rect px

  const set = (i, dx, dy) => moves.set(i.m.nodeId, { i, dx, dy });
  if (kind === 'left') items.forEach((i) => set(i, box.left - i.r.left, 0));
  else if (kind === 'right') items.forEach((i) => set(i, box.right - (i.r.left + i.r.width), 0));
  else if (kind === 'hcenter') items.forEach((i) => set(i, box.left + box.width / 2 - (i.r.left + i.r.width / 2), 0));
  else if (kind === 'top') items.forEach((i) => set(i, 0, box.top - i.r.top));
  else if (kind === 'bottom') items.forEach((i) => set(i, 0, box.bottom - (i.r.top + i.r.height)));
  else if (kind === 'vmiddle') items.forEach((i) => set(i, 0, box.top + box.height / 2 - (i.r.top + i.r.height / 2)));
  else if (kind === 'hdist' || kind === 'vdist') {
    if (items.length < 3) return;
    const horiz = kind === 'hdist';
    const sorted = items.slice().sort((a, b) => horiz ? a.r.left - b.r.left : a.r.top - b.r.top);
    const total = sorted.reduce((sum, i) => sum + (horiz ? i.r.width : i.r.height), 0);
    const span = horiz ? box.width : box.height;
    const gap = (span - total) / (sorted.length - 1);
    let cursor = horiz ? box.left : box.top;
    for (const i of sorted) {
      const d = cursor - (horiz ? i.r.left : i.r.top);
      set(i, horiz ? d : 0, horiz ? 0 : d);
      cursor += (horiz ? i.r.width : i.r.height) + gap;
    }
  }

  const targets = [];
  for (const { i, dx, dy } of moves.values()) {
    if (Math.abs(dx) < 0.25 && Math.abs(dy) < 0.25) continue;
    targets.push({
      nodeId: i.m.nodeId,
      kind: 'dom',
      gesture: 'move',
      deltaX: _round2(dx / i.g.ax),
      deltaY: _round2(dy / i.g.ay),
      parentRect: _parentRectOf(i.m.el),
      ancestorTransformed: _hasTransformedAncestor(i.m.el)
    });
  }
  if (!targets.length) return;
  makeEditorAPIRequest('viewportGesture', { label: _ALIGN_TITLES[kind], targets }, (res) => {
    const blocked = res && res.blocked && res.blocked[0];
    if (blocked) _flashBlocked(blocked.reason);
  });
}

function _updateSelectionPosition(rect) {
  _selectionOverlay.style.left = rect.left + 'px';
  _selectionOverlay.style.top = rect.top + 'px';
  _selectionOverlay.style.width = rect.width + 'px';
  _selectionOverlay.style.height = rect.height + 'px';
  // On a small box the mid-edge handles crowd the corners and cover the element (Figma drops
  // them too); the edges still resize.
  _selectionOverlay.classList.toggle('xg-narrow', rect.width < 48 * _uiK);
  _selectionOverlay.classList.toggle('xg-short', rect.height < 48 * _uiK);
}

function _hideSelection() {
  _clearLivePreview();
  _hideActionTip();
  _setHotZone(null);
  _stopSelectionTracking();
  _settling = false;
  _clearExtras();
  _hideSingleBar();
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
  const caps = _effectiveCaps();
  const show = (el, on) => { el.style.display = on ? 'block' : 'none'; };
  for (const h of _gizmo.handles) show(h, !!(caps && caps.resizable));
  show(_gizmo.stem, !!(caps && caps.rotatable));
  show(_gizmo.rotate, !!(caps && caps.rotatable));
  show(_gizmo.axisX, !!(caps && caps.movable));
  show(_gizmo.axisY, !!(caps && caps.movable));
  show(_gizmo.pivot, !!(caps && (caps.rotatable || caps.movable)));
  _positionPivot();
  _updateSingleBar();
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
  _gizmo.tooltip.style.top = (y - 10 * _uiK) + 'px';
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

// --- Hierarchy eye / lock (editor-only) ---
// Hidden nodes are not drawn in Edit mode; locked nodes are skipped by every pick, so a click
// on a locked background lands on whatever is beneath it, or on nothing. Preview mode and the
// game never see either.
let _hiddenIds = new Set();
let _lockedIds = new Set();

function _isLocked(nodeId) {
  return !!nodeId && _lockedIds.has(nodeId);
}

function _applySceneVisibilityStyle() {
  let style = document.getElementById('xg-scene-visibility');
  if (!_inspectorEnabled || _hiddenIds.size === 0) {
    if (style) style.remove();
    return;
  }
  if (!style) {
    style = document.createElement('style');
    style.id = 'xg-scene-visibility';
    document.head.appendChild(style);
  }
  const sel = [..._hiddenIds].map((id) => '[data-xgenia-node-id="' + String(id).replace(/"/g, '') + '"]').join(',\n');
  style.textContent = sel + ' { opacity: 0 !important; pointer-events: none !important; }';
}

/** The topmost pickable node at a window point: hits on locked nodes fall through. */
function _pickNodeAt(clientX, clientY) {
  for (const el of document.elementsFromPoint(clientX, clientY)) {
    if (el.closest(_CHROME_SELECTOR)) continue;
    const id = findXgeniaNodeForElement(el);
    if (!id || id === 'none') continue;
    if (_isLocked(id) || _hiddenIds.has(id)) continue;
    return { nodeId: id, el };
  }
  return null;
}

// --- pixi / three bridges ---
// Sprites and 3D objects are not DOM elements: the bridges hit-test, draw and drag them on
// their own canvas. These are the few questions the DOM overlay needs to ask them.

function _bridges() {
  return [window.__PIXI_EDIT_BRIDGE, window.__THREE_EDIT_BRIDGE].filter(Boolean);
}

function _bridgeOwns(el) {
  if (!el) return false;
  for (const b of _bridges()) {
    try { if (typeof b.ownsElement === 'function' && b.ownsElement(el)) return true; } catch (err) { /* ignore */ }
  }
  return false;
}

function _bridgeSelectedNodeId() {
  for (const b of _bridges()) {
    try {
      const id = typeof b.getSelectedNodeId === 'function' ? b.getSelectedNodeId() : null;
      if (id) return id;
    } catch (err) { /* ignore */ }
  }
  return null;
}

function _bridgesClearSelection() {
  for (const b of _bridges()) {
    try { if (typeof b.clearSelection === 'function') b.clearSelection(); } catch (err) { /* ignore */ }
  }
}

/** Show the gizmo for a sprite/3D node the editor selected. True when a bridge has it. */
function _bridgesSelect(nodeId) {
  for (const b of _bridges()) {
    try { if (typeof b.selectByNodeId === 'function' && b.selectByNodeId(nodeId)) return true; } catch (err) { /* ignore */ }
  }
  return false;
}

// --- Right-click context menu: reference nodes in the chat ---
// Right-clicking in Edit mode lists every node under the cursor (a click on a
// label inside a button hits the label, the button and its row — the user
// decides which one they mean) and offers to add it to the chat as a reference
// or select it. Labels, types and owning component come from the editor model
// (viewportNodeInfo), not from DOM attributes, so the chat reference names the
// real node.

let _contextMenu = null;

function _closeContextMenu() {
  if (_contextMenu && _contextMenu.parentNode) _contextMenu.parentNode.removeChild(_contextMenu);
  _contextMenu = null;
  document.removeEventListener('mousedown', _onContextMenuOutside, true);
  document.removeEventListener('keydown', _onContextMenuKey, true);
}

function _onContextMenuOutside(e) {
  if (_contextMenu && !_contextMenu.contains(e.target)) _closeContextMenu();
}

function _onContextMenuKey(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    _closeContextMenu();
  }
}

function _nodeIdsAtPoint(x, y) {
  const ids = [];
  for (const el of document.elementsFromPoint(x, y)) {
    if (el.closest(_CHROME_SELECTOR)) continue;
    const id = findXgeniaNodeForElement(el);
    if (id && id !== 'none' && ids.indexOf(id) === -1) ids.push(id);
    if (ids.length >= 6) break;
  }
  return ids;
}

function _referenceNodeInChat(info) {
  ipcRenderer.sendToHost('inspector-node-reference', {
    nodeId: info.id,
    nodeLabel: info.label,
    nodeType: info.type,
    component: info.component
  });
}

function _selectNodeFromMenu(info) {
  const el = document.querySelector('[data-xgenia-node-id="' + info.id + '"]');
  if (el) _showSelection(el, info.id, info.label);
  makeEditorAPIRequest('inspectNodes', { nodeIds: [info.id] }, () => { });
}

function _menuRow(label, meta, onPick) {
  const row = document.createElement('div');
  row.className = 'xg-cm-row';
  const l = document.createElement('span');
  l.className = 'xg-cm-label';
  l.textContent = label;
  row.appendChild(l);
  if (meta) {
    const m = document.createElement('span');
    m.className = 'xg-cm-meta';
    m.textContent = meta;
    row.appendChild(m);
  }
  row.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  row.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    _closeContextMenu();
    onPick();
  });
  return row;
}

function _menuSection(text) {
  const d = document.createElement('div');
  d.className = 'xg-cm-section';
  d.textContent = text;
  return d;
}

function _menuSep() {
  const d = document.createElement('div');
  d.className = 'xg-cm-sep';
  return d;
}

/** Open the menu for nodeIds at (x, y); nodeIds[0] is the topmost hit. */
function _openContextMenu(nodeIds, x, y) {
  _closeContextMenu();
  if (!nodeIds || !nodeIds.length) return;
  _injectSelectionStyles();

  const menu = document.createElement('div');
  menu.className = 'xg-context-menu';
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  menu.appendChild(_menuSection('Loading…'));
  document.body.appendChild(menu);
  _contextMenu = menu;
  document.addEventListener('mousedown', _onContextMenuOutside, true);
  document.addEventListener('keydown', _onContextMenuKey, true);

  makeEditorAPIRequest('viewportNodeInfo', { nodeIds: nodeIds }, (res) => {
    if (_contextMenu !== menu) return; // closed or replaced meanwhile
    const infos = (res && Array.isArray(res.nodes)) ? res.nodes : [];
    menu.textContent = '';
    if (!infos.length) {
      menu.appendChild(_menuSection('Node not found in project'));
      return;
    }
    const top = infos[0];
    const typeShort = (t) => String(t || '').split('.').pop();

    menu.appendChild(_menuSection(top.label));
    menu.appendChild(_menuRow('Add to chat', '@' + top.label, () => _referenceNodeInChat(top)));
    menu.appendChild(_menuRow('Select', typeShort(top.type), () => _selectNodeFromMenu(top)));
    menu.appendChild(_menuRow('Bring to front', '', () => _arrange(top.id, true)));
    menu.appendChild(_menuRow('Send to back', '', () => _arrange(top.id, false)));

    if (infos.length > 1) {
      menu.appendChild(_menuSep());
      menu.appendChild(_menuSection('Also under cursor · add to chat'));
      for (const info of infos.slice(1)) {
        menu.appendChild(_menuRow(info.label, typeShort(info.type), () => _referenceNodeInChat(info)));
      }
    }

    // Keep the menu inside the viewport.
    const r = menu.getBoundingClientRect();
    if (r.right > window.innerWidth - 8) menu.style.left = Math.max(8, window.innerWidth - r.width - 8) + 'px';
    if (r.bottom > window.innerHeight - 8) menu.style.top = Math.max(8, window.innerHeight - r.height - 8) + 'px';
  });
}

// Pixi sprites live on the gizmo canvas, not in the DOM; the bridge hit-tests
// them and asks for the same menu.
let _gizmoContextSeq = 0; // bumps when a bridge opened the menu for a sprite under the pointer
window.addEventListener('xg-gizmo-context', (e) => {
  if (!_inspectorEnabled || !e.detail || !e.detail.nodeId) return;
  _gizmoContextSeq++;
  const z = _docZoom();
  _openContextMenu([e.detail.nodeId], e.detail.clientX / z, e.detail.clientY / z);
});

function _cleanupOverlays() {
  _closeContextMenu();
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
  // The shared stylesheet stays: the time bar uses it in Preview mode too.
  _hideAlignBar();
  _hideSingleBar();
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
    willChange: s.willChange,
    opacity: s.opacity
  };
  _livePreviewApplied = {};
  _lastPreviewRect = null;
}

// Remember the value as the browser serialised it, not as written: CSSOM rounds numbers to six
// significant digits, so 'translate(-94.81461234px…)' reads back as 'translate(-94.8146px…)'.
// Comparing against the written string made every "is this still our preview?" check fail
// for fractional values — the preview was never lifted, settling measured the preview itself,
// and the element stayed stuck in its preview transform.
function _writePreviewStyle(prop, value) {
  _selectedElement.style[prop] = value;
  _livePreviewApplied[prop] = _selectedElement.style[prop];
}

// dx/dy arrive in rect pixels. Prepending the translate applies it outermost, in the parent's
// space, so it is divided by the ancestors' scale: under a 0.5 design canvas a 10px drag is a
// 20px offset.
function _applyLiveMove(dx, dy) {
  if (!_selectedElement || !_livePreviewApplied) return;
  const g = _gestureScale || { ax: 1, ay: 1 };
  _writePreviewStyle('willChange', 'transform');
  _writePreviewStyle('transform', 'translate(' + (dx / g.ax) + 'px, ' + (dy / g.ay) + 'px) ' + _livePreviewBase);
  _lastPreviewRect = {
    left: _originalRect.left + dx, top: _originalRect.top + dy,
    width: _originalRect.width, height: _originalRect.height
  };
  for (const x of _extraPreviews) {
    const value = 'translate(' + (dx / x.g.ax) + 'px, ' + (dy / x.g.ay) + 'px) ' + x.base;
    x.el.style.willChange = 'transform';
    x.el.style.transform = value;
    x.applied.transform = x.el.style.transform; // as serialised (see _writePreviewStyle)
    x.applied.willChange = x.el.style.willChange;
  }
}

// Width/height are the element's own CSS pixels. Where the box then lands depends on its
// anchor (a centred element grows both ways), so measure where layout put it and translate
// the difference — the preview matches the frame for every anchor. A node layout owns
// (in-flow) cannot be offset by the commit either, so its preview shows where it really goes.
// Returns the rect the element now occupies.
function _applyLiveResize(geom) {
  if (!_selectedElement || !_livePreviewApplied) return geom.rect;
  const g = _gestureScale || { ax: 1, ay: 1 };
  _writePreviewStyle('willChange', 'transform');
  _writePreviewStyle('width', geom.localW + 'px');
  _writePreviewStyle('height', geom.localH + 'px');
  _writePreviewStyle('transform', _livePreviewBase || 'none');
  const natural = _selectedElement.getBoundingClientRect();
  if (_selectedCaps && _selectedCaps.movable) {
    const dx = (geom.rect.left - natural.left) / g.ax;
    const dy = (geom.rect.top - natural.top) / g.ay;
    _writePreviewStyle('transform', 'translate(' + dx + 'px, ' + dy + 'px) ' + _livePreviewBase);
    _lastPreviewRect = { left: geom.rect.left, top: geom.rect.top, width: geom.rect.width, height: geom.rect.height };
  } else {
    _lastPreviewRect = { left: natural.left, top: natural.top, width: natural.width, height: natural.height };
  }
  return _lastPreviewRect;
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
  for (const x of _extraPreviews) {
    for (const prop of ['transform', 'willChange']) {
      if (prop in x.applied && x.el.style[prop] === x.applied[prop]) x.el.style[prop] = x.inline[prop];
    }
  }
  _extraPreviews = [];
  if (!_selectedElement || !_livePreviewInline || !_livePreviewApplied) {
    _livePreviewInline = null;
    _livePreviewApplied = null;
    return;
  }
  const s = _selectedElement.style;
  for (const prop of ['transform', 'width', 'height', 'willChange', 'opacity']) {
    if (prop in _livePreviewApplied && s[prop] === _livePreviewApplied[prop]) {
      s[prop] = _livePreviewInline[prop];
    }
  }
  _livePreviewInline = null;
  _livePreviewApplied = null;
}

// --- Drag to move ---
let _dragActive = false; // True once movement exceeds threshold
const DRAG_THRESHOLD = 4; // screen px before a drag actually starts

// Extra members' previews during a group move: { el, base, inline, applied, g }.
let _extraPreviews = [];
let _lastDragDelta = { dx: 0, dy: 0 };
let _snapTargets = null;
let _suppressClickUntil = 0; // the click that ends a drag is not a selection (none may come)

function _startDrag(e) {
  if (!_selectedElement || _isResizing) return;
  _isDragging = true;
  _dragActive = false; // Not active until threshold exceeded
  _dragStart = _pt(e);
  _gestureScale = _scalesOf(_selectedElement);
  _originalRect = _selectedElement.getBoundingClientRect();
  _groupStartRect = _selectionRect();
  _captureLivePreviewBase();
  _extraPreviews = _extras.map((x) => {
    const t = getComputedStyle(x.el).transform;
    const st = x.el.style;
    return {
      el: x.el,
      nodeId: x.nodeId,
      base: (t && t !== 'none') ? t : '',
      inline: { transform: st.transform, willChange: st.willChange },
      applied: {},
      g: _scalesOf(x.el)
    };
  });
  _snapTargets = null;
  _lastDragDelta = { dx: 0, dy: 0 };
  _hideActionTip();
  e.preventDefault();
  e.stopPropagation();
}
let _groupStartRect = null;

function _onDrag(e) {
  if (!_isDragging) return;
  const p = _pt(e);
  const locked = _lockDeltas(p.x - _dragStart.x, p.y - _dragStart.y, e.shiftKey);
  let dx = locked.dx;
  let dy = locked.dy;

  // Don't activate until threshold exceeded (prevents accidental drag on click)
  if (!_dragActive) {
    if (Math.abs(dx) < _screenPx(DRAG_THRESHOLD) && Math.abs(dy) < _screenPx(DRAG_THRESHOLD)) return;
    // A node picked by this very press: wait for its capabilities, refuse if it cannot move.
    const caps = _effectiveCaps();
    if (!caps) return;
    if (!caps.movable) {
      _isDragging = false;
      _clearLivePreview();
      if (caps.moveReason === 'in-flow' && !_isMulti()) {
        // Picked by this press and laid out by its parent: the drag reorders it instead.
        const fake = { clientX: _dragStart.x * _docZoom(), clientY: _dragStart.y * _docZoom(), preventDefault() {}, stopPropagation() {} };
        if (_startReorder(fake)) _onReorder(e);
        return;
      }
      if (caps.moveReason) _flashBlocked(caps.moveReason);
      return;
    }
    _dragActive = true;
    document.body.style.cursor = 'grabbing';
  }

  // Smart guides: snap the moving box's edges and centre to its siblings and its parent.
  // Hold Cmd/Ctrl to place freely.
  const snapped = (e.metaKey || e.ctrlKey) ? null : _snap(_groupStartRect, dx, dy);
  if (snapped) {
    if (_dragAxis !== 'y') dx = snapped.dx;
    if (_dragAxis !== 'x') dy = snapped.dy;
    _drawGuides(snapped.guides, _groupStartRect, dx, dy);
  } else {
    _clearGuides();
  }
  _lastDragDelta = { dx, dy };

  // Frame and element move in tandem: overlay repositions, element gets a
  // screen-space translate preview (params untouched until commit).
  const base = _groupStartRect;
  const newRect = {
    left: base.left + dx,
    top: base.top + dy,
    width: base.width,
    height: base.height,
    right: base.left + base.width + dx,
    bottom: base.top + base.height + dy,
  };
  _updateSelectionPosition(newRect);
  _applyLiveMove(dx, dy);
  _placeBadges(newRect, '');
  _placeAlignBar(newRect);
  _placeSingleBar(newRect);
  const g = _gestureScale;
  _sizeBadge.textContent = 'Δ ' + Math.round(dx / g.ax) + ', ' + Math.round(dy / g.ay);
  if (_isMulti()) _placeMemberOutlines();
}

function _endDrag(e) {
  if (!_isDragging) return;
  const wasDragActive = _dragActive;
  _isDragging = false;
  _dragActive = false;
  document.body.style.cursor = 'crosshair';
  _clearGuides();
  _snapTargets = null;

  if (!wasDragActive) { _dragAxis = null; _clearLivePreview(); return; } // Just a click
  _suppressClickUntil = _now() + 400;

  const { dx, dy } = _lastDragDelta;
  _dragAxis = null;

  const g = _gestureScale;
  if (_extraPreviews.length) {
    // Group move: every member in one gesture, each delta in its own pixels.
    const extras = _extraPreviews.map((x) => _gestureTargetFor(x.nodeId, x.el, 'move', {
      deltaX: _round2(dx / x.g.ax), deltaY: _round2(dy / x.g.ay)
    }));
    _sendDomGesture('move', { deltaX: _round2(dx / g.ax), deltaY: _round2(dy / g.ay) }, {
      expect: _lastPreviewRect,
      label: 'Move ' + (extras.length + 1) + ' elements',
      extraTargets: extras
    });
  } else {
    _sendDomGesture('move', { deltaX: _round2(dx / g.ax), deltaY: _round2(dy / g.ay) }, {
      expect: _lastPreviewRect
    });
  }
  // Overlay stays at new position — preview will re-render when parameters update
}

// --- Box select ---
let _marquee = null; // { start, additive, el, active }

function _startMarquee(e) {
  _marquee = { start: _pt(e), additive: e.shiftKey, el: null, active: false };
  e.preventDefault();
  e.stopPropagation();
}

function _marqueeRect(p, m) {
  const a = (m || _marquee).start;
  return { left: Math.min(a.x, p.x), top: Math.min(a.y, p.y), width: Math.abs(p.x - a.x), height: Math.abs(p.y - a.y) };
}

function _onMarquee(e) {
  const p = _pt(e);
  const r = _marqueeRect(p);
  if (!_marquee.active) {
    if (r.width < _screenPx(DRAG_THRESHOLD) && r.height < _screenPx(DRAG_THRESHOLD)) return;
    _marquee.active = true;
    _injectSelectionStyles();
    _marquee.el = document.createElement('div');
    _marquee.el.className = 'xg-marquee';
    document.body.appendChild(_marquee.el);
  }
  Object.assign(_marquee.el.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
}

/**
 * The nodes a box selects: every node whose element lies wholly inside it, minus those whose
 * parent node is also inside — boxing a panel selects the panel, not each label in it.
 */
function _nodesInsideRect(box) {
  const inside = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('[data-xgenia-node-id]')) {
    if (el.closest(_CHROME_SELECTOR) || _bridgeOwns(el)) continue;
    const id = el.getAttribute('data-xgenia-node-id');
    if (!id || seen.has(id) || _isLocked(id) || _hiddenIds.has(id)) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    if (r.left >= box.left && r.top >= box.top && r.left + r.width <= box.left + box.width && r.top + r.height <= box.top + box.height) {
      seen.add(id);
      inside.push({ nodeId: id, el });
    }
  }
  return inside.filter((x) => !inside.some((o) => o !== x && o.el.contains(x.el)));
}

function _endMarquee(e) {
  const m = _marquee;
  _marquee = null;
  if (m.el && m.el.parentNode) m.el.parentNode.removeChild(m.el);
  if (!m.active) return; // a plain click: clickHandler deselects
  _suppressClickUntil = _now() + 400;
  const found = _nodesInsideRect(_marqueeRect(_pt(e), m));
  const entries = m.additive ? _members().concat(found.filter((f) => !_members().some((x) => x.nodeId === f.nodeId))) : found;
  if (!entries.length) {
    if (!m.additive) _hideSelection();
    return;
  }
  _bridgesClearSelection();
  _selectMany(entries);
}

// --- Pan ---
let _spaceHeld = false;
let _panning = null; // { last }

function _startPan(e) {
  _panning = { last: { x: e.clientX, y: e.clientY } };
  document.body.style.cursor = 'grabbing';
  e.preventDefault();
  e.stopPropagation();
}

function _onPan(e) {
  // The editor scrolls the zoomed frame (the game itself is never zoomed or scrolled).
  // Screen movement = frame px × the frame's scale, which the editor knows; send frame px.
  // The anchor stays the press point: once the editor has scrolled, the frame point under the
  // pointer is the anchor again, so each move's delta is measured from it.
  const dx = e.clientX - _panning.last.x;
  const dy = e.clientY - _panning.last.y;
  ipcRenderer.sendToHost('editor-pan-viewport', { dx, dy });
}

function _endPan() {
  _panning = null;
  _suppressClickUntil = _now() + 400;
  document.body.style.cursor = _spaceHeld ? 'grab' : 'crosshair';
}

// --- Smart guides ---
const SNAP_PX = 6; // screen pixels

/** Edges and centres of the moving nodes' siblings and of their parent, collected once per drag. */
function _collectSnapTargets() {
  const moving = _members().map((m) => m.el);
  const parentNodeEl = _closestNodeElement(_selectedElement.parentElement);
  const xs = [];
  const ys = [];
  const rects = [];
  const add = (r) => {
    if (!r || r.width <= 0 || r.height <= 0) return;
    xs.push(r.left, r.left + r.width / 2, r.left + r.width);
    ys.push(r.top, r.top + r.height / 2, r.top + r.height);
  };
  if (parentNodeEl) add(parentNodeEl.getBoundingClientRect());
  const candidates = parentNodeEl
    ? parentNodeEl.querySelectorAll('[data-xgenia-node-id]')
    : document.querySelectorAll('[data-xgenia-node-id]');
  let count = 0;
  for (const el of candidates) {
    if (count > 400) break;
    if (moving.some((m) => m === el || m.contains(el) || el.contains(m))) continue;
    // Siblings only: nodes whose own parent node is the moving node's parent.
    if (_closestNodeElement(el.parentElement) !== parentNodeEl) continue;
    const r = el.getBoundingClientRect();
    add(r);
    if (r.width > 0 && r.height > 0) rects.push({ left: r.left, top: r.top, right: r.left + r.width, bottom: r.top + r.height });
    count++;
  }
  return { xs, ys, rects };
}

let _pickedByPress = null; // node selected on mousedown; its click is already handled

function _announceSelection(nodeId, el, clientX, clientY, nodeLabel) {
  const r = el.getBoundingClientRect();
  const z = _docZoom();
  ipcRenderer.sendToHost('inspector-node-selected', {
    nodeId, nodeLabel, clickX: clientX, clickY: clientY,
    elementRect: { left: r.left * z, top: r.top * z, width: r.width * z, height: r.height * z }
  });
  makeEditorAPIRequest('inspectNodes', { nodeIds: [nodeId] }, () => { });
}

function _pickAndPress(hit, e) {
  const el = _nodeElementFor(hit.el, hit.nodeId) || hit.el;
  const label = el.getAttribute('data-xgenia-node-label') || hit.nodeId;
  _bridgesClearSelection();
  _showSelection(el, hit.nodeId, label);
  _pickedByPress = hit.nodeId;
  _announceSelection(hit.nodeId, el, e.clientX, e.clientY, label);
  // Caps arrive a moment later; the drag only activates once they say it may move.
  _startDrag(e);
  _dragAxis = null;
}

/** The element that carries this node id, at or above el. */
function _nodeElementFor(el, nodeId) {
  for (let cur = el; cur && cur !== document.body; cur = cur.parentElement) {
    if (cur.getAttribute && cur.getAttribute('data-xgenia-node-id') === nodeId) return cur;
  }
  return null;
}

function _closestNodeElement(el) {
  for (let cur = el; cur && cur !== document.body; cur = cur.parentElement) {
    if (cur.hasAttribute && cur.hasAttribute('data-xgenia-node-id')) return cur;
  }
  return null;
}

function _snap(start, dx, dy) {
  if (!start) return null;
  if (!_snapTargets) _snapTargets = _collectSnapTargets();
  const tol = _screenPx(SNAP_PX);
  const pick = (edges, targets) => {
    let best = null;
    for (const e of edges) {
      for (const t of targets) {
        const d = t - e;
        if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: t };
      }
    }
    return best;
  };
  const l = start.left + dx, t = start.top + dy;
  let bx = pick([l, l + start.width / 2, l + start.width], _snapTargets.xs);
  let by = pick([t, t + start.height / 2, t + start.height], _snapTargets.ys);
  // Equal spacing: centre the box between its nearest neighbours on each axis when that is
  // closer than any edge snap (Figma's pink "=" gaps).
  const box = { left: l, top: t, right: l + start.width, bottom: t + start.height };
  const ex = _equalGap(box, _snapTargets.rects, 'x', tol);
  const ey = _equalGap(box, _snapTargets.rects, 'y', tol);
  let gapX = null, gapY = null;
  if (ex && (!bx || Math.abs(ex.d) < Math.abs(bx.d))) { bx = { d: ex.d, at: null }; gapX = ex; }
  if (ey && (!by || Math.abs(ey.d) < Math.abs(by.d))) { by = { d: ey.d, at: null }; gapY = ey; }
  if (!bx && !by) return null;
  return {
    dx: dx + (bx ? bx.d : 0),
    dy: dy + (by ? by.d : 0),
    guides: { x: bx ? bx.at : null, y: by ? by.at : null, gapX, gapY }
  };
}

/**
 * The nudge that makes the gaps to the nearest neighbour on each side of the box equal along
 * one axis, or null. Neighbours must overlap the box on the other axis (so they read as a row
 * or a column) and sit fully to one side of it.
 */
function _equalGap(box, rects, axis, tol) {
  if (!rects || rects.length < 2) return null;
  const lo = axis === 'x' ? 'left' : 'top', hi = axis === 'x' ? 'right' : 'bottom';
  const plo = axis === 'x' ? 'top' : 'left', phi = axis === 'x' ? 'bottom' : 'right';
  let before = null, after = null;
  for (const r of rects) {
    if (Math.min(r[phi], box[phi]) - Math.max(r[plo], box[plo]) <= 0) continue;
    const gb = box[lo] - r[hi];
    const ga = r[lo] - box[hi];
    if (gb >= -tol && (!before || gb < before.gap)) before = { r, gap: gb };
    if (ga >= -tol && (!after || ga < after.gap)) after = { r, gap: ga };
  }
  if (!before || !after || before.r === after.r) return null;
  const d = (after.gap - before.gap) / 2;
  if (Math.abs(d) > tol) return null;
  const gap = before.gap + d;
  if (gap < 1) return null;
  return { d, gap, before: before.r, after: after.r };
}

let _guideEls = [];

function _drawGuides(guides, start, dx, dy) {
  _clearGuides();
  const r = { left: start.left + dx, top: start.top + dy, width: start.width, height: start.height };
  const line = (cls, css) => {
    const g = document.createElement('div');
    g.className = 'xg-guide ' + cls;
    Object.assign(g.style, css);
    document.body.appendChild(g);
    _guideEls.push(g);
  };
  const pad = 40;
  if (guides.x !== null) {
    line('xg-guide-v', { left: guides.x + 'px', top: (r.top - pad) + 'px', height: (r.height + pad * 2) + 'px' });
  }
  if (guides.y !== null) {
    line('xg-guide-h', { top: guides.y + 'px', left: (r.left - pad) + 'px', width: (r.width + pad * 2) + 'px' });
  }
  const box = { left: r.left, top: r.top, right: r.left + r.width, bottom: r.top + r.height };
  // Equal-gap markers: a bar across each of the two equal gaps, labelled with the gap in the
  // design's own pixels.
  const g0 = _selectedElement ? _scalesOf(_selectedElement) : { ax: 1, ay: 1 };
  const gapMarker = (from, to, axis, cross) => {
    if (to - from < 1) return;
    if (axis === 'x') line('xg-guide-h xg-gap', { left: from + 'px', top: cross + 'px', width: (to - from) + 'px' });
    else line('xg-guide-v xg-gap', { top: from + 'px', left: cross + 'px', height: (to - from) + 'px' });
    _guideEls[_guideEls.length - 1].setAttribute('data-gap', String(Math.round((to - from) / Math.abs(axis === 'x' ? g0.ax : g0.ay))));
  };
  if (guides.gapX) {
    const g = guides.gapX;
    const cy = (Math.max(box.top, g.before.top, g.after.top) + Math.min(box.bottom, g.before.bottom, g.after.bottom)) / 2;
    gapMarker(g.before.right, box.left, 'x', cy);
    gapMarker(box.right, g.after.left, 'x', cy);
  }
  if (guides.gapY) {
    const g = guides.gapY;
    const cx = (Math.max(box.left, g.before.left, g.after.left) + Math.min(box.right, g.before.right, g.after.right)) / 2;
    gapMarker(g.before.bottom, box.top, 'y', cx);
    gapMarker(box.bottom, g.after.top, 'y', cx);
  }
}

function _clearGuides() {
  for (const g of _guideEls) if (g.parentNode) g.parentNode.removeChild(g);
  _guideEls = [];
}

function _round2(v) {
  return Math.round(v * 100) / 100;
}

// --- Resize (overlay-only — never modifies actual DOM) ---
function _startResize(e, handleName) {
  if (!_selectedElement) return;
  _isResizing = true;
  _resizeHandle = handleName;
  _dragStart = _pt(e);
  _gestureScale = _scalesOf(_selectedElement);
  _originalRect = _selectedElement.getBoundingClientRect();
  _captureLivePreviewBase();
  _hideActionTip();
  // Hide badges during resize — only the dynamic size badge will be shown
  if (_labelBadge) _labelBadge.style.display = 'none';
  e.preventDefault();
  e.stopPropagation();
}

// The one place a resize's geometry is decided, so what the preview shows is what gets
// committed (Shift-resize used to commit a size recomputed without the aspect lock). The
// handle's opposite edge stays put; Shift keeps the aspect ratio, growing an edge handle's
// other axis about the centre.
function _resizeGeometry(e) {
  const p = _pt(e);
  const dx = p.x - _dragStart.x;
  const dy = p.y - _dragStart.y;
  const h = _resizeHandle;
  const o = _originalRect;
  const g = _gestureScale || { ax: 1, ay: 1, ox: 1, oy: 1 };
  const sx = Math.abs(g.ax * g.ox);
  const sy = Math.abs(g.ay * g.oy);

  let w = o.width;
  let ht = o.height;
  if (h.includes('e')) w += dx;
  if (h.includes('w')) w -= dx;
  if (h.includes('s')) ht += dy;
  if (h.includes('n')) ht -= dy;

  if (e.shiftKey && o.width > 0 && o.height > 0) {
    const aspect = o.width / o.height;
    if (h === 'e' || h === 'w') ht = w / aspect;
    else if (h === 'n' || h === 's') w = ht * aspect;
    else if (Math.abs(dx) > Math.abs(dy)) ht = w / aspect;
    else w = ht * aspect;
  }

  // Minimum 10 of the element's own pixels.
  w = Math.max(w, 10 * sx);
  ht = Math.max(ht, 10 * sy);

  let l = o.left;
  let t = o.top;
  if (h.includes('w')) l = o.left + o.width - w;
  if (h.includes('n')) t = o.top + o.height - ht;
  if (e.shiftKey && (h === 'e' || h === 'w')) t = o.top + (o.height - ht) / 2;
  if (e.shiftKey && (h === 'n' || h === 's')) l = o.left + (o.width - w) / 2;

  return {
    rect: { left: l, top: t, width: w, height: ht, right: l + w, bottom: t + ht },
    localW: w / sx,
    localH: ht / sy
  };
}

function _onResize(e) {
  if (!_isResizing) return;
  const geom = _resizeGeometry(e);
  // Frame and element resize in tandem (inline preview, committed on release)
  const shown = _applyLiveResize(geom);
  const frame = Object.assign({}, shown, { right: shown.left + shown.width, bottom: shown.top + shown.height });
  _updateSelectionPosition(frame);
  _placeBadges(frame, Math.round(geom.localW) + ' × ' + Math.round(geom.localH));
}

function _endResize(e) {
  if (!_isResizing) return;
  _isResizing = false;

  const geom = _resizeGeometry(e);
  const changed = Math.abs(geom.rect.width - _originalRect.width) > 0.5 ||
    Math.abs(geom.rect.height - _originalRect.height) > 0.5;

  if (changed) {
    _suppressClickUntil = _now() + 400; // the release lands off the element: not a pick
    _sendDomGesture('resize', { width: _round2(geom.localW), height: _round2(geom.localH) }, {
      expect: _lastPreviewRect || geom.rect
    });
  } else {
    _clearLivePreview();
  }
  if (_labelBadge && _selectedElement) _labelBadge.style.display = 'block';
  // Overlay stays at new size — preview will re-render when parameters update
}

// Global mouse handlers for drag/resize (attached when inspector is enabled)
// Contextual bars step aside while a gesture runs: the element, not the chrome, is what the
// eye follows. They come back where the element lands.
let _barsHidden = false;
function _setBarsHidden(hidden) {
  if (_barsHidden === hidden) return;
  _barsHidden = hidden;
  for (const el of [_singleBar, _alignBar, _anchorPop]) {
    if (el) el.style.visibility = hidden ? 'hidden' : '';
  }
}

function _globalMouseMove(e) {
  if ((_isDragging && _dragActive) || _isResizing || _isRotating || (_reorder && _reorder.active)) _setBarsHidden(true);
  if (_reorder) { _onReorder(e); return; }
  if (_panning) { _onPan(e); return; }
  if (_marquee) { _onMarquee(e); return; }
  if (_isDragging) { _onDrag(e); return; }
  if (_isResizing) { _onResize(e); return; }
  if (_isRotating) { _onRotate(e); return; }
}

function _globalMouseUp(e) {
  _setBarsHidden(false);
  if (_reorder) { _endReorder(e); return; }
  if (_panning) { _endPan(e); return; }
  if (_marquee) { _endMarquee(e); return; }
  if (_isDragging) { _endDrag(e); return; }
  if (_isResizing) { _endResize(e); return; }
  if (_isRotating) { _endRotate(e); return; }
}

// --- Gesture payload helpers ---

function _rectOf(el) {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

// The parent's box in the child's local pixels, the units a % offset or size is resolved in.
function _parentRectOf(el) {
  const p = el.parentElement;
  if (!p) return null;
  const r = _rectOf(p);
  const a = _ancestorScale(el);
  if (a.blocked) return r;
  return { left: r.left, top: r.top, width: r.width / Math.abs(a.sx), height: r.height / Math.abs(a.sy) };
}

// Gestures divide out an ancestor SCALE (see _ancestorScale). Only a rotated or skewed
// ancestor still blocks them: there a screen delta has no single local meaning. A scale used
// to block too, which in a slot project — everything under a uiScale design canvas — meant
// nothing could be moved at all.
function _hasTransformedAncestor(el) {
  return _ancestorScale(el).blocked;
}

// Which resize handle (if any) does a point on the selection frame correspond to?
// The grab zone reaches HANDLE_ZONE screen px outside each edge but at most a quarter of the
// box inside it: on a 14px-tall label a symmetric 8px zone covered the whole element, so every
// click on it started a resize and the click itself was swallowed.
const HANDLE_ZONE = 8;
function _handleAtPoint(x, y) {
  if (!_selectedElement) return null;
  const r = _selectedElement.getBoundingClientRect();
  const out = _screenPx(HANDLE_ZONE);
  const inX = Math.min(out / 2, r.width / 4);
  const inY = Math.min(out / 2, r.height / 4);
  const nearL = x >= r.left - out && x <= r.left + inX;
  const nearR = x <= r.right + out && x >= r.right - inX;
  const nearT = y >= r.top - out && y <= r.top + inY;
  const nearB = y <= r.bottom + out && y >= r.bottom - inY;
  const insideX = x >= r.left - out && x <= r.right + out;
  const insideY = y >= r.top - out && y <= r.bottom + out;
  if (!insideX || !insideY) return null;
  let h = '';
  if (nearT) h += 'n'; else if (nearB) h += 's';
  if (nearL) h += 'w'; else if (nearR) h += 'e';
  return h || null;
}

function _isInsideSelection(x, y) {
  if (!_selectedElement) return false;
  const r = _selectionRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

// Brief "why nothing moved" feedback on a blocked gesture, reusing the label badge.
function _flashBlocked(reason) {
  if (!_labelBadge || !_selectedElement) return;
  const messages = {
    'in-flow': 'Managed by layout — drag to reorder',
    'not-reorderable': 'Cannot reorder this node',
    'transformed-ancestor': 'Inside a rotated container',
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

function _gestureTarget(gesture, fields) {
  return _gestureTargetFor(_selectedNodeId, _selectedElement, gesture, fields);
}

function _gestureTargetFor(nodeId, el, gesture, fields) {
  return Object.assign({
    nodeId,
    kind: 'dom',
    gesture,
    parentRect: _parentRectOf(el),
    ancestorTransformed: _hasTransformedAncestor(el)
  }, fields);
}

/**
 * Commit a gesture through the editor (one undo entry), then hand the element back to the
 * model. opts.expect is where the gesture left the element on screen; opts.coalesce joins a
 * run of nudges into one undo entry.
 */
function _sendDomGesture(gesture, fields, opts) {
  if (!_selectedNodeId || !_selectedElement) return;
  opts = opts || {};
  const labels = { move: 'Move element', resize: 'Resize element', rotate: 'Rotate element', anchor: 'Set anchor' };
  const startRect = _originalRect;
  makeEditorAPIRequest('viewportGesture', {
    label: opts.label || labels[gesture] || 'Edit element',
    coalesce: opts.coalesce,
    targets: [_gestureTarget(gesture, fields)].concat(opts.extraTargets || [])
  }, (res) => {
    const blocked = res && res.blocked && res.blocked[0];
    if (blocked) {
      _clearLivePreview(); // snap back — nothing was written
      _flashBlocked(blocked.reason);
    } else if (!opts.noSettle) {
      _settleAfterCommit({ gesture, expect: opts.expect || null, startRect, groupId: res && res.groupId, maxGap: opts.maxGap || null });
    }
  });
}

function _sameRect(a, b, tol) {
  return !!a && !!b &&
    Math.abs(a.left - b.left) <= tol && Math.abs(a.top - b.top) <= tol &&
    Math.abs(a.width - b.width) <= tol && Math.abs(a.height - b.height) <= tol;
}

// After a committed gesture: keep the preview up until the committed params have OBSERVABLY
// re-rendered the element, then hand off. A fixed timer here raced the model→viewer
// propagation and caused release-jumps.
//
// Where a resize lands depends on the element's anchor: the size param cannot say "keep the
// right edge here", so a left-handle resize, or any resize of a centred element, came back
// shifted. Once the committed size has rendered, a remaining position gap is closed with one
// corrective move folded into the same undo entry — the element ends where the user let go,
// whatever its anchor.
function _settleAfterCommit(opts) {
  const nodeId = _selectedNodeId;
  const expected = opts.expect; // null for rotation
  const baseTransform = _livePreviewBase;
  const startedAt = _now();
  const POLL_MS = 100;
  const TIMEOUT_MS = 4000;
  // Only a resize needs correcting: a move's offset is applied after layout, so it lands
  // exactly, and measuring a move mid-re-render only invites a wrong "fix".
  let corrected = !opts.groupId || (opts.gesture !== 'resize' && opts.gesture !== 'anchor') || !(_selectedCaps && _selectedCaps.movable);
  let previous = null;
  let stableTicks = 0;
  _settling = true;

  const finish = () => {
    _settling = false;
    _clearLivePreview();
    if (!_selectionOverlay || !_selectedElement) return;
    _selectionOverlay.style.transform = '';
    const rect = _selectedElement.getBoundingClientRect();
    _updateSelectionPosition(rect);
    if (_labelBadge) _labelBadge.style.display = 'block';
    _placeBadges(rect);
    _positionPivot();
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
    if (_selectedNodeId !== nodeId || !_selectedElement) { _settling = false; return; } // selection moved on

    // React may have replaced the DOM node on re-render; the fresh node carries only
    // committed styles and no preview of ours.
    const fresh = document.querySelector('[data-xgenia-node-id="' + nodeId + '"]');
    if (fresh && fresh !== _selectedElement) {
      _selectedElement = fresh;
      _livePreviewInline = null;
      _livePreviewApplied = null;
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

    let converged;
    let sizeOk = true;
    let posOk = true;
    if (expected) {
      sizeOk = Math.abs(r.width - expected.width) <= 1.5 && Math.abs(r.height - expected.height) <= 1.5;
      posOk = Math.abs(r.left - expected.left) <= 1.5 && Math.abs(r.top - expected.top) <= 1.5;
      converged = sizeOk && posOk;
    } else {
      converged = (t === 'none' ? '' : t) !== baseTransform; // rotation: transform recomputed
    }

    // An anchor change is expected to leave the box where it was, so "unchanged" right after
    // the commit only means the re-render has not landed yet: wait for it (up to 1.5 s — an
    // anchor that happens not to move the box never shows a change).
    const rendered0 = !_sameRect(r, opts.startRect, 0.5);
    if (converged && opts.gesture === 'anchor' && !rendered0 && !corrected && _now() - startedAt < 1500) {
      for (const prop in lifted) s[prop] = lifted[prop];
      setTimeout(tick, POLL_MS);
      return;
    }

    if (converged) {
      finish();
      return;
    }

    stableTicks = _sameRect(r, previous, 0.25) ? stableTicks + 1 : 0;
    previous = { left: r.left, top: r.top, width: r.width, height: r.height };
    const rendered = !_sameRect(r, opts.startRect, 0.5);

    // The gap a resize can leave is at most what the box grew by; anything bigger is a bad
    // measurement (the element mid-remount), not something to write into the model.
    const gapX = expected ? expected.left - r.left : 0;
    const gapY = expected ? expected.top - r.top : 0;
    const maxX = opts.maxGap ? opts.maxGap.x : Math.abs(r.width - (opts.startRect ? opts.startRect.width : r.width)) + 2;
    const maxY = opts.maxGap ? opts.maxGap.y : Math.abs(r.height - (opts.startRect ? opts.startRect.height : r.height)) + 2;
    const plausible = !!opts.startRect && _selectedElement.isConnected && r.width > 0 &&
      Math.abs(gapX) <= maxX && Math.abs(gapY) <= maxY;
    if (!corrected && expected && sizeOk && !posOk && rendered && plausible) {
      corrected = true;
      const g = _gestureScale || { ax: 1, ay: 1 };
      makeEditorAPIRequest('viewportGesture', {
        label: opts.gesture === 'anchor' ? 'Set anchor' : 'Resize element',
        amendGroupId: opts.groupId,
        targets: [_gestureTarget('move', {
          deltaX: _round2(gapX / g.ax),
          deltaY: _round2(gapY / g.ay)
        })]
      }, () => { });
    }

    // Not yet — put the preview back before the browser paints.
    for (const prop in lifted) s[prop] = lifted[prop];

    if (_now() - startedAt > TIMEOUT_MS) {
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
  const r = _selectionRect();
  return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, rect: r };
}

function _isOnRotateHandle(x, y) {
  const caps = _effectiveCaps();
  if (!_selectedElement || !(caps && caps.rotatable)) return false;
  const r = _selectedElement.getBoundingClientRect();
  const hx = r.left + r.width / 2;
  const hy = r.top - _screenPx(31); // lollipop circle centre (CSS: 31 screen px above the frame)
  return Math.hypot(x - hx, y - hy) <= _screenPx(10);
}

function _axisArrowAtPoint(x, y) {
  const caps = _effectiveCaps();
  if (!_selectedElement || !(caps && caps.movable)) return null;
  const { cx, cy } = _selectionCenter();
  const k = _screenPx(1);
  if (x >= cx + 6 * k && x <= cx + (AXIS_LEN + 12) * k && Math.abs(y - cy) <= 7 * k) return 'x';
  if (y <= cy - 6 * k && y >= cy - (AXIS_LEN + 12) * k && Math.abs(x - cx) <= 7 * k) return 'y';
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
  const zoom = _docZoom();
  _showActionTip(kind, e.detail.clientX / zoom, e.detail.clientY / zoom);
});

// --- Rotation gesture (overlay-only preview; commits transformRotation) ---

let _rotatePivot = null; // screen-space pivot; the element's transform-origin

function _startRotate(e) {
  if (!_selectedElement) return;
  _isRotating = true;
  _rotateDeltaDeg = 0;
  _gestureScale = _scalesOf(_selectedElement);
  _originalRect = _selectedElement.getBoundingClientRect();
  _captureLivePreviewBase();
  // Rotate around the node's wired transform-origin, not the box center.
  const o = _transformOriginOf(_selectedElement);
  _rotatePivot = { x: _originalRect.left + o.x, y: _originalRect.top + o.y };
  _selectionOverlay.style.transformOrigin = o.x + 'px ' + o.y + 'px';
  const p = _pt(e);
  _rotateStartAngle = Math.atan2(p.y - _rotatePivot.y, p.x - _rotatePivot.x);
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
  const p = _pt(e);
  const angle = Math.atan2(p.y - cy, p.x - cx);
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
    _suppressClickUntil = _now() + 400;
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
    const now = _now();
    if (now - _lastZoomTime < 30) return;
    _lastZoomTime = now;
    const delta = e.deltaY > 0 ? -0.05 : 0.05;
    // Zoom toward the pointer: the editor scales the frame and keeps this point still.
    ipcRenderer.sendToHost('editor-zoom-viewport', { delta: delta, clientX: e.clientX, clientY: e.clientY });
  }
}, { passive: false });

// --- The game under the pointer stays still in Edit mode ---
// A press would fire the game's button states, a hover its hover styles. The viewer's legacy
// Inspector used to block these, and ran its own click/inspect logic on top of this overlay as
// well: every click selected twice, and the click that ends a drag or box select selected
// whatever happened to be under the pointer. Its document-level stopPropagation also starved the
// pixi gizmo canvas of mousedown. It is no longer switched on; this does the blocking.
const _GAME_POINTER_EVENTS = ['mouseover', 'mouseout', 'mouseenter', 'mouseleave', 'mousedown', 'mouseup',
  'pointerover', 'pointerout', 'pointerdown', 'pointerup', 'click', 'dblclick', 'touchstart', 'touchend'];

function _blockGamePointer(e) {
  const t = e.target;
  if (_bridgeOwns(t)) return; // sprites and 3D: the bridges' own canvas input
  if (t && t.closest && t.closest(_CHROME_SELECTOR)) return; // our context menu, align bar
  e.stopPropagation();
}

// --- Preview clock: pause, step one frame, speed ---
// Unity's Pause / Step / time scale for the running game. Nothing in the runtime has a global
// clock, so this replaces the page's clock functions once, on first use: requestAnimationFrame
// callbacks get a virtual timestamp (held while paused), performance.now and Date.now read
// virtual time. That reaches the runtime's timers, every Pixi ticker, reel tweens and three
// loops. gsap snapshotted Date.now when it loaded, so it is scaled through its own
// globalTimeline; CSS/Web animations and media get playbackRate. setTimeout is left alone:
// pausing it would also stop the editor plumbing. Known gap: logic that waits on setTimeout
// (some reel controller delays) keeps real time.
const _clock = { installed: false, paused: false, speed: 1, realBase: 0, virtBase: 0, frozen: 0, held: [], dateOffset: 0, lastTs: 0 };

function _virtNow() {
  if (!_clock.installed) return _realPerfNow();
  if (_clock.paused) return _clock.frozen;
  return _clock.virtBase + (_realPerfNow() - _clock.realBase) * _clock.speed;
}

function _installPreviewClock() {
  if (_clock.installed) return;
  _clock.installed = true;
  _clock.realBase = _realPerfNow();
  _clock.virtBase = _clock.realBase;
  _clock.dateOffset = _realDateNow() - _realPerfNow();
  try { performance.now = () => _virtNow(); } catch (err) { /* read-only in this build */ }
  Date.now = () => Math.floor(_clock.dateOffset + _virtNow());
  window.requestAnimationFrame = (cb) => _realRAF(() => {
    if (_clock.paused) { _clock.held.push(cb); return; }
    _clock.lastTs = _virtNow();
    cb(_clock.lastTs);
  });
}

function _rebaseClock() {
  const v = _virtNow();
  _clock.realBase = _realPerfNow();
  _clock.virtBase = v;
}

function _applyClockToSideSystems() {
  const rate = _clock.paused ? 0 : _clock.speed;
  try {
    const g = window.gsap && window.gsap.globalTimeline;
    if (g) { g.timeScale(_clock.speed); if (_clock.paused) g.pause(); else g.resume(); }
  } catch (err) { /* ignore */ }
  try {
    for (const a of document.getAnimations ? document.getAnimations() : []) {
      if (_clock.paused) a.pause(); else { a.playbackRate = _clock.speed; if (a.playState === 'paused') a.play(); }
    }
  } catch (err) { /* ignore */ }
  for (const m of document.querySelectorAll('video, audio')) {
    try {
      if (_clock.paused) { if (!m.paused) { m.dataset.xgWasPlaying = '1'; m.pause(); } }
      else {
        m.playbackRate = rate || 1;
        if (m.dataset.xgWasPlaying) { delete m.dataset.xgWasPlaying; m.play().catch(() => { }); }
      }
    } catch (err) { /* ignore */ }
  }
}

function _setPaused(paused) {
  _installPreviewClock();
  if (paused === _clock.paused) return;
  if (paused) {
    // Freeze at the last frame the page saw, so the first Step is one frame, not the gap
    // between that frame and the click.
    _clock.frozen = _clock.lastTs || _virtNow();
    _clock.paused = true;
  } else {
    _clock.paused = false;
    _clock.realBase = _realPerfNow();
    _clock.virtBase = _clock.frozen;
    const held = _clock.held.splice(0);
    for (const cb of held) _realRAF(() => cb(_virtNow()));
  }
  _applyClockToSideSystems();
}

function _setSpeed(speed) {
  _installPreviewClock();
  _rebaseClock();
  _clock.speed = speed;
  _applyClockToSideSystems();
}

/** While paused: advance one 60 fps frame and run what was waiting for it. */
function _stepFrame() {
  if (!_clock.paused) _setPaused(true);
  _clock.frozen += 1000 / 60;
  const held = _clock.held.splice(0);
  for (const cb of held) { try { cb(_clock.frozen); } catch (err) { console.error('[PreviewClock] frame callback threw', err); } }
  try {
    const g = window.gsap && window.gsap.globalTimeline;
    if (g) g.time(g.time() + 1 / 60);
  } catch (err) { /* ignore */ }
  try {
    for (const a of document.getAnimations ? document.getAnimations() : []) {
      if (a.currentTime !== null) a.currentTime = a.currentTime + 1000 / 60;
    }
  } catch (err) { /* ignore */ }
}

// --- Safe-area overlay ---
// Notch/home-indicator insets for phone-shaped previews, and the classic title-safe (90%) and
// action-safe (95%) frames. Drawn over the game in Edit and Preview; never part of the game.
let _safeMode = 'off'; // off | device | title
const _SAFE_MODES = ['off', 'device', 'title'];

function _deviceInsets() {
  const w = window.innerWidth, h = window.innerHeight;
  const portrait = h > w;
  const phone = Math.min(w, h) <= 500 && Math.max(w, h) / Math.min(w, h) > 1.7;
  if (!phone) return null;
  // iPhone 15-class: Dynamic Island + home indicator.
  return portrait ? { top: 59, right: 0, bottom: 34, left: 0 } : { top: 0, right: 59, bottom: 21, left: 59 };
}

function _renderSafeArea() {
  let el = document.querySelector('.xg-safe-area');
  if (_safeMode === 'off') { if (el) el.remove(); return; }
  _injectSelectionStyles();
  if (!el) {
    el = document.createElement('div');
    el.className = 'xg-safe-area';
    Object.assign(el.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '999990' });
    document.body.appendChild(el);
  }
  const z = _docZoom();
  const W = window.innerWidth / z, H = window.innerHeight / z;
  const box = (l, t, r, b, color, label) =>
    '<div style="position:absolute;left:' + l + 'px;top:' + t + 'px;right:' + r + 'px;bottom:' + b + 'px;border:calc(1px * var(--xg-k, 1)) dashed ' + color + ';border-radius:4px">' +
    '<span style="position:absolute;left:4px;top:2px;transform-origin:0 0;transform:scale(var(--xg-k, 1));white-space:nowrap;font:500 10px -apple-system,system-ui,sans-serif;color:' + color + '">' + label + '</span></div>';
  if (_safeMode === 'device') {
    const i = _deviceInsets();
    el.innerHTML = i
      ? '<div style="position:absolute;inset:0;box-shadow:inset ' + '0 ' + i.top + 'px 0 rgba(255,59,48,0.18), inset 0 -' + i.bottom + 'px 0 rgba(255,59,48,0.18), inset ' + i.left + 'px 0 0 rgba(255,59,48,0.18), inset -' + i.right + 'px 0 0 rgba(255,59,48,0.18)"></div>' +
        box(i.left, i.top, i.right, i.bottom, 'rgba(255,149,0,0.95)', 'Safe area · iPhone-class estimate')
      : box(8, 8, 8, 8, 'rgba(255,149,0,0.95)', 'Not a phone-shaped screen: no notch estimate');
  } else {
    el.innerHTML = box(W * 0.025, H * 0.025, W * 0.025, H * 0.025, 'rgba(52,199,89,0.95)', 'Action safe 95%') +
      box(W * 0.05, H * 0.05, W * 0.05, H * 0.05, 'rgba(10,132,255,0.95)', 'Title safe 90%');
  }
}

window.addEventListener('resize', () => { if (_safeMode !== 'off') _renderSafeArea(); });

// --- State scrubber ---
// Jump the running game to any state of any States node — idle, spin, win, big win — to lay
// out that moment without playing up to it. Runtime only: nothing is saved, and the game's
// own logic takes over again on its next state change. Click animates the transition,
// Alt-click jumps.
function _runtimeStatesNodes() {
  const rt = window.XGENIA && window.XGENIA._runtime;
  const root = rt && rt.rootComponent && rt.rootComponent.nodeScope;
  const out = [];
  const seen = new Set();
  const walk = (scope, depth) => {
    if (!scope || !scope.nodes || depth > 12) return;
    for (const id of Object.keys(scope.nodes)) {
      const n = scope.nodes[id];
      if (!n) continue;
      if (n.name === 'States' && n._internal && Array.isArray(n._internal.states) && n._internal.states.length && !seen.has(n)) {
        seen.add(n);
        out.push(n);
      }
      if (n.nodeScope && n.nodeScope !== scope) walk(n.nodeScope, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

function _statesLabel(n) {
  return (n.model && n.model.label) || n.label || (n.model && n.model.typename) || n.id;
}

function _goToRuntimeState(index, state, jump) {
  const n = _runtimeStatesNodes()[index];
  if (!n) return;
  try {
    if (jump && typeof n.jumpToState === 'function') n.jumpToState(state);
    else if (typeof n.goToState === 'function') n.goToState(state);
    else if (typeof n.scheduleGoToState === 'function') n.scheduleGoToState(state);
  } catch (err) { console.error('[StateScrubber]', err); }
}

// --- Keyboard ---
// After any click in the preview, keyboard focus lives in this frame, and the editor's own
// keydown listener never sees keys pressed here. That is why Cmd+Z did nothing after moving
// an element (the move WAS in the undo history). The editor shortcuts that act on the
// selection are forwarded; the game's own text fields keep their keys.

const _NON_TEXT_INPUTS = ['checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file', 'image'];

function _isTypingTarget(el) {
  if (!el || !el.tagName) return false;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  if (el.tagName === 'INPUT') return _NON_TEXT_INPUTS.indexOf((el.type || 'text').toLowerCase()) === -1;
  if (el.isContentEditable) return true;
  const role = el.getAttribute && el.getAttribute('role');
  return role === 'textbox' || role === 'searchbox' || role === 'combobox' || role === 'spinbutton';
}

function _forwardKey(e, override) {
  e.preventDefault();
  e.stopPropagation();
  const k = Object.assign({
    key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey
  }, override || {});
  makeEditorAPIRequest('viewportKey', k, () => { });
}

function _hasViewportSelection() {
  return !!_selectedNodeId || !!_bridgeSelectedNodeId();
}

document.addEventListener('keyup', (e) => {
  if (e.key === ' ' && _spaceHeld) {
    _spaceHeld = false;
    if (!_panning) document.body.style.cursor = _inspectorEnabled ? 'crosshair' : '';
  }
});

document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented) return;
  if (_isTypingTarget(e.target) || _isTypingTarget(document.activeElement)) return;
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key || '';
  const lower = key.toLowerCase();
  const arrow = key.indexOf('Arrow') === 0;
  if (e.repeat && !arrow && key !== ' ') return;

  // Undo / redo work in both modes: an edit made in Edit mode is still undoable after
  // switching to Preview with focus in the game.
  if (mod && !e.altKey && lower === 'z') { _forwardKey(e); return; }
  if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && lower === 'y') {
    _forwardKey(e, { key: 'z', shiftKey: true }); // Windows-style redo
    return;
  }

  if (!_inspectorEnabled) return; // Preview mode — the game owns every other key

  if (mod && !e.altKey && !e.shiftKey) {
    if (key === '0') {
      e.preventDefault();
      ipcRenderer.sendToHost('editor-zoom-viewport', { reset: true });
      return;
    }
    if (key === '=' || key === '+') {
      e.preventDefault();
      ipcRenderer.sendToHost('editor-zoom-viewport', { delta: 0.1 });
      return;
    }
    if (key === '-') {
      e.preventDefault();
      ipcRenderer.sendToHost('editor-zoom-viewport', { delta: -0.1 });
      return;
    }
    if (lower === 'c' || lower === 'v' || lower === 'x' || lower === 'd') {
      if (lower !== 'v' && !_hasViewportSelection()) return;
      _forwardKey(e);
      if (lower === 'x') _hideSelection();
      return;
    }
  }

  if (!mod && !e.altKey && (key === 'Delete' || key === 'Backspace')) {
    if (!_hasViewportSelection()) return;
    _forwardKey(e);
    _hideSelection();
    return;
  }

  if (key === ' ' && !mod) {
    // Hold Space to pan, like every canvas tool.
    e.preventDefault();
    if (!_spaceHeld) {
      _spaceHeld = true;
      if (!_isDragging && !_isResizing && !_isRotating) document.body.style.cursor = 'grab';
    }
    return;
  }

  if (mod && !e.shiftKey && !e.altKey && lower === 'a' && _selectedElement) {
    // Select All: the selected node and every sibling beside it.
    e.preventDefault();
    e.stopPropagation();
    const parentNodeEl = _closestNodeElement(_selectedElement.parentElement);
    const scope = parentNodeEl || document.body;
    const siblings = [];
    const seen = new Set();
    for (const el of scope.querySelectorAll('[data-xgenia-node-id]')) {
      const id = el.getAttribute('data-xgenia-node-id');
      if (seen.has(id) || _isLocked(id) || _hiddenIds.has(id) || _closestNodeElement(el.parentElement) !== parentNodeEl) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      seen.add(id);
      siblings.push({ nodeId: id, el });
    }
    const primary = siblings.findIndex((x) => x.nodeId === _selectedNodeId);
    if (primary > 0) siblings.unshift(siblings.splice(primary, 1)[0]);
    if (siblings.length > 1) _selectMany(siblings);
    return;
  }

  if (!mod && !e.altKey && lower === 'f') {
    // Frame the selection (or the whole game): the editor zooms and scrolls the frame to it.
    e.preventDefault();
    const r = _selectedElement ? _selectionRect() : document.documentElement.getBoundingClientRect();
    ipcRenderer.sendToHost('editor-zoom-viewport', { frame: { left: r.left, top: r.top, width: r.width, height: r.height } });
    return;
  }

  if (key === '?' && !mod) {
    e.preventDefault();
    _toggleShortcutSheet();
    return;
  }

  if (key === 'Escape' && _shortcutSheet) {
    e.preventDefault();
    _toggleShortcutSheet();
    return;
  }

  if (key === 'Escape' && !_contextMenu && _selectedNodeId) {
    // Bubbles on: the three bridge clears its own selection on Escape.
    e.preventDefault();
    _hideSelection();
    _lastHoverNodeId = null;
    return;
  }

  if (arrow && !mod && !e.altKey) {
    if (_nudgeSelection(key, e.shiftKey)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }
});

// --- Shortcut sheet (press ?) ---
// The gestures that have no button — Alt-click, Cmd-drag, Space — written down where the
// user is looking. Any key or click closes it.
let _shortcutSheet = null;
const _SHORTCUTS = [
  ['Click', 'Select the topmost node'],
  ['Alt-click', 'Select the node underneath (repeat to go deeper)'],
  ['Shift-click', 'Add to / remove from the selection'],
  ['⌘-drag', 'Box select'],
  ['Drag', 'Move · drag a layout child to reorder it'],
  ['⇧ while dragging', 'Lock to one axis · keep aspect · snap 15°'],
  ['⌘ while dragging', 'Place freely (no smart guides)'],
  ['← ↑ → ↓', 'Nudge 1 px · with ⇧ 10 px'],
  ['⌘D', 'Duplicate'],
  ['⌘C · ⌘V · ⌘X · ⌫', 'Copy · paste · cut · delete'],
  ['⌘A', 'Select the siblings'],
  ['⌘Z · ⇧⌘Z', 'Undo · redo'],
  ['Space-drag', 'Pan the zoomed preview'],
  ['⌘+ · ⌘− · ⌘0 · ⌘-scroll', 'Zoom in · out · reset · toward the pointer'],
  ['F', 'Frame the selection (or the whole game)'],
  ['Esc', 'Deselect']
];

function _toggleShortcutSheet() {
  if (_shortcutSheet) {
    _shortcutSheet.remove();
    _shortcutSheet = null;
    return;
  }
  _injectSelectionStyles();
  const el = document.createElement('div');
  el.className = 'xg-context-menu xg-sheet';
  const maxH = (window.innerHeight / _docZoom() - 24 * _uiK) / _uiK;
  Object.assign(el.style, { left: '50%', top: '50%', transformOrigin: '50% 50%', transform: 'translate(-50%, -50%) scale(var(--xg-k, 1))', maxWidth: '420px', minWidth: '360px', maxHeight: Math.max(160, maxH) + 'px', overflowY: 'auto', padding: '10px 6px' });
  el.innerHTML = '<div class="xg-cm-section">Edit mode shortcuts</div>' + _SHORTCUTS.map(([k, v]) =>
    '<div class="xg-cm-row" style="cursor:default"><span class="xg-cm-meta" style="min-width:120px;color:rgba(255,255,255,0.9);font-size:11px">' + k +
    '</span><span class="xg-cm-label" style="white-space:normal">' + v + '</span></div>').join('');
  document.body.appendChild(el);
  _shortcutSheet = el;
  const close = () => { if (_shortcutSheet === el) _toggleShortcutSheet(); document.removeEventListener('mousedown', close, true); };
  setTimeout(() => document.addEventListener('mousedown', close, true), 0);
}

// Arrow keys nudge the selection 1px, Shift 10px, in the element's own pixels. A run of
// presses is one undo entry.
let _pixiNudging = false;

function _nudgeSelection(key, big) {
  const step = big ? 10 : 1;
  const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
  const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;
  if (!dx && !dy) return false;

  if (_selectedElement && _selectedNodeId) {
    if (!(_selectedCaps && _selectedCaps.movable)) {
      if (_selectedCaps && _selectedCaps.moveReason) _flashBlocked(_selectedCaps.moveReason);
      return true;
    }
    const nodeId = _selectedNodeId;
    makeEditorAPIRequest('viewportGesture', {
      label: 'Nudge element',
      coalesce: 'nudge:' + nodeId,
      targets: [_gestureTarget('move', { deltaX: dx, deltaY: dy })]
    }, (res) => {
      const blocked = res && res.blocked && res.blocked[0];
      if (blocked && _selectedNodeId === nodeId) _flashBlocked(blocked.reason);
    });
    return true;
  }

  const pixi = window.__PIXI_EDIT_BRIDGE;
  if (pixi && typeof pixi.nudgeSelected === 'function' && typeof pixi.getSelectedNodeId === 'function' && pixi.getSelectedNodeId()) {
    _pixiNudging = true;
    try { return !!pixi.nudgeSelected(dx, dy); } finally { _pixiNudging = false; }
  }
  return false;
}

// Read-only snapshot of the edit overlay's state, for tests driving it over CDP.
window.__XgeniaEditDebug = () => ({
  enabled: _inspectorEnabled,
  selected: _selectedNodeId,
  extras: _extras.map((x) => x.nodeId),
  caps: _selectedCaps,
  dragging: _isDragging, resizing: _isResizing, rotating: _isRotating,
  settling: _settling, marquee: !!_marquee, panning: !!_panning,
  pickedByPress: _pickedByPress,
  suppressClickMs: Math.max(0, _suppressClickUntil - _now()),
  hidden: [..._hiddenIds], locked: [..._lockedIds],
  clock: { installed: _clock.installed, paused: _clock.paused, speed: _clock.speed, held: _clock.held.length },
  safe: _safeMode
});

// Expose Inspector API
window.XgeniaEditorInspectorAPI = {
  /** Hierarchy panel eye/lock state: { hidden: [nodeId], locked: [nodeId] }. */
  setEditorVisibility: (v) => {
    _hiddenIds = new Set((v && v.hidden) || []);
    _lockedIds = new Set((v && v.locked) || []);
    _applySceneVisibilityStyle();
    if (_selectedNodeId && (_hiddenIds.has(_selectedNodeId))) _hideSelection();
  },
  // Whether the inspector is currently on. Read by the editor before it switches
  // the inspector on for a one-off pick (Publish → telemetry form → "Select from
  // UI"), so it can put it back the way it found it afterwards.
  isEnabled: () => _inspectorEnabled,
  setEnabled: (enabled) => {
    console.log('[Inspector] setEnabled called:', enabled);
    _inspectorEnabled = enabled; // Gate zoom handlers to edit mode only
    _applySceneVisibilityStyle();

    if (enabled) {
      // Enable inspector mode
      document.body.style.cursor = 'crosshair';
      _createOverlayElements();

      // --- Hover handler ---
      const mouseMoveHandler = (e) => {
        if (_contextMenu && _contextMenu.contains(e.target)) return;
        // Skip if a gesture is in progress (those run via _globalMouseMove)
        if (_isDragging || _isResizing || _isRotating) return;

        // Gizmo cursors, hot states and action tooltips around the selection.
        // Every control answers on hover: what it does, before it is touched.
        const p = _pt(e);
        if (_selectedElement) {
          const axis = _axisArrowAtPoint(p.x, p.y);
          const caps = _effectiveCaps();
          const handle = (caps && caps.resizable)
            ? _handleAtPoint(p.x, p.y) : null;
          if (_isOnRotateHandle(p.x, p.y)) {
            document.body.style.cursor = 'grab';
            _setHotZone('rotate');
            _showActionTip('rotate', p.x, p.y);
          } else if (axis) {
            document.body.style.cursor = axis === 'x' ? 'ew-resize' : 'ns-resize';
            _setHotZone(axis);
            _showActionTip(axis, p.x, p.y);
          } else if (handle) {
            document.body.style.cursor = handle + '-resize';
            _setHotZone(handle);
            _showActionTip('resize', p.x, p.y);
          } else if (_isInsideSelection(p.x, p.y) && !_bridgeOwns(e.target)) {
            document.body.style.cursor = (caps && caps.movable) ? 'move' : 'crosshair';
            _setHotZone(null);
            if (caps && caps.movable) {
              _showActionTip('move', p.x, p.y);
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
        if (element.closest(_CHROME_SELECTOR)) return;

        // A bridge canvas (pixi sprites, 3D) reports its own hover; the DOM node under it is
        // only the Stage.
        if (_bridgeOwns(element)) return;
        e.stopPropagation();

        // No pre-selection highlight: selection chrome appears on click only.
        // The editor is still told what is under the cursor — once per node, not per pixel:
        // every message repaints the node graph.
        const hovered = _pickNodeAt(e.clientX, e.clientY);
        const xgeniaNode = hovered ? hovered.nodeId : null;
        if (xgeniaNode === _lastHoverNodeId) return;
        _lastHoverNodeId = xgeniaNode;
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
        if (_contextMenu && _contextMenu.contains(e.target)) return;
        // Align bar buttons are handled here, in capture: a listener on the button itself would
        // be starved by anything that stops propagation at the document.
        const alignBtn = e.target && e.target.closest && e.target.closest('.xg-align-bar [data-align]');
        const actBtn = e.target && e.target.closest && e.target.closest('.xg-align-bar [data-act]');
        const anchorCell = e.target && e.target.closest && e.target.closest('.xg-anchor-pop [data-anchor]');
        if (alignBtn || actBtn || anchorCell || (e.target && e.target.closest && e.target.closest('.xg-align-bar, .xg-anchor-pop'))) {
          e.preventDefault();
          e.stopPropagation();
          if (alignBtn) _alignSelection(alignBtn.getAttribute('data-align'));
          else if (actBtn) _singleBarAction(actBtn.getAttribute('data-act'));
          else if (anchorCell) _applyAnchor(anchorCell.getAttribute('data-anchor'));
          return;
        }
        // The click that ends a drag, box select or pan is not a selection.
        if (_now() < _suppressClickUntil) {
          _suppressClickUntil = 0;
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        // The pixi/three bridges pick sprites and 3D objects on their own canvas. Selecting
        // the DOM node under it here (the Stage) overwrote that pick on every click.
        if (_bridgeOwns(e.target)) return;

        // The topmost node under the pointer that is not locked or hidden.
        const picked = _pickNodeAt(e.clientX, e.clientY);
        let nodeId = picked ? picked.nodeId : null;
        let foundElement = picked ? picked.el : null;

        if (nodeId && nodeId !== 'none') {
          e.preventDefault();
          e.stopPropagation();

          // Alt-click: the node beneath the selected one at this point — click again to keep
          // going down the stack (a label inside a button inside a panel).
          if (e.altKey && _selectedNodeId) {
            const stack = _nodeIdsAtPoint(e.clientX, e.clientY);
            const at = stack.indexOf(_selectedNodeId);
            if (stack.length > 1 && at !== -1) {
              const nextId = stack[(at + 1) % stack.length];
              const nextEl = document.querySelector('[data-xgenia-node-id="' + nextId + '"]');
              if (nextEl) { nodeId = nextId; foundElement = nextEl; }
            }
          }

          // Frame the node's own element, not the inner span the pointer happened to hit.
          foundElement = _nodeElementFor(foundElement, nodeId) || foundElement;

          // Already picked on mousedown (_pickAndPress): nothing more to do.
          const pickedByPress = _pickedByPress;
          _pickedByPress = null;
          if (pickedByPress === nodeId && !e.shiftKey && !e.altKey && _selectedNodeId === nodeId) return;

          // Shift-click adds the node to the selection, or takes it out.
          if (e.shiftKey && _selectedNodeId && _selectedElement) {
            _bridgesClearSelection();
            if (_toggleMember(nodeId, foundElement)) _syncSelectionToEditor();
            return;
          }

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
          _bridgesClearSelection();
          _showSelection(foundElement, nodeId, nodeLabel);

          const positionData = {
            nodeId: nodeId,
            nodeLabel: nodeLabel,
            clickX: e.clientX,
            clickY: e.clientY,
            // Window pixels, like clickX/Y: the host positions the inline chat with them.
            elementRect: elementRect ? {
              left: elementRect.left * _docZoom(),
              top: elementRect.top * _docZoom(),
              width: elementRect.width * _docZoom(),
              height: elementRect.height * _docZoom()
            } : null
          };

          ipcRenderer.sendToHost('inspector-node-selected', positionData);

          makeEditorAPIRequest('inspectNodes', { nodeIds: [nodeId] }, () => {
            console.log('[Inspector] Node selected:', nodeId);
          });
        } else {
          // Clicked on empty space — deselect
          _hideSelection();
          _lastHoverNodeId = null;
        }
      };

      // --- Double-click: add the topmost node to the chat as a reference ---
      const dblclickHandler = (e) => {
        if (_contextMenu && _contextMenu.contains(e.target)) return;
        const bridgeNodeId = _bridgeOwns(e.target) ? _bridgeSelectedNodeId() : null;
        const nodeIds = bridgeNodeId ? [bridgeNodeId] : _nodeIdsAtPoint(e.clientX, e.clientY);
        if (!nodeIds.length) return;
        e.preventDefault();
        e.stopPropagation();
        makeEditorAPIRequest('viewportNodeInfo', { nodeIds: [nodeIds[0]] }, (res) => {
          const info = res && Array.isArray(res.nodes) ? res.nodes[0] : null;
          if (info) _referenceNodeInChat(info);
        });
      };

      // --- Right-click: context menu to reference nodes in the chat ---
      const contextmenuHandler = (e) => {
        if (e.target && e.target.closest && e.target.closest('.xg-context-menu')) return;
        const nodeIds = _nodeIdsAtPoint(e.clientX, e.clientY);
        const p = _pt(e);
        // Always swallow in Edit mode: the game's own right-click handling is not
        // what an editor right-click means.
        e.preventDefault();
        if (_bridgeOwns(e.target)) {
          // The bridge's own listener (target phase, after this one) hit-tests sprites and
          // opens the menu for one. Only an empty spot on its canvas falls back to ours.
          const seq = _gizmoContextSeq;
          setTimeout(() => { if (_gizmoContextSeq === seq) _openContextMenu(nodeIds, p.x, p.y); }, 0);
          return;
        }
        e.stopPropagation();
        _openContextMenu(nodeIds, p.x, p.y);
      };

      // --- Mousedown handler: entry point for rotate, axis-move, edge-resize
      // and free drag. Affordances are capability-gated (viewportCapabilities)
      // so nothing is offered that the resolver would refuse; the resolver
      // still fails closed if state changed between fetch and gesture.
      const mousedownHandler = (e) => {
        // Keyboard focus follows the pointer into the preview. Gestures preventDefault their
        // mousedown, which also stops the browser moving focus here — so after typing in the
        // Properties panel, arrow-key nudges, Escape and Space still went to the editor.
        if (document.activeElement === document.body || !document.hasFocus()) {
          try { window.focus(); } catch (err) { /* ignore */ }
        }
        if (e.target && e.target.closest && e.target.closest('.xg-align-bar, .xg-anchor-pop')) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        // Space-drag or the middle button pans the zoomed preview.
        if (e.button === 1 || (e.button === 0 && _spaceHeld)) {
          _startPan(e);
          return;
        }
        if (e.button !== 0) return;
        if (_contextMenu && _contextMenu.contains(e.target)) return;
        const p = _pt(e);
        if (_isOnRotateHandle(p.x, p.y)) {
          _startRotate(e);
          return;
        }
        const axis = _axisArrowAtPoint(p.x, p.y);
        if (axis) {
          _startDrag(e);
          _dragAxis = axis;
          return;
        }
        if (_selectedCaps && _selectedCaps.resizable) {
          const handle = _handleAtPoint(p.x, p.y);
          if (handle) {
            _startResize(e, handle);
            return;
          }
        }
        // Inside a bridge canvas a press picks or drags a sprite; the selected DOM node there
        // is the Stage, which still moves by its arrows and handles above.
        if (_bridgeOwns(e.target)) return;
        // Box select: Cmd/Ctrl-drag anywhere, or a drag that starts on no node at all. (A game
        // fills its screen with a background node, so the modifier is the usual way in.)
        const onNode = !!_pickNodeAt(e.clientX, e.clientY);
        if ((e.metaKey || e.ctrlKey) || !onNode) {
          _startMarquee(e);
          return;
        }
        // A press drags the selection only ON the selection — a label inside the selected
        // button counts, a different node lying over a selected background does not. With the
        // background selected, pressing the spin button used to drag the background.
        const hit = _pickNodeAt(e.clientX, e.clientY);
        const onSelection = _isInsideSelection(p.x, p.y) &&
          (!hit || _members().some((m) => m.nodeId === hit.nodeId || m.el.contains(hit.el)));
        if (!onSelection && hit && !e.shiftKey && !e.altKey) {
          // Pick the node under the pointer now (Unity) and let a drag that follows move it (Figma).
          _pickAndPress(hit, e);
          return;
        }
        if (onSelection) {
          const caps = _effectiveCaps();
          if (caps && caps.movable) {
            _startDrag(e);
            _dragAxis = null;
          } else if (caps && caps.moveReason === 'in-flow' && !_isMulti()) {
            _startReorder(e);
          } else if (caps && caps.moveReason) {
            _flashBlocked(caps.moveReason);
          }
        }
        // Otherwise fall through: clickHandler does selection/deselection.
      };

      // Attach all listeners
      document.addEventListener('mousemove', mouseMoveHandler, true);
      document.addEventListener('click', clickHandler, true);
      document.addEventListener('dblclick', dblclickHandler, true);
      document.addEventListener('contextmenu', contextmenuHandler, true);
      document.addEventListener('mousedown', mousedownHandler, true);
      document.addEventListener('mousemove', _globalMouseMove, true);
      document.addEventListener('mouseup', _globalMouseUp, true);
      for (const type of _GAME_POINTER_EVENTS) document.addEventListener(type, _blockGamePointer, true);

      // No separate handle listeners needed — mousedownHandler handles resize

      // Store handlers for cleanup
      window._inspectorMouseHandler = mouseMoveHandler;
      window._inspectorClickHandler = clickHandler;
      window._inspectorDblclickHandler = dblclickHandler;
      window._inspectorContextmenuHandler = contextmenuHandler;
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

      // --- three.js Editing Bridge IPC ---
      // Same shape as the pixi bridge above. A 3D move reports three world coordinates rather
      // than x/y, so it carries its own gesture kind through to TransformCommandResolver.
      window.__THREE_EDIT_BRIDGE?.setEditMode?.(true);
      window.__THREE_EDIT_CALLBACK = (channel, data) => {
        try {
          if (channel === 'three-select-node') {
            _hideSelection();
            hideHighlight();
            makeEditorAPIRequest('inspectNodes', { nodeIds: [data.nodeId] }, () => {
              console.log('[Inspector] 3D node selected:', data.nodeId);
            });
          } else if (channel === 'three-deselect-node') {
            // nothing to do
          } else if (channel === 'three-transform-node') {
            if (!data.commit) return;
            var g3 = data.gesture || 'move';
            var label3 = g3 === 'rotate' ? 'Rotate 3D object'
              : g3 === 'scale' ? 'Scale 3D object' : 'Move 3D object';
            makeEditorAPIRequest('viewportGesture', {
              label: label3,
              targets: [{
                nodeId: data.nodeId,
                kind: 'three',
                gesture: g3,
                posX: data.posX, posY: data.posY, posZ: data.posZ,
                rotX: data.rotX, rotY: data.rotY, rotZ: data.rotZ,
                scaleX: data.scaleX, scaleY: data.scaleY, scaleZ: data.scaleZ
              }]
            }, () => { });
          }
        } catch (e) {
          console.error('[Preload] Error in ThreeEdit callback:', e);
        }
      };

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
              label: _pixiNudging ? 'Nudge sprite' : gesture === 'move' ? 'Move sprite'
                : gesture === 'resize' ? 'Resize sprite' : 'Rotate sprite',
              coalesce: _pixiNudging ? 'nudge:' + data.nodeId : undefined,
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
      if (window._inspectorContextmenuHandler) {
        document.removeEventListener('contextmenu', window._inspectorContextmenuHandler, true);
        window._inspectorContextmenuHandler = null;
      }
      if (window._inspectorMousedownHandler) {
        document.removeEventListener('mousedown', window._inspectorMousedownHandler, true);
        window._inspectorMousedownHandler = null;
      }
      document.removeEventListener('mousemove', _globalMouseMove, true);
      document.removeEventListener('mouseup', _globalMouseUp, true);
      for (const type of _GAME_POINTER_EVENTS) document.removeEventListener(type, _blockGamePointer, true);

      // Clean up all overlays
      _cleanupOverlays();
      _lastHoverNodeId = null;

      // Clean up PixiJS bridge callback, and take the gizmo overlay down with it — leaving it
      // behind is how a preview-mode click ends up dragging a sprite.
      window.__PIXI_EDIT_BRIDGE?.setEditMode?.(false);
      window.__PIXI_EDIT_CALLBACK = null;
      window.__THREE_EDIT_BRIDGE?.setEditMode?.(false);
      window.__THREE_EDIT_CALLBACK = null;

      console.log('[Inspector] Interactive editing disabled');
    }

    // The viewer's legacy Inspector (window.setInspectorEnabled) is deliberately NOT switched
    // on any more — see _blockGamePointer. Switching it off is still passed on, so a viewer
    // that had it enabled before this preload took over lets go of it.
    if (!enabled && typeof window.setInspectorEnabled === 'function') {
      try {
        window.setInspectorEnabled(false);
      } catch (e) {
        console.error('[Preload Viewer] Error disabling legacy inspector:', e);
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

let _pendingSelectId = null; // editor-selected node not rendered yet

// Expose Highlight API
window.XgeniaEditorHighlightAPI = {
  /** The editor's scale of this frame on screen; chrome divides it out (see _uiK). */
  setFrameScale: (scale) => {
    const s = Number(scale);
    const k = s > 0 && isFinite(s) ? Math.min(8, Math.max(0.125, 1 / s)) : 1;
    if (k === _uiK) return;
    _uiK = k;
    // The handles' hover pop is a transform transition; a zoom must not animate through it.
    const root = document.documentElement;
    root.classList.add('xg-rezoom');
    root.style.setProperty('--xg-k', String(k));
    if (_selectionOverlay) getComputedStyle(_selectionOverlay.firstChild || _selectionOverlay).transform; // apply now
    root.classList.remove('xg-rezoom');
    _trackedRect = null; // re-place badges and bars on the next tracking frame
    if (_safeMode !== 'off') _renderSafeArea();
  },
  selectNode: (nodeId) => {
    console.log('[HighlightAPI] selectNode:', nodeId);

    // The editor echoes a selection made here — with one id, or none while several nodes are
    // selected. Neither should collapse a multi-selection.
    const ownEcho = _now() < _ignoreEditorSelectionUntil;
    if (_isMulti() && (ownEcho || !nodeId || _members().some((m) => m.nodeId === nodeId))) return;

    if (!nodeId) {
      if (ownEcho) return;
      _hideSelection();
      _bridgesClearSelection();
      return;
    }

    // Selection made here comes back from the editor; it is already showing.
    if (nodeId === _selectedNodeId && _selectedElement && _selectedElement.isConnected) return;

    // Find the DOM element for this node
    const element = document.querySelector(`[data-xgenia-node-id="${nodeId}"]`);
    if (element) {
      const label = element.getAttribute('data-xgenia-node-label') || nodeId;
      _bridgesClearSelection();
      _showSelection(element, nodeId, label);
    } else if (_inspectorEnabled && _bridgesSelect(nodeId)) {
      // A sprite or 3D object picked in the graph: its bridge draws the gizmo.
      _hideSelection();
    } else {
      // Nothing on screen for this node (logic, maths, a sound): the frame must not stay on
      // whatever was selected before.
      _hideSelection();
      _bridgesClearSelection();
      // ...or nothing on screen YET: a node just created (Cmd+D, paste, the AI) is selected
      // before it has rendered. Give it a moment to mount, then frame it.
      _pendingSelectId = nodeId;
      let tries = 0;
      const retry = () => {
        if (_pendingSelectId !== nodeId || _selectedNodeId || ++tries > 12) return;
        const el = document.querySelector('[data-xgenia-node-id="' + nodeId + '"]');
        if (el) {
          _pendingSelectId = null;
          _showSelection(el, nodeId, el.getAttribute('data-xgenia-node-label') || nodeId);
        } else setTimeout(retry, 100);
      };
      setTimeout(retry, 100);
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

// The controls live in the editor's top bar (an overlay here covered the game's own corner
// UI — a slot's balance display sits exactly there); this is what they call.
window.XgeniaEditorTimeAPI = {
  getState: () => ({ paused: _clock.paused, speed: _clock.speed, safe: _safeMode }),
  setPaused: (p) => { _setPaused(!!p); return window.XgeniaEditorTimeAPI.getState(); },
  step: () => { _stepFrame(); return window.XgeniaEditorTimeAPI.getState(); },
  setSpeed: (v) => { const n = Number(v); if (n > 0 && n <= 8) _setSpeed(n); return window.XgeniaEditorTimeAPI.getState(); },
  setSafeArea: (mode) => {
    if (_SAFE_MODES.indexOf(mode) !== -1) { _safeMode = mode; _renderSafeArea(); }
    return window.XgeniaEditorTimeAPI.getState();
  },
  listStates: () => _runtimeStatesNodes().map((n, index) => ({
    index, label: String(_statesLabel(n)), states: n._internal.states.slice(), current: n._internal.state || null
  })),
  goToState: (index, state, jump) => { _goToRuntimeState(index, state, !!jump); return true; }
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
