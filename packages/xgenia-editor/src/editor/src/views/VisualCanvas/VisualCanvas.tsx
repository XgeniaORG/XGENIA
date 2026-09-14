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
import { IframeViewer, type PreviewHost } from './IframeViewer';
import { FrameResizeHandles } from './FrameResizeHandles';
import { useFrameRect } from './useFrameRect';
import css from './VisualCanvas.module.scss';

export interface VisualCanvasProps {
  onWebView: (webview: PreviewHost) => void;
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
  const webviewRef = useRef<HTMLIFrameElement>(null);
  const hostRef = useRef<IframeViewer | null>(null);
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
      // The preview is an in-process <iframe> wearing the <webview> API — see IframeViewer.ts
      // for why: the <webview>'s separate compositor surface is what flashed the window.
      const host = new IframeViewer(webviewRef.current, preloadPath);
      hostRef.current = host;
      onWebView(host);

      const handleDomReady = () => {
        console.log('[VisualCanvas] Preview DOM Ready');
        webviewDomReadyRef.current = true;
      };
      host.addEventListener('dom-ready', handleDomReady);

      return () => {
        host.removeEventListener('dom-ready', handleDomReady);
        host.dispose();
        if (hostRef.current === host) hostRef.current = null;
      };
    }
  }, [preloadKey]); // Re-run when the frame is recreated

  function restart() {
    if (hostRef.current) {
      setCrashed(false);
      onWebView(hostRef.current);
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
    if (!hostRef.current) return;

    try {
      const webview = hostRef.current;

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

  function loadFallbackIframe(webview: PreviewHost) {
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

  // The frame's visual box, in the coordinate space the handles are positioned in.
  //
  // Measured by useFrameRect rather than differenced from the two tracked bounds above:
  // those are throttled, they are blind to a fit-scale change (a transform fires no
  // ResizeObserver), and differencing two viewport rects inside an `overflow: auto`
  // container counts the scroll offset twice. All three left the handles sitting away
  // from the frame instead of on its edge. See useFrameRect.ts.
  const frameRect = useFrameRect(webviewRef, containerRef);

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
        {/* An in-process <iframe>, deliberately NOT a <webview>.
            A <webview> is a separate renderer whose compositor surface the GPU process
            stitches into ours every frame; on macOS 26 that stitch occasionally presents
            the guest alone, unscaled, for a frame — the whole-window flash. Measured on a
            120fps screen recording, 60s of scripted scrolling each: <webview> 1 flash,
            the same content as an in-process <iframe> 0. The frame is painted by our own
            renderer, and IframeViewer gives CanvasView and the AI tools the API the
            <webview> had, preload included.
            Security posture is unchanged from the <webview> it replaces — the editor
            window already runs with webSecurity off and site isolation off, which is
            also exactly what makes reaching into a cross-origin frame possible. The
            preview has never had Node access and still does not. */}
        <iframe
          key={preloadKey} // Force recreation when preload changes
          ref={webviewRef}
          className={css.Webview}
          title="Preview"
          style={{ backgroundColor: 'white', border: 0 }}
          allow="clipboard-read; clipboard-write; autoplay; fullscreen"
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
