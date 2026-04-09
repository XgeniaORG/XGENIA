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
import { PluginLoader } from '../ChatPanelBridge/PluginLoader';

const PLUGIN_ID = 'ai-image-editor';

export function ImageEditorPanel() {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [status, setStatus] = useState<'loading' | 'connected' | 'not-entitled' | 'error'>('loading');
    const [pluginUrl, setPluginUrl] = useState<string | null>(null);
    const [errorMsg, setErrorMsg] = useState('');
    const [tier, setTier] = useState('');

    // Fetch plugin URL from entitlements
    useEffect(() => {
        let cancelled = false;

        const loadEntitlements = async () => {
            try {
                const loader = PluginLoader.instance;
                const entitlements = await loader.getEntitledPlugins();

                if (cancelled) return;

                setTier(entitlements.tier);

                const url = loader.getPluginUrl(PLUGIN_ID);
                if (url) {
                    setPluginUrl(url);
                    setStatus('loading');
                } else {
                    setStatus('not-entitled');
                }
            } catch (err: any) {
                if (cancelled) return;
                setStatus('error');
                setErrorMsg(err.message || 'Failed to check plugin access');
            }
        };

        loadEntitlements();

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
            editorBridge.setIframe(iframeRef.current, 'xgenia-image-editor');
            setStatus('connected');
        }
    }, []);

    const handleIframeError = useCallback(() => {
        setStatus('error');
        setErrorMsg(`Could not load Image Editor plugin from ${pluginUrl}`);
    }, [pluginUrl]);

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
            top: 0,
            left: '60px',
            width: 'calc(100vw - 60px)',
            height: '100vh',
            zIndex: 1000,
            backgroundColor: '#000',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column'
        }}>
            {status === 'loading' && (
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

const shellStyle: React.CSSProperties = {
    position: 'fixed',
    top: 0,
    left: '60px',
    width: 'calc(100vw - 60px)',
    height: '100vh',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#1a1a1a',
    color: '#e0e0e0',
};

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
