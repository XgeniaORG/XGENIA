import React, { useState, useEffect, ReactNode } from 'react';

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
export const RIGHT_SIDE_PANEL_IDS = new Set(['PropertyEditor', 'PortEditor']);

export function isRightSidePanel(panelId: string): boolean {
    return RIGHT_SIDE_PANEL_IDS.has(panelId);
}

export function RightPropertyPanel() {
    const [panelId, setPanelId] = useState<string | null>(SidebarModel.instance.RightPanelId);
    const [panelContent, setPanelContent] = useState<ReactNode | null>(() => {
        const component = SidebarModel.instance.getRightPanelComponent();
        return component ? React.createElement(component) : null;
    });
    const [isPinned, setIsPinned] = useState(false);

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
            },
            group
        );

        return () => {
            SidebarModel.instance.off(group);
        };
    }, []);

    if (!panelId || !panelContent) {
        return null;
    }

    function handleClose() {
        if (!isPinned) {
            SidebarModel.instance.hidePanels();
        }
    }

    return (
        <div className={css['Root']}>
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
                <ErrorBoundary showTryAgain>
                    {panelContent}
                </ErrorBoundary>
            </div>
        </div>
    );
}

