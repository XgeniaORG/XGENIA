/**
 * WebPluginPanel — a sidebar panel that shows any entitled web plugin by id.
 *
 * The server marks a plugin `kind: 'web-panel'` in its plugin-entitlements answer; the editor
 * then gives it a sidebar entry (installWebPluginPanels) whose panel is this component with
 * `pluginId` set. The URL always comes from PluginLoader, never from the plugin: the panel
 * mounts nothing until the server (or a stored verdict) lists the plugin for this account.
 *
 * Same frame, sandbox and states as ImageEditorPanel. The plugin talks to the editor over
 * postMessage through EditorBridge, whose handshake accepts a web panel only from the origin
 * of the URL PluginLoader gave for its id.
 *
 * The URL may carry a short-lived ticket (see PluginLoader, TICKET_PARAM): opening the panel on
 * an old answer refreshes it first, and a later answer that only changes the ticket does not
 * reload the frame. A plugin host that rejects the ticket can tell the panel by posting
 * `{ type: 'plugin-load-error', status }` to its parent; the panel then shows its error state,
 * whose Retry fetches a fresh URL. (The editor cannot read the HTTP status of a cross-origin
 * frame itself.)
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { PluginLoader, isVerdict, pluginOrigin, webPanelPlugins, WEB_PLUGIN_FRAME_ATTR, type EntitlementsResponse } from '../ChatPanelBridge/PluginLoader';
import { entitlementsForPanelOpen, nextFrameUrl } from './webPluginFrame';

/**
 * `not-entitled` is reserved for a VERDICT (the server said no); `unavailable` is "we could
 * not check". See ChatPanelIframe for why the two must not be merged.
 */
type PanelStatus = 'loading' | 'connected' | 'not-entitled' | 'unavailable' | 'error';

export interface WebPluginPanelProps {
    pluginId: string;
}

export function WebPluginPanel({ pluginId }: WebPluginPanelProps) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [status, setStatus] = useState<PanelStatus>('loading');
    const [pluginUrl, setPluginUrl] = useState<string | null>(null);
    const pluginUrlRef = useRef<string | null>(null);
    const [title, setTitle] = useState(pluginId);
    const [errorMsg, setErrorMsg] = useState('');
    const [tier, setTier] = useState('');

    const applyEntitlements = useCallback((e: EntitlementsResponse) => {
        setTier(e.tier);
        const plugin = webPanelPlugins(e).find((p) => p.id === pluginId);
        if (plugin) {
            setTitle(plugin.name || plugin.id);
            // A new ticket alone keeps the mounted URL: no reload, no lost work.
            const next = nextFrameUrl(pluginUrlRef.current, plugin.url);
            if (pluginUrlRef.current === next) return;
            pluginUrlRef.current = next;
            setPluginUrl(next);
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
    }, [pluginId]);

    useEffect(() => {
        let cancelled = false;
        const loader = PluginLoader.instance;

        // Opening the panel: an answer old enough for its ticket to have expired is refreshed
        // first (the loading state shows meanwhile); on failure the URL already held is used.
        entitlementsForPanelOpen(loader).then(
            (e) => { if (!cancelled) applyEntitlements(e); },
            (err: any) => {
                if (cancelled) return;
                setStatus('error');
                setErrorMsg(err?.message || 'Failed to check plugin access');
            }
        );

        const unsub = loader.onChange((e) => {
            if (!e || cancelled) return;
            applyEntitlements(e);
        });

        return () => { cancelled = true; unsub(); };
    }, [applyEntitlements]);

    // The plugin host reports a rejected ticket (or any load failure it can see) by message.
    useEffect(() => {
        if (!pluginUrl) return;
        const expected = pluginOrigin(pluginUrl);
        const onMessage = (event: MessageEvent) => {
            const msg = event.data;
            if (!msg || typeof msg !== 'object' || msg.type !== 'plugin-load-error') return;
            if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return;
            if (!expected || event.origin !== expected) return;
            setStatus('error');
            setErrorMsg(msg.status === 403
                ? `${title} refused access (403). Retry to get a fresh link.`
                : `Could not load ${title}${typeof msg.status === 'number' ? ` (${msg.status})` : ''}.`);
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [pluginUrl, title]);

    const handleIframeLoad = useCallback(() => {
        // No editorBridge.setIframe() here: that rebinds the bridge's primary (chat) iframe.
        // The frame's WEB_PLUGIN_FRAME_ATTR is what the bridge keys this plugin's handshake and
        // commands on.
        setStatus('connected');
    }, []);

    const handleIframeError = useCallback(() => {
        setStatus('error');
        setErrorMsg(`Could not load ${title} from ${pluginUrl}`);
    }, [title, pluginUrl]);

    const handleRetry = useCallback(() => {
        setStatus('loading');
        setErrorMsg('');
        // Mount whatever comes back, even a URL equal to the one that failed (loading state
        // meanwhile, rather than reloading the old URL first).
        pluginUrlRef.current = null;
        setPluginUrl(null);
        PluginLoader.instance.refresh().then(applyEntitlements).catch((err: any) => {
            setStatus('error');
            setErrorMsg(err?.message || 'Failed to check plugin access');
        });
    }, [applyEntitlements]);

    if (status === 'not-entitled') {
        return (
            <div style={shellStyle}>
                <div style={messageStyle}>
                    <h3 style={headingStyle}>{title}</h3>
                    <p style={bodyTextStyle}>Your plan does not include this plugin.</p>
                    <p style={{ color: '#666', fontSize: '11px', textAlign: 'center' }}>
                        Current plan: <span style={{ color: '#67DE92' }}>{tier || 'free'}</span>
                    </p>
                    <button onClick={handleRetry} style={retryButtonStyle}>Check again</button>
                </div>
            </div>
        );
    }

    if (status === 'unavailable') {
        return (
            <div style={shellStyle}>
                <div style={messageStyle}>
                    <h3 style={headingStyle}>Couldn&apos;t check your plan</h3>
                    <p style={{ ...bodyTextStyle, maxWidth: '300px' }}>
                        The editor could not reach XGENIA&apos;s licensing server in time. {title} stays locked until a check succeeds; it retries by itself when you sign in again or the connection returns.
                    </p>
                    <button onClick={handleRetry} style={retryButtonStyle}>Try again</button>
                </div>
            </div>
        );
    }

    if (status === 'error') {
        return (
            <div style={shellStyle}>
                <div style={messageStyle}>
                    <p style={{ color: '#ff6b6b', fontSize: '12px', textAlign: 'center' }}>
                        {errorMsg || `Failed to load ${title}`}
                    </p>
                    <button onClick={handleRetry} style={retryButtonStyle}>Retry</button>
                </div>
            </div>
        );
    }

    return (
        <div style={{
            position: 'fixed',
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
                    <div style={{ color: '#666', fontSize: '12px' }}>Loading {title}...</div>
                </div>
            )}
            {pluginUrl && (
                <iframe
                    ref={iframeRef}
                    src={pluginUrl}
                    title={title}
                    {...{ [WEB_PLUGIN_FRAME_ATTR]: pluginId }}
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

/** Height of the title bar's drag region — see ImageEditorPanel for why panels sit below it. */
const TITLE_BAR_HEIGHT = 34;

const shellStyle: React.CSSProperties = {
    position: 'fixed',
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
    WebkitAppRegion: 'no-drag'
} as React.CSSProperties;

const messageStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px',
    padding: '24px',
};

const headingStyle: React.CSSProperties = { margin: '12px 0 4px', fontSize: '14px', fontWeight: 600 };

const bodyTextStyle: React.CSSProperties = { color: '#999', fontSize: '12px', textAlign: 'center', lineHeight: 1.5 };

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
