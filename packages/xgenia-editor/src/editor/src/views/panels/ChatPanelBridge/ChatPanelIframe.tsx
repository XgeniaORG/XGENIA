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
import { PluginLoader } from './PluginLoader';

const PLUGIN_ID = 'ai-chat';

export const ChatPanelIframe_ID = 'ChatPanel';

export function ChatPanelIframe() {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [status, setStatus] = useState<'loading' | 'connected' | 'not-entitled' | 'error'>('loading');
    const [pluginUrl, setPluginUrl] = useState<string | null>(null);
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

    // Fetch plugin URL from entitlements
    useEffect(() => {
        let cancelled = false;

        const loadEntitlements = async () => {
            try {
                console.log('[ChatPanelIframe] Loading entitlements...');
                const loader = PluginLoader.instance;
                const entitlements = await loader.getEntitledPlugins();

                if (cancelled) return;
                console.log('[ChatPanelIframe] Entitlements loaded:', entitlements);

                setTier(entitlements.tier);

                const url = loader.getPluginUrl(PLUGIN_ID);
                console.log('[ChatPanelIframe] Plugin URL:', url);
                if (url) {
                    setPluginUrl(url);
                    setStatus('loading');
                } else {
                    setStatus('not-entitled');
                }
            } catch (err: any) {
                if (cancelled) return;
                console.error('[ChatPanelIframe] Error loading entitlements:', err);
                setStatus('error');
                setErrorMsg(err.message || 'Failed to check plugin access');
            }
        };

        loadEntitlements();

        // Listen for entitlement changes (e.g. user upgrades mid-session)
        const unsub = PluginLoader.instance.onChange((e) => {
            if (!e) return;
            setTier(e.tier);
            const url = e.plugins.find(p => p.id === PLUGIN_ID)?.url;
            if (url) {
                setPluginUrl(url);
                setStatus('loading');
            } else {
                setStatus('not-entitled');
            }
        });

        return () => { cancelled = true; unsub(); };
    }, []);

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

    // Retry button handler
    const handleRetry = useCallback(() => {
        setStatus('loading');
        setErrorMsg('');
        PluginLoader.instance.refresh().then((e) => {
            const url = e.plugins.find(p => p.id === PLUGIN_ID)?.url;
            if (url) {
                setPluginUrl(url);
            } else {
                setStatus('not-entitled');
            }
        });
    }, []);

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


    // -- Not entitled: show upgrade prompt --
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
                <button onClick={handleRetry} style={{
                    padding: '6px 14px',
                    background: '#333', border: '1px solid #555',
                    borderRadius: '4px', color: '#e0e0e0',
                    cursor: 'pointer', fontSize: '12px', marginTop: '8px',
                }}>
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
