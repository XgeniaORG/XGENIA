import { ipcRenderer } from 'electron';
import React from 'react';
import { createRoot, Root } from 'react-dom/client';

import { EventDispatcher } from '../../../../shared/utils/EventDispatcher';
import View from '../../../../shared/view';
import { InlineElementChat } from './InlineElementChat';
import { VisualCanvas } from './VisualCanvas';

/**
 * Chatter from the running preview, off by default.
 *
 * 2026-08-12 perf audit: every `console-message` the preview emitted and every
 * `ipc-message` it sent was logged here unconditionally, the IPC one twice and
 * the second time as a whole object literal. A preview that logs per frame — a
 * spinning slot, say — therefore paid a console write per frame IN THE EDITOR's
 * renderer, and objects logged to a console are retained rather than collected
 * while DevTools is attached. Set `localStorage.xgeniaDebugWebview = '1'` and
 * reload to get it back.
 */
const DEBUG_WEBVIEW = (() => {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('xgeniaDebugWebview') === '1';
  } catch {
    return false;
  }
})();

// Interface for the thumbnail capture result
interface ThumbnailResult {
  width: number;
  height: number;
  toDataURL(format?: string, quality?: number): string;
}

export class CanvasView extends View {
  // Keep a reference to our React root so we can re-render and unmount properly
  private _reactRoot: Root | null = null;
  private _lastCaptureTime: number = 0;

  webview: Electron.WebviewTag | null = null;
  webviewDomReady: boolean = false;

  zoomFactor: number;

  viewportWidth: number;
  viewportHeight: number;

  inspectMode: boolean = false;
  selectedNodeId: string | null = null;

  // Inline chat state
  private _inlineChatRoot: Root | null = null;
  private _currentInlineChat: {
    nodeId: string;
    nodeLabel: string;
    position: { x: number; y: number };
  } | null = null;

  props: {
    deviceName?: string;
    zoom: number;
    onWebView: (webview: Electron.WebviewTag) => void;
    onReloadWebview?: () => void;
  } = {
      zoom: 1,
      onWebView: (webview: Electron.WebviewTag) => {
        console.log('[CanvasView] onWebView callback called with webview:', !!webview);
        if (webview && !this.webview && !this.webviewSetupComplete) {
          this._setupWebview(webview);
        }
      }
    };

  onNavigationStateChanged: ({
    route,
    canGoBack,
    canGoForward
  }: {
    route: string;
    canGoBack: boolean;
    canGoForward: boolean;
  }) => void;

  private pendingRoute: string | null = null;
  private bridgeLoaded = false;
  private loadAttempts: number = 0;
  private isNavigating: boolean = false;
  private navigationTimeout: NodeJS.Timeout | null = null;
  private webviewSetupComplete: boolean = false;

  // Store reference to react container for direct access
  private reactContainer: HTMLElement | null = null;

  constructor({ onNavigationStateChanged }) {
    super();

    this.zoomFactor = 1;
    this.viewportWidth = null;
    this.viewportHeight = null;

    // Bind the onWebView callback to this instance
    this.props.onWebView = (webview: Electron.WebviewTag) => {
      console.log('[CanvasView] onWebView callback called with webview:', !!webview);
      if (webview && !this.webview && !this.webviewSetupComplete) {
        this._setupWebview(webview);
      }
    };

    this.onNavigationStateChanged = (state) => {
      onNavigationStateChanged(state);
      window.xgeniaEditorPreviewRoute = state.route.substring(0, state.route.indexOf('?'));
      EventDispatcher.instance.emit('viewer-navigated', state.route);
    };

    // Removed process.on('uncaughtException') listener to prevent memory leaks
    // Global exception handling should be done at the application level, not per component

    // Store handler for cleanup
    this.htmlRequestHandler = async (e: any) => {
      // If this instance is disposed (no webview), ignore the request completely
      // This prevents zombie instances from replying with failures
      if (!this.webview) {
        return;
      }

      console.log('[CanvasView] ⚡ Received local xgenia-get-html-request-v2');

      if (!this.webviewDomReady) {
        console.error('[CanvasView] Webview not ready for HTML extraction (local event)');
        window.dispatchEvent(new CustomEvent('xgenia-get-html-reply-v2', {
          detail: { success: false, error: 'Webview not ready' }
        }));
        return;
      }

      try {
        const resultStr = await this.webview.executeJavaScript(`
          (function() {
            try {
              return JSON.stringify({
                success: true,
                html: document.documentElement.outerHTML,
                url: window.location.href,
                title: document.title,
                timestamp: new Date().toISOString()
              });
            } catch (error) {
              return JSON.stringify({ success: false, error: error.message });
            }
          })();
        `);
        const result = JSON.parse(resultStr);
        console.log('[CanvasView] HTML extracted (local event), dispatching reply');
        window.dispatchEvent(new CustomEvent('xgenia-get-html-reply-v2', { detail: result }));
      } catch (error: any) {
        console.error('[CanvasView] HTML extraction failed (local event):', error);
        window.dispatchEvent(new CustomEvent('xgenia-get-html-reply-v2', {
          detail: { success: false, error: error.message }
        }));
      }
    };

    // Add global listener for HTML extraction request (for embedded usage without main process restart)
    window.addEventListener('xgenia-get-html-request-v2', this.htmlRequestHandler);
  }

  private htmlRequestHandler: (e: any) => void;

  // Method to setup the webview
  _setupWebview(webview: Electron.WebviewTag): void {
    if (this.webviewSetupComplete) {
      console.log('[CanvasView] Webview already set up, skipping');
      return;
    }

    console.log('[CanvasView] Setting up webview');
    this.webview = webview;
    this.webviewSetupComplete = true;

    // Expose webview to AI tools via NodeGraphContextTmp
    try {
      const { NodeGraphContextTmp } = require('@xgenia-contexts/NodeGraphContext/NodeGraphContext');
      NodeGraphContextTmp.webview = webview;
      console.log('[CanvasView] ✅ Exposed webview to NodeGraphContextTmp for AI tools');
    } catch (e: any) {
      console.warn('[CanvasView] Could not expose webview to NodeGraphContextTmp:', e);
    }

    webview.addEventListener('did-start-loading', () => {
      console.log('[CanvasView] Webview started loading');

      // Enable @electron/remote for this webview as soon as it starts loading
      // Note: This is optional and may not work in newer Electron versions
      try {
        const electron = require('electron');
        if (electron?.remote && electron?.webContents) {
          const remoteMain = electron.remote.require('@electron/remote/main');
          const webviewContents = electron.webContents.fromId(webview.getWebContentsId());
          if (webviewContents && remoteMain?.enable) {
            remoteMain.enable(webviewContents);
            console.log('[CanvasView] Enabled @electron/remote for webview');
          }
        }
        // Silently skip if remote isn't available - it's not required for core functionality
      } catch (error: any) {
        // @electron/remote is optional - webview works fine without it
        console.log('[CanvasView] @electron/remote not available (this is OK)');
      }
    });

    webview.addEventListener('did-stop-loading', () => {
      console.log('[CanvasView] Webview stopped loading');
      this.isNavigating = false;
      this.clearNavigationTimeout();
    });

    webview.addEventListener('did-finish-load', () => {
      console.log('[CanvasView] Webview finished loading');
      this.isNavigating = false;
      this.clearNavigationTimeout();
      this.checkContentLoaded();
    });

    webview.addEventListener('did-fail-load', (event) => {
      console.error('[CanvasView] Webview failed to load:', event);
      this.isNavigating = false;
      this.clearNavigationTimeout();
      this.loadAttempts++;

      if (this.loadAttempts < 3) {
        console.log(`[CanvasView] Retrying load attempt ${this.loadAttempts}/3`);
        this.tryAlternativeLoading();
      } else {
        console.log('[CanvasView] Max load attempts reached, showing fallback');
        this.loadFallbackContent();
      }
    });

    webview.addEventListener('dom-ready', () => {
      console.log('[CanvasView] Webview DOM ready');
      this.webviewDomReady = true;

      // NO IPC message handling here - that's handled by editorapi.js
      // This keeps the architecture clean and avoids conflicts

      // Process pending route if available
      if (this.pendingRoute) {
        console.log('[CanvasView] Processing pending route:', this.pendingRoute);
        const route = this.pendingRoute;
        this.pendingRoute = null;
        this.setCurrentRoute(route);
      }
    });

    if (DEBUG_WEBVIEW) {
      webview.addEventListener('console-message', (e) => {
        console.log('[Webview Console]', e.message);
      });
    }

    // Listen for inspector messages from the webview
    webview.addEventListener('ipc-message', (event: any) => {
      const message = event.args && event.args[0];
      if (DEBUG_WEBVIEW) {
        console.log('[CanvasView] 📨 IPC message received - Channel:', event.channel, 'Message:', message);
        console.log('[CanvasView] 📨 Full event:', { channel: event.channel, args: event.args, type: typeof event });
      }

      if (event.channel === 'inspector-node-found') {
        console.log('[CanvasView] Inspector found node:', message);
        // Emit event for node highlighting
        EventDispatcher.instance.emit('inspector-node-highlight', message);
      } else if (event.channel === 'inspector-node-selected') {
        console.log('[CanvasView] 🎯 RECEIVED inspector-node-selected from webview:', JSON.stringify(message, null, 2));

        if (!message || !message.nodeId) {
          console.error('[CanvasView] ❌ Invalid inspector-node-selected message:', message);
          return;
        }

        // CRITICAL: Emit inspectNodes event to trigger node selection in editor
        // This is what EditorDocument listens for to select nodes
        EventDispatcher.instance.emit('inspectNodes', { nodeIds: [message.nodeId] });

        // Single click selects ONLY. The inline chat popup used to open here
        // on every click; a node now reaches the chat via double-click, as a
        // reference (see inspector-node-dblclick below).
      } else if (event.channel === 'inspector-node-dblclick') {
        // Double-click: hand the node to the chat panel as a reference.
        if (message && message.nodeId) {
          EventDispatcher.instance.emit('chat-add-node-reference', {
            nodeId: message.nodeId,
            nodeLabel: message.nodeLabel || 'Element'
          });
        }
      } else if (event.channel === 'editor-zoom-viewport') {
        // Canvas zoom — only in edit mode (inspect mode)
        if (!this.inspectMode) return; // Ignore zoom in preview mode
        if (message) {
          if (message.reset) {
            this.zoomFactor = 1;
          } else if (message.delta) {
            this.zoomFactor = Math.min(5, Math.max(0.1, this.zoomFactor + message.delta));
          }
          // Use Chromium's native zoom — clean scaling with working scrollbars
          this.tryWebviewCall(() => (this.webview as any).setZoomFactor(this.zoomFactor));
          this.props.zoom = this.zoomFactor;
        }
      }
    });

    webview.addEventListener('load-commit', (event) => {
      if (event.isMainFrame === false) {
        return;
      }

      const protocol = process.env.ssl ? 'https://' : 'http://';
      const port = process.env.NOODLPORT || 8574;
      const urlPrefix = protocol + 'localhost:' + port;

      const route = event.url.startsWith(urlPrefix) ? event.url.substring(urlPrefix.length) : event.url;

      this.onNavigationStateChanged &&
        this.onNavigationStateChanged({ route, canGoBack: webview.canGoBack(), canGoForward: webview.canGoForward() });
    });
  }

  // Simplified loading - no data URIs
  showSimpleLoadingMessage(): void {
    console.log('[CanvasView] showSimpleLoadingMessage called');
    if (!this.webview) {
      console.log('[CanvasView] No webview available for simple loading message');
      return;
    }

    try {
      // Use a simple about:blank to avoid ERR_ABORTED
      this.webview.src = 'about:blank';
      console.log('[CanvasView] Set webview to about:blank');
    } catch (error: any) {
      console.error('[CanvasView] Error showing simple loading message:', error);
    }
  }

  // Simplified loading - direct URL load only
  showLoadingMessage(): void {
    console.log('[CanvasView] showLoadingMessage called - using direct URL load only');
    // No data URI loading to avoid ERR_ABORTED - let setCurrentRoute handle it
  }

  resize() {
    this.updateViewportSize();
  }

  render() {
    const element = document.createElement('div');
    element.className = 'visual-canvas-container';
    element.style.cssText = `
      position: relative;
      width: 100%;
      height: 100%;
      overflow: hidden;
    `;

    // Create the React container element that renderReact() expects
    const reactContainer = document.createElement('div');
    reactContainer.id = 'visual-canvas-react';
    reactContainer.style.cssText = `
      width: 100%;
      height: 100%;
    `;
    element.appendChild(reactContainer);

    this.el = $(element);

    // HTML capture listener
    ipcRenderer.on('embedded-viewer-get-full-html-request', async (...args) => {
      console.log('[CanvasView] 📄 Received embedded-viewer-get-full-html-request');

      if (!this.webview || !this.webviewDomReady) {
        console.error('[CanvasView] Webview not ready for HTML extraction');
        ipcRenderer.send('viewer-get-full-html-reply', { success: false, error: 'Webview not ready' });
        return;
      }

      try {
        const resultStr = await this.webview.executeJavaScript(`
          (function() {
            try {
              return JSON.stringify({
                success: true,
                html: document.documentElement.outerHTML,
                url: window.location.href,
                title: document.title,
                timestamp: new Date().toISOString()
              });
            } catch (error) {
              return JSON.stringify({ success: false, error: error.message });
            }
          })();
        `);
        const result = JSON.parse(resultStr);
        console.log('[CanvasView] HTML extracted, sending reply');
        ipcRenderer.send('viewer-get-full-html-reply', result);
      } catch (error: any) {
        console.error('[CanvasView] HTML extraction failed:', error);
        ipcRenderer.send('viewer-get-full-html-reply', { success: false, error: error.message });
      }
    });

    // Keep only the screenshot capture listener - this is specific to webview functionality
    ipcRenderer.on('embedded-viewer-capture-request', async (...args) => {
      console.log('[CanvasView] 📸 Received embedded-viewer-capture-request from main process, args:', args);

      const attemptCapture = async (attemptNumber = 1, maxAttempts = 3) => {
        try {
          console.log(`[CanvasView] Screenshot attempt ${attemptNumber}/${maxAttempts}`);

          // Use our own captureThumbnail method instead of forwarding to webview
          const result = await this.captureThumbnail();

          if (result && result.toDataURL) {
            const dataURL = result.toDataURL();
            console.log('[CanvasView] Successfully captured thumbnail, sending reply');
            ipcRenderer.send('viewer-capture-thumb-reply', dataURL);
            return true;
          } else {
            console.error(`[CanvasView] Failed to capture thumbnail on attempt ${attemptNumber}`);

            // If webview isn't ready and we have more attempts, wait and retry
            if (attemptNumber < maxAttempts && (!this.webviewDomReady || !this.webview?.isConnected)) {
              console.log(`[CanvasView] Webview not ready, retrying in 2 seconds...`);
              setTimeout(() => attemptCapture(attemptNumber + 1, maxAttempts), 2000);
              return false;
            } else {
              console.error(`[CanvasView] All ${maxAttempts} screenshot attempts failed`);
              ipcRenderer.send('viewer-capture-thumb-reply', null);
              return false;
            }
          }
        } catch (error: any) {
          console.error(`[CanvasView] Error capturing thumbnail (attempt ${attemptNumber}):`, error);

          // If we have more attempts and the error might be due to webview not being ready, retry
          if (
            attemptNumber < maxAttempts &&
            (error.message.includes('webview') || error.message.includes('capturePage') || !this.webviewDomReady)
          ) {
            console.log(`[CanvasView] Retrying screenshot due to error, attempt ${attemptNumber + 1}/${maxAttempts}`);
            setTimeout(() => attemptCapture(attemptNumber + 1, maxAttempts), 2000);
            return false;
          } else {
            console.error(`[CanvasView] Final screenshot attempt failed:`, error);
            ipcRenderer.send('viewer-capture-thumb-reply', null);
            return false;
          }
        }
      };

      // Start the capture attempt
      await attemptCapture();
    });

    // Full-page screenshot capture listener (scroll-and-stitch)
    ipcRenderer.on('embedded-viewer-capture-fullpage-request', async () => {
      console.log('[CanvasView] 📸 Received embedded-viewer-capture-fullpage-request');

      if (!this.webview || !this.webviewDomReady || !this.webview.isConnected) {
        console.error('[CanvasView] Full-page capture: webview not ready');
        ipcRenderer.send('viewer-capture-fullpage-reply', null);
        return;
      }

      try {
        // 1. Get full page dimensions and current scroll position via JS in the webview
        const pageInfo = await this.webview.executeJavaScript(`
          (function() {
            const body = document.body;
            const html = document.documentElement;
            return {
              scrollWidth: Math.max(body.scrollWidth, html.scrollWidth, body.offsetWidth, html.offsetWidth, body.clientWidth, html.clientWidth),
              scrollHeight: Math.max(body.scrollHeight, html.scrollHeight, body.offsetHeight, html.offsetHeight, body.clientHeight, html.clientHeight),
              viewportWidth: window.innerWidth,
              viewportHeight: window.innerHeight,
              originalScrollX: window.scrollX,
              originalScrollY: window.scrollY,
              devicePixelRatio: window.devicePixelRatio || 1
            };
          })();
        `);

        const { scrollWidth, scrollHeight, viewportWidth, viewportHeight, originalScrollX, originalScrollY, devicePixelRatio } = pageInfo;
        console.log('[CanvasView] Full-page dimensions:', { scrollWidth, scrollHeight, viewportWidth, viewportHeight, devicePixelRatio });

        // If content fits in one viewport, just use normal capture
        if (scrollHeight <= viewportHeight && scrollWidth <= viewportWidth) {
          console.log('[CanvasView] Content fits in viewport, using normal capture');
          const result = await this.captureThumbnail();
          if (result && result.toDataURL) {
            ipcRenderer.send('viewer-capture-fullpage-reply', result.toDataURL());
          } else {
            ipcRenderer.send('viewer-capture-fullpage-reply', null);
          }
          return;
        }

        // 2. Calculate tiles needed
        const cols = Math.ceil(scrollWidth / viewportWidth);
        const rows = Math.ceil(scrollHeight / viewportHeight);
        console.log(`[CanvasView] Will capture ${cols}x${rows} = ${cols * rows} tiles`);

        // Safety cap: prevent absurdly large captures (max 50 tiles)
        if (cols * rows > 50) {
          console.warn('[CanvasView] Too many tiles needed, capping to viewport height × 10');
          const cappedHeight = viewportHeight * 10;
          const cappedRows = Math.ceil(cappedHeight / viewportHeight);
          pageInfo.scrollHeight = cappedHeight;
          // Recalculate with capped values handled below
        }

        // 3. Create offscreen canvas for stitching
        const actualPixelWidth = scrollWidth * devicePixelRatio;
        const actualPixelHeight = Math.min(scrollHeight, viewportHeight * 10) * devicePixelRatio;
        const stitchCanvas = document.createElement('canvas');
        stitchCanvas.width = actualPixelWidth;
        stitchCanvas.height = actualPixelHeight;
        const ctx = stitchCanvas.getContext('2d');

        if (!ctx) {
          console.error('[CanvasView] Failed to get 2D context for stitch canvas');
          ipcRenderer.send('viewer-capture-fullpage-reply', null);
          return;
        }

        const cappedScrollHeight = Math.min(scrollHeight, viewportHeight * 10);
        const actualRows = Math.ceil(cappedScrollHeight / viewportHeight);

        // 4. Scroll-and-capture loop
        for (let row = 0; row < actualRows; row++) {
          for (let col = 0; col < cols; col++) {
            const scrollX = col * viewportWidth;
            const scrollY = row * viewportHeight;

            // Scroll the page
            await this.webview.executeJavaScript(`window.scrollTo(${scrollX}, ${scrollY});`);

            // Brief delay for render to settle
            await new Promise(resolve => setTimeout(resolve, 150));

            // Capture this tile
            const nativeImage = await this.webview.capturePage();
            if (!nativeImage || nativeImage.isEmpty()) {
              console.warn(`[CanvasView] Empty tile at (${col},${row}), skipping`);
              continue;
            }

            // Draw tile onto stitch canvas
            const tileDataURL = nativeImage.toDataURL();
            await new Promise<void>((resolve, reject) => {
              const img = new Image();
              img.onload = () => {
                // Calculate position on the stitch canvas (in device pixels)
                const destX = col * viewportWidth * devicePixelRatio;
                const destY = row * viewportHeight * devicePixelRatio;

                // Calculate actual tile size (last row/col may be smaller)
                const tileW = Math.min(viewportWidth * devicePixelRatio, actualPixelWidth - destX);
                const tileH = Math.min(viewportHeight * devicePixelRatio, actualPixelHeight - destY);

                // Draw only the portion that fits
                ctx.drawImage(img, 0, 0, tileW, tileH, destX, destY, tileW, tileH);
                resolve();
              };
              img.onerror = () => {
                console.warn(`[CanvasView] Failed to load tile image at (${col},${row})`);
                resolve(); // Don't fail the whole capture
              };
              img.src = tileDataURL;
            });
          }
        }

        // 5. Restore original scroll position
        await this.webview.executeJavaScript(`window.scrollTo(${originalScrollX}, ${originalScrollY});`);

        // 6. Convert stitched canvas to data URL and send reply
        const fullPageDataURL = stitchCanvas.toDataURL('image/png');
        console.log(`[CanvasView] Full-page screenshot complete: ${stitchCanvas.width}x${stitchCanvas.height}, ${fullPageDataURL.length} chars`);
        ipcRenderer.send('viewer-capture-fullpage-reply', fullPageDataURL);

      } catch (error: any) {
        console.error('[CanvasView] Full-page capture failed:', error);
        ipcRenderer.send('viewer-capture-fullpage-reply', null);
      }
    });

    // Add HTML extraction IPC handler
    ipcRenderer.on('viewer-get-full-html-request', async (...args) => {
      console.log('[CanvasView] 📄 Received viewer-get-full-html-request from main process, args:', args);

      try {
        if (!this.webview) {
          console.error('[CanvasView] No webview available for HTML extraction');
          ipcRenderer.send('viewer-get-full-html-reply', { success: false, error: 'No webview available' });
          return;
        }

        if (!this.webviewDomReady) {
          console.error('[CanvasView] Webview DOM not ready for HTML extraction');
          ipcRenderer.send('viewer-get-full-html-reply', { success: false, error: 'Webview DOM not ready' });
          return;
        }

        console.log('[CanvasView] Executing JavaScript to get full webpage HTML...');

        // Execute JavaScript to get the full webpage HTML
        const resultStr = await this.webview.executeJavaScript(`
          (function() {
            try {
              return JSON.stringify({
                success: true,
                html: document.documentElement.outerHTML,
                url: window.location.href,
                title: document.title,
                timestamp: new Date().toISOString()
              });
            } catch (error) {
              return JSON.stringify({ success: false, error: error.message });
            }
          })();
        `);
        const result = JSON.parse(resultStr);

        console.log('[CanvasView] Successfully extracted HTML, length:', result.html ? result.html.length : 'unknown');
        ipcRenderer.send('viewer-get-full-html-reply', result);

      } catch (error: any) {
        console.error('[CanvasView] Error extracting HTML:', error);
        ipcRenderer.send('viewer-get-full-html-reply', {
          success: false,
          error: `Failed to extract HTML: ${error instanceof Error ? error.message : String(error)}`
        });
      }
    });

    // Add rendered output IPC handler
    ipcRenderer.on('viewer-get-rendered-output-request', async (event: any, args: { nodeId: string }) => {
      console.log('[CanvasView] 🎨 Received viewer-get-rendered-output-request from main process, args:', args);

      try {
        const { nodeId } = args;
        if (!nodeId) {
          console.error('[CanvasView] No nodeId provided for rendered output extraction');
          ipcRenderer.send('viewer-get-rendered-output-reply', { success: false, error: 'No nodeId provided' });
          return;
        }

        if (!this.webview) {
          console.error('[CanvasView] No webview available for rendered output extraction');
          ipcRenderer.send('viewer-get-rendered-output-reply', { success: false, error: 'No webview available' });
          return;
        }

        if (!this.webviewDomReady) {
          console.error('[CanvasView] Webview DOM not ready for rendered output extraction');
          ipcRenderer.send('viewer-get-rendered-output-reply', { success: false, error: 'Webview DOM not ready' });
          return;
        }

        console.log('[CanvasView] Executing JavaScript to get rendered output for nodeId:', nodeId);

        // Execute JavaScript to get rendered output for the specific node
        const result = await this.webview.executeJavaScript(`
          (function() {
            try {
              const nodeId = '${nodeId}';
              const element = document.querySelector('[data-xgenia-node-id="' + nodeId + '"]') ||
                             document.querySelector('[data-node-id="' + nodeId + '"]') ||
                             document.getElementById(nodeId);

              if (!element) {
                return { success: false, error: 'Element not found in DOM' };
              }

              const computedStyle = window.getComputedStyle(element);
              const rect = element.getBoundingClientRect();

              return {
                success: true,
                elementInfo: {
                  tagName: element.tagName,
                  id: element.id,
                  className: element.className,
                  nodeId: element.getAttribute('data-xgenia-node-id') || element.getAttribute('data-node-id'),
                  textContent: element.textContent?.substring(0, 200) || '',
                  boundingRect: {
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height,
                    top: rect.top,
                    left: rect.left
                  }
                },
                computedStyles: {
                  display: computedStyle.display,
                  position: computedStyle.position,
                  width: computedStyle.width,
                  height: computedStyle.height,
                  backgroundColor: computedStyle.backgroundColor,
                  color: computedStyle.color,
                  fontSize: computedStyle.fontSize,
                  fontFamily: computedStyle.fontFamily,
                  margin: computedStyle.margin,
                  padding: computedStyle.padding,
                  border: computedStyle.border,
                  opacity: computedStyle.opacity,
                  visibility: computedStyle.visibility,
                  zIndex: computedStyle.zIndex
                },
                html: element.outerHTML.substring(0, 1000)
              };
            } catch (error) {
              return { success: false, error: error.message };
            }
          })();
        `);

        console.log('[CanvasView] Successfully extracted rendered output for nodeId:', nodeId);
        ipcRenderer.send('viewer-get-rendered-output-reply', result);

      } catch (error: any) {
        console.error('[CanvasView] Error extracting rendered output:', error);
        ipcRenderer.send('viewer-get-rendered-output-reply', {
          success: false,
          error: `Failed to extract rendered output: ${error instanceof Error ? error.message : String(error)}`
        });
      }
    });

    // Store reference to react container for direct access
    this.reactContainer = reactContainer;

    // Delay React rendering slightly to ensure DOM is ready
    setTimeout(() => {
      this.renderReact();
    }, 0);

    return this.el;
  }

  // Separate method to render or re-render the React component into the existing root
  private renderReact() {
    console.log('[CanvasView] renderReact called');

    // Use the stored reference instead of searching the document
    const reactContainer = this.reactContainer || this.el?.[0]?.querySelector('#visual-canvas-react');
    if (!reactContainer) {
      // Not an error - this can happen during initialization when setZoom() is called
      // before render() has completed. renderReact() will be called again later.
      console.log('[CanvasView] React container not ready yet, will retry later');
      return;
    }

    // Create React root if it doesn't exist
    if (!this._reactRoot) {
      console.log('[CanvasView] Creating React root');
      this._reactRoot = createRoot(reactContainer);
    }

    console.log('[CanvasView] Rendering VisualCanvas with props:', {
      zoom: this.zoomFactor,
      deviceName: this.props.deviceName
    });

    this._reactRoot.render(
      React.createElement(VisualCanvas, {
        zoom: this.zoomFactor,
        onWebView: this.props.onWebView,
        deviceName: this.props.deviceName
      })
    );
  }

  // Fixed to prevent duplicate route setting and ERR_ABORTED
  setCurrentRoute(route: string): void {
    console.log('[CanvasView] setCurrentRoute called with route:', route);
    console.log(
      '[CanvasView] webviewDomReady:',
      this.webviewDomReady,
      'webview:',
      !!this.webview,
      'isNavigating:',
      this.isNavigating
    );

    if (!this.webviewDomReady || !this.webview) {
      console.log('[CanvasView] Webview not ready, storing route for later');
      this.pendingRoute = route;
      return;
    }

    // Prevent multiple simultaneous navigations
    if (this.isNavigating) {
      console.log('[CanvasView] Already navigating, updating pending route');
      this.pendingRoute = route;
      return;
    }

    this.clearNavigationTimeout();

    try {
      const protocol = process.env.ssl ? 'https://' : 'http://';
      const port = process.env.XGENIAPORT || 8574;
      const url = `${protocol}localhost:${port}${route}?_t=${Date.now()}`;

      console.log('[CanvasView] Loading URL directly:', url);

      this.isNavigating = true;
      this.webview.src = url;
      window.xgeniaEditorPreviewRoute = route;

      // Set timeout to reset navigation state
      this.navigationTimeout = setTimeout(() => {
        console.log('[CanvasView] Navigation timeout, resetting state');
        this.isNavigating = false;

        // Process pending route if available
        if (this.pendingRoute && this.pendingRoute !== route) {
          const nextRoute = this.pendingRoute;
          this.pendingRoute = null;
          this.setCurrentRoute(nextRoute);
        }
      }, 10000);
    } catch (error: any) {
      console.error('[CanvasView] Error setting route:', error);
      this.isNavigating = false;
    }
  }

  checkContentLoaded(): void {
    if (!this.webview) return;

    console.log('[CanvasView] Checking if content loaded properly');

    this.webview
      .executeJavaScript(
        `
        (function() {
          // More comprehensive content check
          const bodyLength = document.body ? document.body.innerHTML.length : 0;
          const hasReactRoot = !!document.querySelector('#root, #app, [data-reactroot]');
          const hasScripts = document.querySelectorAll('script').length > 0;
          const hasXgeniaContent = document.body ? document.body.innerHTML.includes('xgenia') : false;
          
          console.log('[Content Check] Body length:', bodyLength, 'React root:', hasReactRoot, 'Scripts:', hasScripts, 'XGENIA content:', hasXgeniaContent);
          
          // Content is considered loaded if we have substantial content OR React components OR XGENIA-specific content
          return bodyLength > 50 || hasReactRoot || hasXgeniaContent || hasScripts;
        })()
    `
      )
      .then((hasContent) => {
        console.log(
          '[CanvasView] Content check result:',
          hasContent ? 'Content loaded successfully' : 'No content detected'
        );
        if (!hasContent) {
          console.log('[CanvasView] Content check failed, will try alternative loading after delay');
          // Add a delay before alternative loading to avoid race conditions
          setTimeout(() => {
            this.tryAlternativeLoading();
          }, 1000);
        }
      })
      .catch((error) => {
        console.warn('[CanvasView] Error checking content (this is normal during loading):', error.message);
        // Don't trigger alternative loading on JavaScript execution errors during loading
        // This is normal when the page is still loading
      });
  }

  // Streamlined loading methods without problematic data URIs
  tryAlternativeLoading(): void {
    console.log('[CanvasView] tryAlternativeLoading called');
    if (!this.webview) {
      console.log('[CanvasView] No webview for alternative loading');
      return;
    }

    // If we have a pending route, retry it
    if (this.pendingRoute) {
      console.log('[CanvasView] Retrying pending route:', this.pendingRoute);
      const route = this.pendingRoute;
      this.pendingRoute = null;
      this.setCurrentRoute(route);
      return;
    }

    // If no pending route, try to get current route from webview
    try {
      if (this.webview.src && this.webview.src !== 'about:blank') {
        console.log('[CanvasView] Refreshing current webview URL:', this.webview.src);
        this.webview.reload();
      } else {
        console.log('[CanvasView] No current route, loading default');
        this.setCurrentRoute('/start-page');
      }
    } catch (error: any) {
      console.error('[CanvasView] Error in alternative loading:', error);
      this.loadFallbackContent();
    }
  }

  loadFallbackContent(): void {
    console.log('[CanvasView] loadFallbackContent called');
    if (!this.webview) return;

    // Use about:blank instead of data URI to avoid ERR_ABORTED
    this.webview.src = 'about:blank';
  }

  // Simplified injection - avoid data URIs
  injectFallbackContent() {
    console.log('[CanvasView] injectFallbackContent called - using about:blank to avoid ERR_ABORTED');
    if (!this.webview) return;

    // Use about:blank instead of data URI
    this.webview.src = 'about:blank';
  }

  // Clean disposal method
  dispose() {
    console.log('[CanvasView] Disposing CanvasView');

    this.clearNavigationTimeout();
    this.isNavigating = false;
    this.webviewSetupComplete = false;

    if (this._reactRoot) {
      // Defer the unmount by a microtask: dispose() is called from editor code that can itself be
      // running inside a React render (a component switch triggered from a rendering component),
      // and React 18 warns "Attempted to synchronously unmount a root while React was already
      // rendering" — with a real race behind the warning, since the root cannot finish unmounting
      // until that render completes. Detaching the reference first makes the deferred call safe
      // even if dispose() runs twice.
      const root = this._reactRoot;
      this._reactRoot = null;
      queueMicrotask(() => {
        try { root.unmount(); } catch (err) { console.warn('[CanvasView] Deferred unmount failed:', err); }
      });
    }

    if (this.webview) {
      // Remove all event listeners to prevent memory leaks
      this.webview = null;

      // Clear webview from NodeGraphContextTmp
      try {
        const { NodeGraphContextTmp } = require('@xgenia-contexts/NodeGraphContext/NodeGraphContext');
        NodeGraphContextTmp.webview = null;
      } catch (e: any) {
        // Ignore if module not available
      }
    }

    // Clean up global event listener
    if (this.htmlRequestHandler) {
      window.removeEventListener('xgenia-get-html-request-v2', this.htmlRequestHandler);
    }

    // Clean up the React container reference
    this.reactContainer = null;

    this.webviewDomReady = false;
    this.pendingRoute = null;
    this.loadAttempts = 0;
  }

  refresh() {
    // This just reloads the webview
    this.tryWebviewCall(() => {
      this.webview.reloadIgnoringCache();
    });
    EventDispatcher.instance.emit('viewer-refreshed');
  }

  openDevTools() {
    this.tryWebviewCall(() => {
      if (this.webview.isDevToolsOpened()) {
        this.webview.closeDevTools();
      } else {
        this.webview.openDevTools();
      }
    });
  }

  setZoomFactor(zoomFactor: number) {
    this.zoomFactor = zoomFactor;
    this.updateViewportSize();
  }

  navigateBack() {
    this.tryWebviewCall(() => {
      this.webview.goBack();
    });
  }

  navigateForward() {
    this.tryWebviewCall(() => {
      this.webview.goForward();
    });
  }

  setViewportSize({ width, height, deviceName }: { width: number; height: number; deviceName?: string }) {
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.props.deviceName = deviceName;

    // We can re-render the <VisualCanvas> with updated props
    this.renderReact();

    this.updateViewportSize();
  }

  private updateViewportSize() {
    if (!this.webview) return;

    const width = this.viewportWidth;
    const height = this.viewportHeight;

    if (width !== null && height !== null) {
      // Device viewport mode — set webview to ACTUAL device dimensions
      // then use CSS transform to scale it to fit within the container
      const containerRect = this.webview.parentElement.getBoundingClientRect();

      // Calculate scale to fit the device viewport within the container
      // Leave some padding (20px) for visual clarity
      const availableWidth = containerRect.width - 20;
      const availableHeight = containerRect.height - 20;

      const scaleX = availableWidth / width;
      const scaleY = availableHeight / height;
      const fitScale = Math.min(1, Math.min(scaleX, scaleY));

      // Set webview to the ACTUAL device dimensions
      // The content will render at true device resolution
      this.webview.style.width = width + 'px';
      this.webview.style.height = height + 'px';

      // Use CSS transform to scale down visually to fit container
      this.webview.style.transformOrigin = 'top left';
      this.webview.style.transform = `scale(${fitScale})`;

      // Adjust the container to prevent overflow issues
      // The scaled size is what actually takes up space
      this.webview.style.marginRight = `-${width - (width * fitScale)}px`;
      this.webview.style.marginBottom = `-${height - (height * fitScale)}px`;

      this.props.zoom = fitScale;
      this.renderReact();
    } else {
      // No device — webview fills the container, no transform scaling
      this.webview.style.width = '100%';
      this.webview.style.height = '100%';
      this.webview.style.transform = 'none';
      this.webview.style.transformOrigin = 'top left';
      this.webview.style.marginRight = '0';
      this.webview.style.marginBottom = '0';
      this.props.zoom = this.zoomFactor || 1;
      this.renderReact();
    }
  }

  setInspectMode(enabled: boolean) {
    console.log(`[CanvasView] setInspectMode called with enabled=${enabled}`);
    this.inspectMode = enabled;

    // When switching to preview mode, reset zoom to 100%
    if (!enabled && this.zoomFactor !== 1) {
      this.zoomFactor = 1;
      this.tryWebviewCall(() => (this.webview as any).setZoomFactor(1));
      this.props.zoom = 1;
    }

    this.callInspectorAPI(enabled);
  }

  /**
   * Set zoom level for the canvas view
   */
  setZoom(zoom: number) {
    this.zoomFactor = zoom;
    this.renderReact();
  }

  /**
   * Show inline chat popup for a selected node
   */
  showInlineChatForNode(nodeId: string, nodeLabel: string, position: { x: number; y: number }) {
    console.log(`[CanvasView] 🗣️ showInlineChatForNode CALLED for node: ${nodeId} (${nodeLabel}) at position:`, position);

    // Close any existing inline chat
    this.closeInlineChat();

    // Store the chat info
    this._currentInlineChat = {
      nodeId,
      nodeLabel,
      position
    };

    // Create React root for the inline chat if it doesn't exist
    if (!this._inlineChatRoot) {
      const container = document.createElement('div');
      container.id = 'inline-element-chat-container';
      document.body.appendChild(container);
      this._inlineChatRoot = createRoot(container);
    }

    // Render the inline chat
    this._inlineChatRoot.render(
      React.createElement(InlineElementChat, {
        nodeId,
        nodeLabel,
        position,
        onClose: () => this.closeInlineChat()
      })
    );
  }

  /**
   * Close the current inline chat
   */
  closeInlineChat() {
    if (this._inlineChatRoot && this._currentInlineChat) {
      console.log('[CanvasView] 🗣️ Closing inline chat');

      // Unmount the React component
      this._inlineChatRoot.unmount();

      // Clean up the container
      const container = document.getElementById('inline-element-chat-container');
      if (container) {
        document.body.removeChild(container);
      }

      // Reset state
      this._inlineChatRoot = null;
      this._currentInlineChat = null;
    }
  }

  private callInspectorAPI(enabled: boolean) {
    this.tryWebviewCall(() => {
      // Check if APIs are available before calling them
      this.webview.executeJavaScript(`
        (function() {
          try {
            if (typeof XgeniaEditorInspectorAPI !== 'undefined' && XgeniaEditorInspectorAPI.setEnabled) {
              XgeniaEditorInspectorAPI.setEnabled(${enabled});
            } else {
              console.warn('[CanvasView] XgeniaEditorInspectorAPI not available');
            }
          } catch (e) {
            console.warn('[CanvasView] Error calling XgeniaEditorInspectorAPI.setEnabled:', e.message);
          }
        })();
      `);
      this.webview.executeJavaScript(`
        (function() {
          try {
            if (typeof XgeniaEditorHighlightAPI !== 'undefined' && XgeniaEditorHighlightAPI.selectNode) {
              XgeniaEditorHighlightAPI.selectNode(null);
            } else {
              console.warn('[CanvasView] XgeniaEditorHighlightAPI not available');
            }
          } catch (e) {
            console.warn('[CanvasView] Error calling XgeniaEditorHighlightAPI.selectNode:', e.message);
          }
        })();
      `);
    });
  }

  setNodeSelected(nodeId: string) {
    this.selectedNodeId = nodeId;
    this.tryWebviewCall(() => {
      this.webview.executeJavaScript(`
        (function() {
          try {
            if (typeof XgeniaEditorHighlightAPI !== 'undefined' && XgeniaEditorHighlightAPI.selectNode) {
              XgeniaEditorHighlightAPI.selectNode('${nodeId}');
            } else {
              console.warn('[CanvasView] XgeniaEditorHighlightAPI not available');
            }
          } catch (e) {
            console.warn('[CanvasView] Error calling XgeniaEditorHighlightAPI.selectNode:', e.message);
          }
        })();
      `);
    });
  }

  async captureThumbnail(): Promise<ThumbnailResult | null> {
    // Enhanced diagnostics for webview state
    if (!this.webview) {
      console.error('[CanvasView] captureThumbnail: webview is null or undefined');
      return null;
    }

    if (!this.webviewDomReady) {
      console.error('[CanvasView] captureThumbnail: webview DOM not ready');
      return null;
    }

    if (!this.webview.isConnected) {
      console.error('[CanvasView] captureThumbnail: webview is not connected to DOM');
      return null;
    }

    try {
      // Only log capture attempts if they're not happening too frequently
      const now = Date.now();
      if (!this._lastCaptureTime || (now - this._lastCaptureTime) > 2000) {
        // console.log('[CanvasView] Capturing webview page');
        this._lastCaptureTime = now;
      }

      const nativeImage = await this.webview.capturePage();

      if (!nativeImage || nativeImage.isEmpty()) {
        console.error('[CanvasView] captureThumbnail: captured image is empty or null');
        return null;
      }

      const size = nativeImage.getSize();
      const canvasWidth = size.width;
      const canvasHeight = size.height;
      // console.log('[CanvasView] Original image size:', canvasWidth, 'x', canvasHeight);

      let thumbHeight, thumbWidth;

      // 1024px short side — 400px thumbs were too small for the AI vision
      // analysis to read UI detail (text, spacing, chrome).
      if (canvasWidth > canvasHeight) {
        thumbWidth = Math.round(1024 * (canvasWidth / canvasHeight));
        thumbHeight = 1024;
      } else {
        thumbWidth = 1024;
        thumbHeight = Math.round(1024 * (canvasHeight / canvasWidth));
      }

      const resizedImage = nativeImage.resize({
        width: thumbWidth,
        height: thumbHeight
      });

      // Convert NativeImage to data URL
      const dataURL = resizedImage.toDataURL();
      // console.log('[CanvasView] Converted to data URL, length:', dataURL.length);

      // Create a proper Image object that has toDataURL method
      // by creating a canvas and drawing the image to it
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);

          // Create a fake image object with toDataURL method
          const result: ThumbnailResult = {
            width: img.width,
            height: img.height,
            toDataURL: (format = 'image/png', quality = 1) => {
              return canvas.toDataURL(format, quality);
            }
          };

          // console.log('[CanvasView] Successfully created thumbnail result');
          resolve(result);
        };
        img.onerror = (error) => {
          console.error('[CanvasView] captureThumbnail: error loading image', error);
          reject(error);
        };
        img.src = dataURL;
      });
    } catch (error: any) {
      console.error('[CanvasView] captureThumbnail: error capturing thumbnail', error);
      return null;
    }
  }

  private tryWebviewCall(func: () => void): void {
    // Check if webview exists and is ready
    if (!this.webview) {
      // Use debug level logging instead of warning to reduce console noise
      // Only log at debug level in development
      // if (process.env.NODE_ENV === 'development') { // Keep this commented or remove check to always use debug
      console.debug('[CanvasView] tryWebviewCall: webview is not initialized yet');
      // }
      return;
    }

    if (!this.webviewDomReady) {
      // if (process.env.NODE_ENV === 'development') { // Keep this commented or remove check to always use debug
      console.debug('[CanvasView] tryWebviewCall: webview DOM not ready');
      // }
      return;
    }

    try {
      // Check if webview is still connected to the DOM
      if (!this.webview.isConnected) {
        // if (process.env.NODE_ENV === 'development') { // Keep this commented or remove check to always use debug
        console.debug('[CanvasView] tryWebviewCall: webview is not connected to DOM');
        // }
        return;
      }

      // Try to access a property to check if webview is still valid
      try {
        const src = this.webview.src;
      } catch (e: any) {
        // if (process.env.NODE_ENV === 'development') { // Keep this commented or remove check to always use debug
        console.debug('[CanvasView] tryWebviewCall: webview appears to be destroyed or invalid');
        // }
        return;
      }

      // Execute the function
      func();
    } catch (e: any) {
      // Handle specific Electron GUEST_VIEW_MANAGER_CALL errors
      if (e.message && e.message.includes('GUEST_VIEW_MANAGER_CALL')) {
        console.debug('[CanvasView] Webview script execution failed - APIs may not be ready yet:', e.message);

        // Retry after a short delay if this is a timing issue
        setTimeout(() => {
          try {
            if (this.webview && this.webviewDomReady && this.webview.isConnected) {
              console.debug('[CanvasView] Retrying webview call after delay');
              func();
            }
          } catch (retryError) {
            console.debug('[CanvasView] Retry also failed, skipping:', retryError.message);
          }
        }, 500);

        return;
      }

      // Only log actual errors at error level
      console.error('[CanvasView] Error in webview call:', e);

      // Try to get more information about the webview state
      try {
        const webviewInfo = {
          src: this.webview.src
        };

        // Try to access additional properties if they exist
        try {
          webviewInfo['isLoading'] =
            typeof this.webview['isLoading'] === 'function' ? this.webview['isLoading']() : 'N/A';
        } catch (e: any) { }
        try {
          webviewInfo['canGoBack'] =
            typeof this.webview['canGoBack'] === 'function' ? this.webview['canGoBack']() : 'N/A';
        } catch (e: any) { }
        try {
          webviewInfo['canGoForward'] =
            typeof this.webview['canGoForward'] === 'function' ? this.webview['canGoForward']() : 'N/A';
        } catch (e: any) { }

        console.log('[CanvasView] Webview state:', webviewInfo);
      } catch (infoError) {
        console.error('[CanvasView] Error getting webview info:', infoError);
      }
    }
  }

  forceDirectLoad() {
    if (!this.webview || !this.webviewDomReady) {
      console.warn('WebView not ready for direct load');
      return;
    }

    console.log('Attempting direct content load');

    // Inject a script that directly creates content
    this.webview
      .executeJavaScript(
        `
      (function() {
        // Clear existing content and styling
        document.body.innerHTML = '';
        document.body.style.margin = '0';
        document.body.style.padding = '0';
        document.body.style.fontFamily = 'Arial, sans-serif';
        document.body.style.backgroundColor = '#ffffff';
        
        // Create a simple application-like UI
        const app = document.createElement('div');
        app.style.padding = '20px';
        
        // Header section
        const header = document.createElement('div');
        header.style.marginBottom = '20px';
        
        const title = document.createElement('h1');
        title.textContent = 'Task Manager';
        title.style.margin = '0 0 10px 0';
        
        const subtitle = document.createElement('p');
        subtitle.textContent = 'Here you can create and see all your tasks.';
        subtitle.style.margin = '0';
        
        header.appendChild(title);
        header.appendChild(subtitle);
        app.appendChild(header);
        
        // Add some fake content
        const content = document.createElement('div');
        
        const tasks = [
          { id: 1, title: 'Complete project', done: false },
          { id: 2, title: 'Review pull request', done: true },
          { id: 3, title: 'Fix React 19 issues', done: false }
        ];
        
        tasks.forEach(task => {
          const taskEl = document.createElement('div');
          taskEl.style.padding = '10px';
          taskEl.style.marginBottom = '10px';
          taskEl.style.border = '1px solid #ddd';
          taskEl.style.borderRadius = '4px';
          
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.checked = task.done;
          checkbox.style.marginRight = '10px';
          
          const label = document.createElement('span');
          label.textContent = task.title;
          if (task.done) {
            label.style.textDecoration = 'line-through';
            label.style.color = '#888';
          }
          
          taskEl.appendChild(checkbox);
          taskEl.appendChild(label);
          content.appendChild(taskEl);
        });
        
        app.appendChild(content);
        document.body.appendChild(app);
        
        return 'Content directly injected';
      })()
    `
      )
      .then((result) => {
        console.log('Direct load result:', result);
      })
      .catch((err) => {
        console.error('Direct load failed:', err);
      });
  }

  // Simplified direct viewer without data URIs
  private loadDirectViewer(): void {
    if (!this.webview) return;

    console.log('[CanvasView] loadDirectViewer called - using about:blank to avoid ERR_ABORTED');

    // Use about:blank instead of data URI to avoid ERR_ABORTED
    this.webview.src = 'about:blank';
  }

  tryDirectLoading(): void {
    if (!this.webview) return;

    const port = process.env.XGENIAPORT || 8574;
    const url = `http://localhost:${port}/`;

    console.log('[CanvasView] Trying direct loading with URL:', url);
    this.webview.src = url;
  }

  // Helper method to clear navigation timeout
  private clearNavigationTimeout(): void {
    if (this.navigationTimeout) {
      clearTimeout(this.navigationTimeout);
      this.navigationTimeout = null;
    }
  }
}