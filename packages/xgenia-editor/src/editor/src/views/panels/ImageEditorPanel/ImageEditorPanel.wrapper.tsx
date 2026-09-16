/**
 * ImageEditorPanel Iframe Wrapper — GPL-licensed shell.
 *
 * Loads the proprietary Image Editor plugin in an iframe,
 * following the same pattern as ChatPanelIframe.tsx.
 * All communication happens via postMessage through EditorBridge.
 *
 * GPL-licensed — this file lives in the editor codebase.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { editorBridge } from '../ChatPanelBridge/EditorBridge';
import { PluginLoader, isVerdict, type EntitlementsResponse } from '../ChatPanelBridge/PluginLoader';

const PLUGIN_ID = 'ai-image-editor';

/**
 * `not-entitled` is reserved for a VERDICT (the server said no); `unavailable` is "we could
 * not check" — no answer in time, or no session to ask with. See ChatPanelIframe for the
 * 2026-09-15 incident that made the distinction necessary.
 */
type PanelStatus = 'loading' | 'connected' | 'not-entitled' | 'unavailable' | 'error';

export function ImageEditorPanel() {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [status, setStatus] = useState<PanelStatus>('loading');
    const [pluginUrl, setPluginUrl] = useState<string | null>(null);
    // The URL currently mounted (or mounting), readable from callbacks without a stale closure.
    const pluginUrlRef = useRef<string | null>(null);
    const [errorMsg, setErrorMsg] = useState('');
    const [tier, setTier] = useState('');

    // Same three outcomes as ChatPanelIframe.applyEntitlements: mount the URL (once), keep a
    // working panel up through a non-answer, and let only a verdict take it down.
    const applyEntitlements = useCallback((e: EntitlementsResponse) => {
        setTier(e.tier);
        const url = e.plugins.find((p) => p.id === PLUGIN_ID)?.url ?? null;
        if (url) {
            if (pluginUrlRef.current === url) return;
            pluginUrlRef.current = url;
            setPluginUrl(url);
            setStatus('loading');
            return;
        }
        if (!isVerdict(e)) {
            if (!pluginUrlRef.current) setStatus('unavailable');
            return;
        }
        pluginUrlRef.current = null;
        setPluginUrl(null);
        setStatus('not-entitled');
    }, []);

    // Fetch plugin URL from entitlements
    useEffect(() => {
        let cancelled = false;
        const loader = PluginLoader.instance;

        const loadEntitlements = async () => {
            try {
                const entitlements = await loader.getEntitledPlugins();
                if (cancelled) return;
                applyEntitlements(entitlements);
            } catch (err: any) {
                if (cancelled) return;
                setStatus('error');
                setErrorMsg(err.message || 'Failed to check plugin access');
            }
        };

        loadEntitlements();

        const unsub = loader.onChange((e) => {
            if (!e || cancelled) return;
            applyEntitlements(e);
        });

        return () => { cancelled = true; unsub(); };
    }, [applyEntitlements]);

    const handleIframeLoad = useCallback(() => {
        if (iframeRef.current) {
            editorBridge.setIframe(iframeRef.current, 'xgenia-image-editor');
            setStatus('connected');
        }
    }, []);

    const handleIframeError = useCallback(() => {
        setStatus('error');
        setErrorMsg(`Could not load Image Editor plugin from ${pluginUrl}`);
    }, [pluginUrl]);

    // A fresh check, whatever the last answer was.
    const handleRetry = useCallback(() => {
        setStatus('loading');
        setErrorMsg('');
        PluginLoader.instance.refresh().then(applyEntitlements).catch((err: any) => {
            setStatus('error');
            setErrorMsg(err?.message || 'Failed to check plugin access');
        });
    }, [applyEntitlements]);

    // Connection status polling
    useEffect(() => {
        const checkConnection = setInterval(() => {
            if (editorBridge.isConnected()) {
                setStatus('connected');
                clearInterval(checkConnection);
            }
        }, 1000);
        return () => clearInterval(checkConnection);
    }, []);

    // --- Render ---
    if (status === 'not-entitled') {
        return (
            <div style={shellStyle}>
                <div style={messageStyle}>
                    <span style={{ fontSize: '32px' }}>🎨</span>
                    <h3 style={{ margin: '12px 0 4px', fontSize: '14px', fontWeight: 600 }}>
                        Image Editor
                    </h3>
                    <p style={{ color: '#999', fontSize: '12px', textAlign: 'center', lineHeight: 1.5 }}>
                        The AI Image Editor requires a Pro subscription.
                    </p>
                    <p style={{ color: '#666', fontSize: '11px', textAlign: 'center' }}>
                        Current plan: <span style={{ color: '#67DE92' }}>{tier || 'free'}</span>
                    </p>
                    <button onClick={handleRetry} style={retryButtonStyle}>
                        Check again
                    </button>
                </div>
            </div>
        );
    }

    if (status === 'unavailable') {
        return (
            <div style={shellStyle}>
                <div style={messageStyle}>
                    <span style={{ fontSize: '32px' }}>🎨</span>
                    <h3 style={{ margin: '12px 0 4px', fontSize: '14px', fontWeight: 600 }}>
                        Couldn&apos;t check your plan
                    </h3>
                    <p style={{ color: '#999', fontSize: '12px', textAlign: 'center', lineHeight: 1.5, maxWidth: '300px' }}>
                        The editor could not reach XGENIA&apos;s licensing server in time. The Image Editor stays locked until a check succeeds; it retries by itself when you sign in again or the connection returns.
                    </p>
                    <button onClick={handleRetry} style={retryButtonStyle}>
                        Try again
                    </button>
                </div>
            </div>
        );
    }

    if (status === 'error') {
        return (
            <div style={shellStyle}>
                <div style={messageStyle}>
                    <p style={{ color: '#ff6b6b', fontSize: '12px', textAlign: 'center' }}>
                        {errorMsg || 'Failed to load Image Editor plugin'}
                    </p>
                    <button onClick={handleRetry} style={retryButtonStyle}>
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div style={{
            position: 'fixed',
            // See TITLE_BAR_HEIGHT. This is the frame the plugin actually loads
            // into, and it had its own copy of the geometry — so fixing only
            // `shellStyle` below would have moved the loading and error states
            // out from under the title bar and left the editor itself beneath it.
            top: `${TITLE_BAR_HEIGHT}px`,
            left: '60px',
            width: 'calc(100vw - 60px)',
            height: `calc(100vh - ${TITLE_BAR_HEIGHT}px)`,
            zIndex: 1000,
            backgroundColor: '#000',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            WebkitAppRegion: 'no-drag'
        } as React.CSSProperties}>
            {status === 'loading' && !pluginUrl && (
                <div style={{
                    ...shellStyle,
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: '#1a1a1a',
                    zIndex: 10,
                }}>
                    <div style={{ color: '#666', fontSize: '12px' }}>
                        Loading Image Editor...
                    </div>
                </div>
            )}
            {pluginUrl && (
                <iframe
                    ref={iframeRef}
                    src={pluginUrl}
                    onLoad={handleIframeLoad}
                    onError={handleIframeError}
                    style={{
                        width: '100%',
                        height: '100%',
                        border: 'none',
                        background: '#1a1a1a',
                    }}
                    allow="clipboard-read; clipboard-write"
                    sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-modals"
                />
            )}
        </div>
    );
}

/**
 * How far down the window the title bar reaches.
 *
 * `TitleBar.module.scss` is `height: 34px` with `-webkit-app-region: drag`, and
 * a drag region is an OS-LEVEL caption area: Chromium computes it from the
 * element's geometry and hands it to the window manager, so it is not overridden
 * by anything painted on top of it. A panel at `top: 0` with a z-index of 1000
 * still paints above the title bar and still cannot be clicked in that strip —
 * the clicks move the window instead.
 *
 * This panel's own header is 52px tall and sits at the top of the frame, so 34
 * of those 52 pixels were dead: every control in it — Paint, Undo, Save, Close —
 * only responded along an 18px sliver at its bottom edge.
 */
const TITLE_BAR_HEIGHT = 34;

const shellStyle: React.CSSProperties = {
    position: 'fixed',
    // Below the title bar rather than under it. The alternative — marking this
    // panel `no-drag` to punch a hole in the caption — also works, and costs the
    // window its drag strip everywhere the panel covers, which is most of it.
    top: `${TITLE_BAR_HEIGHT}px`,
    left: '60px',
    width: 'calc(100vw - 60px)',
    height: `calc(100vh - ${TITLE_BAR_HEIGHT}px)`,
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#1a1a1a',
    color: '#e0e0e0',
    // Insurance, and free once the offset above is right: if the title bar is
    // ever taller than this constant, the overlap is at least clickable rather
    // than silently dead.
    WebkitAppRegion: 'no-drag'
} as React.CSSProperties;

const messageStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px',
    padding: '24px',
};

const retryButtonStyle: React.CSSProperties = {
    padding: '6px 16px',
    borderRadius: '6px',
    border: '1px solid #444',
    background: '#2a2a2a',
    color: '#ccc',
    cursor: 'pointer',
    fontSize: '12px',
    marginTop: '8px',
};
