import React, { useEffect, useRef, useState, useCallback } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
// @ts-ignore
import GlobeIcon from '@hugeicons/core-free-icons/GlobeIcon';
// @ts-ignore
import Cancel01Icon from '@hugeicons/core-free-icons/Cancel01Icon';
import { AiBrowserManager, AiBrowserState } from '@xgenia-ai/ChatPanel/AiBrowserManager';

import { EventDispatcher } from '../../../../shared/utils/EventDispatcher';
import { Frame, FrameProps } from '../common/Frame/Frame';
import css from './PreviewSurface.module.scss';

type Surface = 'viewport' | 'browser';

interface PreviewSurfaceProps {
    /** The CanvasView instance to render on the viewport surface */
    canvasViewInstance: FrameProps['instance'];
    /** Resize callback from Frame */
    onResize?: (bounds: DOMRect) => void;
}

/**
 * Hosts the viewport preview and the AI browser in one frame.
 *
 * There is no tab row any more: the surface switch lives in the top bar's status pill,
 * which emits `preview-surface`. Every change made here — the pill's request, the
 * auto-switch when AiBrowserManager reports a session, and the close button's return to
 * the viewport — is reported back with `preview-surface-changed` so the pill mirrors the
 * surface that is actually showing. Echoing the pill's own value back is harmless: the
 * pill only setStates on `preview-surface-changed`, it never re-emits (StatusPill.tsx).
 *
 * The webview is owned by AiBrowserManager (persistent hidden container) and reparented
 * into this component while the browser surface is shown.
 */
export function PreviewSurface({ canvasViewInstance, onResize }: PreviewSurfaceProps) {
    const [surface, setSurfaceState] = useState<Surface>('viewport');
    const [browserState, setBrowserState] = useState<AiBrowserState>(AiBrowserManager.getState());
    const browserContainerRef = useRef<HTMLDivElement>(null);

    /** Single write path for the surface, so no change can skip the mirror event. */
    const setSurface = useCallback((s: Surface) => {
        setSurfaceState(s);
        EventDispatcher.instance.emit('preview-surface-changed', s);
    }, []);

    // Subscribe once: AiBrowserManager state + the pill's surface requests.
    // Announce the current surface on mount. This component remounts whenever the
    // document layout changes (vertical <-> horizontal, detach/attach), and the pill's
    // copy of the surface is updated ONLY by this event — without an initial emit the
    // indicator in the bar could disagree with what the frame is actually showing.
    useEffect(() => {
        EventDispatcher.instance.emit('preview-surface-changed', surface);
        // Mount only: every later change already emits through setSurface.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const eventGroup = {};

        const unsubscribe = AiBrowserManager.onStateChange((s: AiBrowserState) => {
            setBrowserState(s);

            // Auto-switch to the browser when the AI opens a URL — and tell the pill.
            if (s && s.active) {
                setSurface('browser');
            }
        });

        EventDispatcher.instance.on(
            'preview-surface',
            (s: Surface) => {
                // Fail closed on a malformed payload rather than showing a blank surface.
                if (s === 'viewport' || s === 'browser') setSurface(s);
            },
            eventGroup
        );

        return () => {
            unsubscribe();
            EventDispatcher.instance.off(eventGroup);
        };
    }, [setSurface]);

    // Reparent the manager-owned webview into the browser container
    useEffect(() => {
        if (surface !== 'browser' || !browserContainerRef.current) return;

        const webviewEl = AiBrowserManager.getWebviewElement();
        if (webviewEl && !browserContainerRef.current.contains(webviewEl)) {
            browserContainerRef.current.appendChild(webviewEl);
        }
    }, [surface, browserState.active]);

    // On unmount, return webview to hidden container
    useEffect(() => {
        return () => {
            AiBrowserManager.returnWebviewToHiddenContainer();
        };
    }, []);

    const handleCloseSession = useCallback(() => {
        AiBrowserManager.close();
        setSurface('viewport');
    }, [setSurface]);

    return (
        <div className={css.ContentArea}>
            {/* Viewport surface — always mounted, hidden when not showing */}
            <div className={css.FrameWrapper} style={{ display: surface === 'viewport' ? 'block' : 'none' }}>
                <Frame instance={canvasViewInstance} onResize={onResize} />
            </div>

            {/* Browser surface */}
            {surface === 'browser' && (
                <div className={css.BrowserContainer}>
                    {browserState.active ? (
                        <>
                            <div className={css.BrowserHeader}>
                                <span className={css.AiDot} />
                                <span className={css.BrowserUrl}>{browserState.url}</span>
                                <button className={css.BrowserCloseBtn} onClick={handleCloseSession} title="Close session">
                                    <HugeiconsIcon icon={Cancel01Icon} size={14} color="currentColor" />
                                </button>
                            </div>
                            <div ref={browserContainerRef} className={css.BrowserWebview} />
                        </>
                    ) : (
                        <div className={css.BrowserEmpty}>
                            <HugeiconsIcon icon={GlobeIcon} size={36} color="currentColor" className={css.BrowserEmptyIcon} />
                            <span className={css.BrowserEmptyText}>No browser session active</span>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
