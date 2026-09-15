/**
 * ChatPanelIframe — Wraps the AI plugin in an iframe.
 *
 * Loads the plugin URL from PluginLoader (server-gated by license).
 * Falls back to localhost:3001 in dev mode if no entitlements are available.
 *
 * GPL-licensed — this file lives in the editor codebase.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { editorBridge } from './EditorBridge';
import { PluginLoader, isVerdict, type EntitlementsResponse } from './PluginLoader';

const PLUGIN_ID = 'ai-chat';

export const ChatPanelIframe_ID = 'ChatPanel';

/**
 * What the panel is doing.
 *
 * `not-entitled` is reserved for a VERDICT — the server said this account has no AI Chat.
 * `unavailable` is "we could not check": the server did not answer in time, or there was
 * no session to ask with. (2026-09-15) Before this distinction existed, both painted the
 * same "requires a Pro subscription" screen, and paying users on slow links saw it on
 * their first visit after every update until they restarted the editor.
 */
type PanelStatus = 'loading' | 'connected' | 'not-entitled' | 'unavailable' | 'error';

export function ChatPanelIframe() {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [status, setStatus] = useState<PanelStatus>('loading');
    const [pluginUrl, setPluginUrl] = useState<string | null>(null);
    // The URL currently mounted (or mounting), readable from callbacks without a stale closure.
    const pluginUrlRef = useRef<string | null>(null);
    const [errorMsg, setErrorMsg] = useState('');
    const [tier, setTier] = useState('');
    // When the AI plugin opens its full-screen Settings, it asks us to expand the
    // iframe to cover the whole editor (a CSS modal inside the iframe can only fill
    // the docked column). We restore on close.
    const [fullscreen, setFullscreen] = useState(false);

    // Listen for the plugin's full-screen requests (only from our own iframe).
    useEffect(() => {
        const onMessage = (e: MessageEvent) => {
            if (e?.data?.type !== 'xgenia:ai-panel-fullscreen') return;
            if (iframeRef.current && e.source !== iframeRef.current.contentWindow) return;
            setFullscreen(!!e.data.on);
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, []);

    /**
     * Turn an entitlements answer into what this panel shows.
     *
     *   • a URL for our plugin → mount it (once; a repeat of the same URL is a no-op, so a
     *     re-check after a token refresh does not flicker a connected panel);
     *   • no URL, and not a verdict → a panel that is already up STAYS up, one that has
     *     nothing yet says it could not check and offers a retry;
     *   • no URL, and a verdict → the paywall. Only a verdict may take a working panel down.
     */
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
                console.log('[ChatPanelIframe] Loading entitlements...');
                const entitlements = await loader.getEntitledPlugins();

                if (cancelled) return;
                console.log('[ChatPanelIframe] Entitlements loaded:', entitlements);
                applyEntitlements(entitlements);
            } catch (err: any) {
                if (cancelled) return;
                console.error('[ChatPanelIframe] Error loading entitlements:', err);
                setStatus('error');
                setErrorMsg(err.message || 'Failed to check plugin access');
            }
        };

        loadEntitlements();

        // Entitlement changes: the server's answer landing after a slow check, a re-check
        // after sign-in or a token refresh, an upgrade mid-session.
        const unsub = loader.onChange((e) => {
            if (!e || cancelled) return;
            applyEntitlements(e);
        });

        return () => { cancelled = true; unsub(); };
    }, [applyEntitlements]);

    const handleIframeLoad = useCallback(() => {
        if (iframeRef.current) {
            editorBridge.setIframe(iframeRef.current);
            setStatus('connected');
        }
    }, []);

    const handleIframeError = useCallback(() => {
        setStatus('error');
        setErrorMsg(`Could not load AI plugin from ${pluginUrl}`);
    }, [pluginUrl]);

    // Retry button handler — a fresh check, whatever the last answer was.
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

    const retryButtonStyle: React.CSSProperties = {
        padding: '6px 14px',
        background: '#333', border: '1px solid #555',
        borderRadius: '4px', color: '#e0e0e0',
        cursor: 'pointer', fontSize: '12px', marginTop: '8px',
    };

    // -- Not entitled (a verdict): show upgrade prompt --
    if (status === 'not-entitled') {
        return (
            <div style={{
                width: '100%', height: '100%',
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                gap: '16px', background: '#1a1a1a',
                color: '#999', fontSize: '13px',
                padding: '32px', textAlign: 'center',
            }}>
                <div style={{ fontSize: '40px', opacity: 0.2, fontWeight: 300 }}>AI</div>
                <p style={{ color: '#ccc', fontSize: '14px', fontWeight: 500 }}>
                    AI Chat requires a Pro subscription
                </p>
                <p style={{ color: '#777', fontSize: '12px', maxWidth: '260px', lineHeight: '1.5' }}>
                    Upgrade your plan to unlock the AI design assistant with node creation, editing, and deployment tools.
                </p>
                <p style={{ color: '#555', fontSize: '11px' }}>
                    Current plan: <span style={{ color: '#67DE92' }}>{tier || 'free'}</span>
                </p>
                <button onClick={handleRetry} style={retryButtonStyle}>
                    Check again
                </button>
            </div>
        );
    }

    // -- Could not check (not a verdict): say so, and offer a retry --
    if (status === 'unavailable') {
        return (
            <div style={{
                width: '100%', height: '100%',
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                gap: '16px', background: '#1a1a1a',
                color: '#999', fontSize: '13px',
                padding: '32px', textAlign: 'center',
            }}>
                <div style={{ fontSize: '40px', opacity: 0.2, fontWeight: 300 }}>AI</div>
                <p style={{ color: '#ccc', fontSize: '14px', fontWeight: 500 }}>
                    Couldn&apos;t check your plan
                </p>
                <p style={{ color: '#777', fontSize: '12px', maxWidth: '260px', lineHeight: '1.5' }}>
                    The editor could not reach XGENIA&apos;s licensing server in time. AI Chat stays locked until a check succeeds; it retries by itself when you sign in again or the connection returns.
                </p>
                <button onClick={handleRetry} style={retryButtonStyle}>
                    Try again
                </button>
            </div>
        );
    }

    // -- Error state --
    if (status === 'error') {
        return (
            <div style={{
                width: '100%', height: '100%',
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                gap: '12px', background: '#1a1a1a',
                color: '#999', fontSize: '13px',
                padding: '24px', textAlign: 'center',
            }}>
                <div style={{ fontSize: '32px', opacity: 0.3 }}>AI</div>
                <p>{errorMsg}</p>
                <p style={{ color: '#666', fontSize: '12px' }}>
                    Start the AI plugin server with: <code style={{ color: '#67DE92' }}>npm run dev:ai</code>
                </p>
                <button onClick={handleRetry} style={retryButtonStyle}>
                    Retry
                </button>
            </div>
        );
    }

    // -- Loading: show spinner --
    if (status === 'loading' && !pluginUrl) {
        return (
            <div style={{
                width: '100%', height: '100%',
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                gap: '12px', background: '#1a1a1a',
                color: '#999', fontSize: '13px',
            }}>
                <div style={{ fontSize: '24px', opacity: 0.3, fontWeight: 300 }}>AI</div>
                <p>Loading AI Chat plugin...</p>
            </div>
        );
    }

    // -- Loading / Connected: show iframe --
    // When fullscreen, lift the iframe out of its docked column to cover the
    // whole editor viewport (the plugin's Settings modal then fills the screen).
    const wrapperStyle: React.CSSProperties = fullscreen
        ? { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 2147483000, overflow: 'hidden', background: '#1a1a1a' }
        : { width: '100%', height: '100%', position: 'relative', overflow: 'hidden' };
    return (
        <div style={wrapperStyle}>
            {pluginUrl && (() => {
                    // Forward ai_mode from parent localStorage to iframe via URL param
                    let iframeSrc = pluginUrl;
                    try {
                        const aiMode = localStorage.getItem('xgenia_ai_mode');
                        console.log('[ChatPanelIframe] xgenia_ai_mode from parent localStorage:', aiMode, '| pluginUrl:', pluginUrl);
                        if (aiMode) {
                            const sep = pluginUrl.includes('?') ? '&' : '?';
                            iframeSrc = `${pluginUrl}${sep}ai_mode=${aiMode}`;
                        }
                    } catch { /* ignore */ }
                    console.log('[ChatPanelIframe] Final iframe src:', iframeSrc);
                    return (
                        <iframe
                            ref={iframeRef}
                            src={iframeSrc}
                            onLoad={handleIframeLoad}
                            onError={handleIframeError}
                            style={{
                                width: '100%', height: '100%',
                                border: 'none', background: '#1a1a1a',
                            }}
                            allow="clipboard-read; clipboard-write"
                            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-storage-access-by-user-activation allow-downloads"
                        />
                    );
                })()}
        </div>
    );
}

export default ChatPanelIframe;
