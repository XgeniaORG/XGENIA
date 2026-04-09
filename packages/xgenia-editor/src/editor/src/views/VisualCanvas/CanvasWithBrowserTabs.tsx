import React, { useEffect, useRef, useState, useCallback } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
// @ts-ignore
import ComputerIcon from '@hugeicons/core-free-icons/ComputerIcon';
// @ts-ignore
import GlobeIcon from '@hugeicons/core-free-icons/GlobeIcon';
// @ts-ignore
import Cancel01Icon from '@hugeicons/core-free-icons/Cancel01Icon';
import { AiBrowserManager, AiBrowserState } from '@xgenia-ai/ChatPanel/AiBrowserManager';
import { Frame, FrameProps } from '../common/Frame/Frame';
import css from './CanvasWithBrowserTabs.module.scss';

type ActiveTab = 'viewport' | 'browser';

interface CanvasWithBrowserTabsProps {
    /** The CanvasView instance to render in the Viewport tab */
    canvasViewInstance: FrameProps['instance'];
    /** Resize callback from Frame */
    onResize?: (bounds: DOMRect) => void;
}

/**
 * Wraps the viewport preview canvas with a tab bar that lets users
 * switch between the "Viewport" view and the AI "Browser" view.
 * 
 * The browser tab auto-activates when the AI opens a URL.
 * The webview is owned by AiBrowserManager (persistent hidden container)
 * and reparented into this component when the Browser tab is active.
 */
export function CanvasWithBrowserTabs({ canvasViewInstance, onResize }: CanvasWithBrowserTabsProps) {
    const [activeTab, setActiveTab] = useState<ActiveTab>('viewport');
    const [browserState, setBrowserState] = useState<AiBrowserState>(AiBrowserManager.getState());
    const browserContainerRef = useRef<HTMLDivElement>(null);

    // Subscribe to AiBrowserManager state changes
    useEffect(() => {
        const unsubscribe = AiBrowserManager.onStateChange((s) => {
            setBrowserState(s);

            // Auto-switch to browser tab when AI opens a URL
            if (s.active) {
                setActiveTab('browser');
            }
        });
        return () => unsubscribe();
    }, []);

    // Reparent the manager-owned webview into the browser container
    useEffect(() => {
        if (activeTab !== 'browser' || !browserContainerRef.current) return;

        const webviewEl = AiBrowserManager.getWebviewElement();
        if (webviewEl && !browserContainerRef.current.contains(webviewEl)) {
            browserContainerRef.current.appendChild(webviewEl);
        }
    }, [activeTab, browserState.active]);

    // On unmount, return webview to hidden container  
    useEffect(() => {
        return () => {
            AiBrowserManager.returnWebviewToHiddenContainer();
        };
    }, []);

    const handleCloseSession = useCallback(() => {
        AiBrowserManager.close();
        setActiveTab('viewport');
    }, []);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
            {/* Tab bar */}
            <div className={css.TabBar}>
                <button
                    className={`${css.Tab} ${activeTab === 'viewport' ? css.TabActive : ''}`}
                    onClick={() => setActiveTab('viewport')}
                >
                    <HugeiconsIcon icon={ComputerIcon} size={14} color="currentColor" className={css.TabIcon} />
                    Viewport
                </button>
                <button
                    className={`${css.Tab} ${activeTab === 'browser' ? css.TabActive : ''}`}
                    onClick={() => setActiveTab('browser')}
                >
                    <HugeiconsIcon icon={GlobeIcon} size={14} color="currentColor" className={css.TabIcon} />
                    Browser
                    {browserState.active && <span className={css.AiDot} />}
                </button>
            </div>

            {/* Content area */}
            <div className={css.ContentArea}>
                {/* Viewport tab — always mounted, hidden when not active */}
                <div className={css.FrameWrapper} style={{ display: activeTab === 'viewport' ? 'block' : 'none' }}>
                    <Frame instance={canvasViewInstance} onResize={onResize} />
                </div>

                {/* Browser tab */}
                {activeTab === 'browser' && (
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
        </div>
    );
}
