import React, { useState, useEffect, useCallback, useRef, ReactNode } from 'react';

import { SidebarModel } from '@xgenia-models/sidebar';
import { SidebarModelEvent } from '@xgenia-models/sidebar/sidebarmodel';

import { ErrorBoundary } from '@xgenia-core-ui/components/common/ErrorBoundary';
import { IconName } from '@xgenia-core-ui/components/common/Icon';
import { IconButton, IconButtonState, IconButtonVariant } from '@xgenia-core-ui/components/inputs/IconButton';
import { DialogRenderDirection } from '@xgenia-core-ui/components/layout/BaseDialog';
import { Tooltip } from '@xgenia-core-ui/components/popups/Tooltip';
import { TopbarPinned, TopbarUnpinned } from '../SidePanel/SidebarIcons';

import css from './RightPropertyPanel.module.scss';

/** Panel IDs that render on the right side */
export const RIGHT_SIDE_PANEL_IDS = new Set(['PropertyEditor', 'PortEditor', 'AssetInspector']);

export function isRightSidePanel(panelId: string): boolean {
    return RIGHT_SIDE_PANEL_IDS.has(panelId);
}

/**
 * The panel was a fixed 320px, which is why long port labels ran into their own value fields
 * ("Fit Padding (% inset per side)", "Transparent Background"). Widening is now the user's
 * call, and it sticks across sessions.
 */
const WIDTH_STORAGE_KEY = 'xgenia.rightPropertyPanel.width';
const MIN_WIDTH = 260;
const MAX_WIDTH = 720;
const DEFAULT_WIDTH = 320;

function clampWidth(value: number): number {
    if (!isFinite(value)) return DEFAULT_WIDTH;
    return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(value)));
}

function readStoredWidth(): number {
    try {
        const raw = window.localStorage.getItem(WIDTH_STORAGE_KEY);
        if (raw === null) return DEFAULT_WIDTH;
        return clampWidth(Number(raw));
    } catch (e) {
        return DEFAULT_WIDTH;
    }
}

export function RightPropertyPanel() {
    const [panelId, setPanelId] = useState<string | null>(SidebarModel.instance.RightPanelId);
    const [panelContent, setPanelContent] = useState<ReactNode | null>(() => {
        const component = SidebarModel.instance.getRightPanelComponent();
        return component ? React.createElement(component) : null;
    });
    const [isPinned, setIsPinned] = useState(false);
    /** Bumped on every panel change so the ErrorBoundary below gets a fresh instance. */
    const [contentKey, setContentKey] = useState(0);
    const [width, setWidth] = useState<number>(readStoredWidth);
    const [isResizing, setIsResizing] = useState(false);
    /** Live during a drag so the pointer handlers never close over a stale width. */
    const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

    useEffect(() => {
        const group = {};

        SidebarModel.instance.on(
            SidebarModelEvent.rightPanelChanged,
            (newPanelId: string | null, component: (() => React.ReactElement) | null) => {
                setPanelId(newPanelId);
                if (component) {
                    setPanelContent(React.createElement(component));
                } else {
                    setPanelContent(null);
                }
                setContentKey((prev) => prev + 1);
            },
            group
        );

        return () => {
            SidebarModel.instance.off(group);
        };
    }, []);

    const commitWidth = useCallback((next: number) => {
        const clamped = clampWidth(next);
        setWidth(clamped);
        try {
            window.localStorage.setItem(WIDTH_STORAGE_KEY, String(clamped));
        } catch (e) {
            /* private mode / quota — the drag still worked, it just will not be remembered */
        }
    }, []);

    // Listeners live on window, not the handle, so the drag survives the pointer leaving the
    // 10px strip — which it does immediately, since the panel edge moves with the cursor.
    useEffect(() => {
        if (!isResizing) return;

        function onMove(e: MouseEvent) {
            const drag = dragRef.current;
            if (!drag) return;
            // The handle is on the LEFT edge of a right-docked panel, so dragging left
            // (negative delta) makes it wider.
            setWidth(clampWidth(drag.startWidth + (drag.startX - e.clientX)));
        }

        function onUp(e: MouseEvent) {
            const drag = dragRef.current;
            dragRef.current = null;
            setIsResizing(false);
            if (drag) commitWidth(drag.startWidth + (drag.startX - e.clientX));
        }

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
    }, [isResizing, commitWidth]);

    const startResize = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault();
            dragRef.current = { startX: e.clientX, startWidth: width };
            setIsResizing(true);
        },
        [width]
    );

    // Keyboard resize, so the panel is not mouse-only.
    const onHandleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            const step = e.shiftKey ? 40 : 10;
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                commitWidth(width + step);
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                commitWidth(width - step);
            }
        },
        [width, commitWidth]
    );

    if (!panelId || !panelContent) {
        return null;
    }

    function handleClose() {
        if (!isPinned) {
            SidebarModel.instance.hidePanels();
        }
    }

    return (
        <div
            className={isResizing ? `${css['Root']} ${css['Resizing']}` : css['Root']}
            style={{ width: `${width}px` }}
        >
            <div
                className={css['ResizeHandle']}
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize panel"
                aria-valuenow={width}
                aria-valuemin={MIN_WIDTH}
                aria-valuemax={MAX_WIDTH}
                tabIndex={0}
                onMouseDown={startResize}
                onKeyDown={onHandleKeyDown}
                onDoubleClick={() => commitWidth(DEFAULT_WIDTH)}
                title="Drag to resize — double-click to reset"
            />
            <div className={css['PanelHeader']}>
                <Tooltip content={isPinned ? 'Unpin panel' : 'Pin panel open'} renderDirection={DialogRenderDirection.Below}>
                    <IconButton
                        icon={isPinned ? TopbarPinned : TopbarUnpinned}
                        variant={IconButtonVariant.Transparent}
                        state={isPinned ? IconButtonState.Active : undefined}
                        onClick={() => setIsPinned(!isPinned)}
                        aria-label={isPinned ? 'Unpin panel' : 'Pin panel open'}
                    />
                </Tooltip>
                {!isPinned && (
                    <Tooltip content="Close panel" renderDirection={DialogRenderDirection.Below}>
                        <IconButton
                            icon={IconName.Close}
                            variant={IconButtonVariant.Transparent}
                            onClick={handleClose}
                            aria-label="Close panel"
                        />
                    </Tooltip>
                )}
            </div>
            <div className={css['PanelContent']}>
                <ErrorBoundary key={contentKey} showTryAgain onTryAgain={() => setContentKey((prev) => prev + 1)}>
                    {panelContent}
                </ErrorBoundary>
            </div>
        </div>
    );
}

