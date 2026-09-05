import * as path from 'path';
import { app } from '@electron/remote';
import { useThrottle } from '@xgenia-hooks/useThrottleState';
import React, { useEffect, useRef, useState, useCallback, CSSProperties } from 'react';
// Import app from remote for renderer process
import { platform } from '@xgenia/platform';
import { EventDispatcher } from '../../../../shared/utils/EventDispatcher';

// Correct import for platform

import { useTrackBounds } from '@xgenia-core-ui/hooks/useTrackBounds';

import { CanvasView } from './CanvasView';
import { FrameResizeHandles } from './FrameResizeHandles';
import css from './VisualCanvas.module.scss';

export interface VisualCanvasProps {
  onWebView: (webview: Electron.WebviewTag) => void;
  deviceName?: string;
  zoom: number;
  onReloadWebview?: () => void;
  /** Device pixels of the current preview viewport; null = "Fit viewport". */
  viewportWidth: number | null;
  viewportHeight: number | null;
}

export function VisualCanvas({
  onWebView,
  deviceName,
  zoom,
  onReloadWebview,
  viewportWidth,
  viewportHeight
}: VisualCanvasProps) {
  const webviewRef = useRef<Electron.WebviewTag>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const webviewDomReadyRef = useRef<boolean>(false);
  const canvasViewRef = useRef<CanvasView | null>(null);

  // Use state to force re-render when preload path changes
  const [preloadKey, setPreloadKey] = useState(0);

  let preloadPath = '';
  try {
    const cacheBuster = Date.now(); // Add timestamp to force fresh load
    if (app.isPackaged) {
      // Production: Assume assets are copied to the app's resource root/assets
      // Use platform.getAppPath() which points to resources directory in packaged app
      preloadPath = `file://${path.join(platform.getAppPath(), 'assets/webview-preload-viewer.js')}?v=${cacheBuster}`;
    } else {
      // Development: Construct path relative to the project root
      // Assuming app.getAppPath() points to the xgenia-editor package root in dev mode
      preloadPath = `file://${path.join(app.getAppPath(), 'src/assets/webview-preload-viewer.js')}?v=${cacheBuster}`;
    }
    console.log(`[VisualCanvas] Using preload path: ${preloadPath}`);
  } catch (error: any) {
    console.error('[VisualCanvas] Failed to determine preload path:', error);
    // Fallback or default path if needed, though likely indicates a setup issue
    preloadPath = ''; // Or some default known path if applicable
  }

  const onNavigationStateChanged = useCallback(({ route, canGoBack, canGoForward }) => {
    console.log('Navigation state changed:', { route, canGoBack, canGoForward });
    // Add any navigation state handling here
  }, []);


  const webviewBounds = useThrottle(useTrackBounds(webviewRef), 100);
  const containerBounds = useThrottle(useTrackBounds(containerRef), 100);

  const [crashed, setCrashed] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({});
  const [showViewportSize, setShowViewportSize] = useState(false);


  // Function to force webview reload with fresh preload script
  const forceWebviewReload = useCallback(() => {
    console.log('[VisualCanvas] 🔄 Forcing webview reload with fresh preload script');
    setPreloadKey(prev => prev + 1);
  }, []);

  const canvasView = useRef<CanvasView>(new CanvasView({
    onNavigationStateChanged
  }));

  // Store canvasView instance in ref for inline chat functionality
  canvasViewRef.current = canvasView.current;

  // Listen for force webview reload events
  useEffect(() => {
    const eventGroup = {};
    const handleForceReload = () => {
      console.log('[VisualCanvas] 📡 Received force-webview-reload event, triggering reload');
      forceWebviewReload();
    };

    EventDispatcher.instance.on('force-webview-reload', handleForceReload, eventGroup);

    return () => {
      EventDispatcher.instance.off(eventGroup);
    };
  }, [forceWebviewReload]);



  useEffect(() => {
    if (webviewRef.current) {
      const webview = webviewRef.current; // Capture ref in variable
      onWebView(webview);

      const handleCrash = () => {
        setCrashed(true);
      };

      const handleDomReady = () => {
        console.log('[VisualCanvas] WebView DOM Ready');
        webviewDomReadyRef.current = true;
        // DevTools opening removed - no longer automatically opens
      };

      webview.addEventListener('crashed', handleCrash);
      webview.addEventListener('dom-ready', handleDomReady); // Add dom-ready listener

      // Cleanup function
      return () => {
        // Check if the webview element still exists before removing listeners
        if (webview) {
          webview.removeEventListener('crashed', handleCrash);
          webview.removeEventListener('dom-ready', handleDomReady); // Remove dom-ready listener
        }
      };
    }
  }, [preloadKey]); // Re-run when webview is recreated

  function restart() {
    if (webviewRef.current) {
      setCrashed(false);
      onWebView(webviewRef.current);
    }
  }

  useEffect(() => {
    if (!webviewBounds || !containerBounds) {
      return;
    }

    // Don't apply dynamic styles if bounds are invalid (happens during webview recreation)
    if (webviewBounds.width <= 0 || webviewBounds.height <= 0 ||
      containerBounds.width <= 0 || containerBounds.height <= 0) {
      setStyle({});
      return;
    }

    if (webviewBounds.width > containerBounds.width && webviewBounds.height > containerBounds.height) {
      setStyle({});
    } else if (webviewBounds.width > containerBounds.width) {
      setStyle({ flexDirection: 'row', alignItems: 'center' });
    } else if (webviewBounds.height > containerBounds.height) {
      setStyle({ flexDirection: 'column', alignItems: 'center' });
    } else {
      setStyle({ alignItems: 'center', justifyContent: 'center' });
    }
  }, [webviewBounds, containerBounds]);

  useEffect(() => {
    if (!webviewBounds) {
      return;
    }

    // Only show viewport size if bounds are valid (not during recreation)
    if (webviewBounds.width > 0 && webviewBounds.height > 0) {
      setShowViewportSize(true);

      const timeout = setTimeout(() => {
        setShowViewportSize(false);
      }, 100);

      return () => {
        clearTimeout(timeout);
      };
    }
  }, [containerBounds, webviewBounds]);

  // Update canvasView zoom when it changes
  useEffect(() => {
    if (canvasView.current) {
      canvasView.current.setZoom(zoom);
    }
  }, [zoom, canvasView]);

  // Update canvasView reference
  useEffect(() => {
    canvasViewRef.current = canvasView.current;
  }, [canvasView.current]);

  function forcePreviewContent() {
    if (!webviewRef.current) return;

    try {
      const webview = webviewRef.current;

      // 1. First make sure all security attributes are set
      webview.setAttribute('disablewebsecurity', 'true');
      webview.setAttribute('allowpopups', 'true');

      // 2. Get current route from the canvas
      const port = process.env.XGENIAPORT || 8574;

      console.log(`[VisualCanvas] Using port ${port} for preview`);

      // Several route possibilities - we'll try them all
      const possibleRoutes = ['/', '/index.html', '/app', '/editor/preview', '/preview'];

      console.log('Attempting to force preview content loading');

      // Instead of using a data URL, directly try loading from the actual server
      const url = `http://localhost:${port}?t=${Date.now()}`;
      console.log(`Attempting to load from: ${url}`);
      webview.src = url;

      // Let CanvasView handle load events and retries. Avoid executeJavaScript here
      // to prevent calling it before the webview is fully attached and ready.
    } catch (err: any) {
      console.error('Error forcing preview content:', err);
    }
  }

  function loadFallbackIframe(webview) {
    console.log('[VisualCanvas] loadFallbackIframe called - using about:blank to avoid ERR_ABORTED');

    // Use about:blank instead of data URI to avoid ERR_ABORTED
    webview.src = 'about:blank';
  }

  useEffect(() => {
    // Call the function to force preview content
    const timer = setTimeout(() => {
      forcePreviewContent();
    }, 100);

    return () => clearTimeout(timer);
  }, [preloadKey]); // Re-run when webview is recreated

  // The webview's visual box, expressed relative to .WebviewContainer (its positioned
  // parent). getBoundingClientRect() on a CSS-transformed element returns the VISUAL
  // box, which is what the handles have to sit on — the container is a centering flex
  // box that is normally much larger than the frame.
  const frameRect =
    webviewBounds && containerBounds && webviewBounds.width > 0
      ? {
        left: webviewBounds.left - containerBounds.left,
        top: webviewBounds.top - containerBounds.top,
        width: webviewBounds.width,
        height: webviewBounds.height
      }
      : null;

  // The scale that maps pointer pixels onto device pixels. NOT the `zoom` prop:
  // CanvasView.renderReact() passes `this.zoomFactor` (the user's content zoom, applied
  // via webview.setZoomFactor, which does not change the element's box), while the
  // element is transformed by the fitScale that updateViewportSize() writes to
  // `this.props.zoom` — a value nothing forwards to this component. Measuring the
  // visual box against the device width gives that fitScale directly.
  const frameScale = frameRect && viewportWidth > 0 ? frameRect.width / viewportWidth : zoom;

  return (
    <div className={css.Background}>
      {showViewportSize && (
        <div className={css.ViewportInfo}>{`${deviceName ? deviceName + ' -' : ''} ${Math.floor(
          webviewBounds.width
        )}x${Math.floor(webviewBounds.height)}px - ${Math.floor(zoom * 100)}%`}</div>
      )}
      <div className={css.WebviewContainer} style={style} ref={containerRef}>
        <webview
          key={preloadKey} // Force recreation when preload changes
          ref={webviewRef}
          className={css.Webview}
          style={{ backgroundColor: 'white' }}
          // Use attributes in a way that satisfies both TypeScript and React 19
          // @ts-ignore - React 19 requires string "false" but TypeScript expects boolean
          nodeintegration="false"
          // @ts-ignore - React 19 requires string "true" but TypeScript expects boolean
          disablewebsecurity="true"
          // @ts-ignore - React 19 requires string "true" but TypeScript expects boolean
          allowpopups="true"
          // (2026-08-05 audit) What this webview actually grants, so the next reader
          // does not have to re-derive it:
          //   • nodeintegration=false and @electron/remote is NOT enabled for these
          //     webContents (main.js only enables it for the main window and the
          //     floating window) — so preview content has no direct Node access.
          //   • contextIsolation=false is LOAD-BEARING: webview-preload-viewer.js
          //     assigns window.XgeniaEditorAPI directly, which is how the viewer talks
          //     to the editor. Flipping it to true breaks the preview until that
          //     preload is rewritten onto contextBridge. Consequence to be aware of:
          //     page script shares a world with the preload, so anything the preload
          //     exposes is reachable by whatever the preview loads.
          //   • webSecurity=false lets preview content read file:// and any origin.
          //     Fine for a project you wrote; it is the exposure that matters if a
          //     project ever contains third-party or generated HTML.
          // `enableRemoteModule` was removed from Electron in v14 (this app is on 31),
          // so it was a dead flag that only advertised an intent we do not want.
          webpreferences="contextIsolation=false, webSecurity=false"
          // Preload to inject XgeniaEditorAPI into the preview content
          preload={preloadPath}
          suppressHydrationWarning={true}
        />

        <FrameResizeHandles
          width={viewportWidth}
          height={viewportHeight}
          scale={frameScale}
          deviceName={deviceName}
          rect={frameRect}
        />
      </div>



      {Boolean(crashed) && (
        <div className={css.Crashed}>
          <div className={css.CrashedContent}>
            <h3>Aw, Snap!</h3>
            <p>Something went wrong while displaying this web page.</p>
            <button onClick={restart}>Try again</button>
          </div>
        </div>
      )}
    </div>
  );
}
