import { ipcRenderer } from 'electron';
import React, { useEffect, useState, ReactNode, Fragment } from 'react'; // Import Fragment
import { platform } from '@xgenia/platform';

import { App } from '@xgenia-models/app';
import { ProjectModel } from '@xgenia-models/projectmodel';

import { TitleBar, TitleBarVariant, TitleBarState } from '@xgenia-core-ui/components/app/TitleBar';
import { VStack } from '@xgenia-core-ui/components/layout/Stack';
import { useConfirmationDialog } from '@xgenia-core-ui/components/popups/ConfirmationDialog/ConfirmationDialog.hooks';

export enum BaseWindowVariant {
    Default = 'default',
    Shallow = 'shallow'
}

export interface BaseWindowProps {
    title?: string;
    variant?: BaseWindowVariant;
    children?: ReactNode; // children should be optional
}

export function BaseWindow({
    title = ProjectModel.instance?.name || 'XGENIA',
    variant = BaseWindowVariant.Default,
    children
}: BaseWindowProps) {
    // AUTO-UPDATE DISABLED - These states are no longer used
    // const [newVersionAvailable, setNewVersionAvailable] = useState<boolean | undefined>(undefined);
    const [showDialog, setShowDialog] = useState(false); // State for dialog visibility (kept for compatibility)

    // AUTO-UPDATE DISABLED - Confirmation dialog for auto-update disabled
    // Destructure as a tuple (array)
    const [ConfirmationDialogComponent, showConfirmation] = useConfirmationDialog({
        title: 'New auto update available',
        message: 'A new version has been downloaded. Restart the application to apply the updates.',
        confirmButtonLabel: 'Restart',
        cancelButtonLabel: 'Later'
    });

    // AUTO-UPDATE DISABLED - IPC listener for auto-update popup disabled
    /*
    useEffect(() => {
        const func = () => setNewVersionAvailable(true);

        ipcRenderer.on('showAutoUpdatePopup', func);
        return function () {
            ipcRenderer.off('showAutoUpdatePopup', func);
        };
    }, []);
    */

    // AUTO-UPDATE DISABLED - onNewVersionAvailableClicked function disabled
    function onNewVersionAvailableClicked() {
        // Auto-update functionality disabled - this function does nothing now
        console.log('[AutoUpdate] Auto-update feature is disabled');
        /*
        setShowDialog(true); // Show the dialog
        showConfirmation()
            .then(() => {
                ipcRenderer.send('autoUpdatePopupClosed', true);
                setShowDialog(false); // Hide dialog after confirmation
            })
            .catch(() => {
                ipcRenderer.send('autoUpdatePopupClosed', false);
                setShowDialog(false); // Hide dialog after cancel
            });
        */
    }

    return (
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}>
            {/* Wrap the ENTIRE content in a Fragment */}
            <Fragment>
                {showDialog && ConfirmationDialogComponent()} {/*Conditional and function call*/}

                <VStack UNSAFE_style={{ height: '100%' }}>
                    <TitleBar
                        title={title}
                        variant={TitleBarVariant.Default}
                        version={platform.getVersionWithTag()}
                        state={TitleBarState.Default} // AUTO-UPDATE DISABLED - Always use Default state
                        // The window is created with `frame: false`, so the WM draws no
                        // controls. macOS still gets its traffic lights from
                        // `titleBarStyle: 'hidden'`; Windows and Linux get nothing, so we
                        // draw our own. Leaving this at win32 was why Linux had no
                        // minimize/maximize/close at all.
                        hasWindowControls={process.platform !== 'darwin'}
                        onMinimizeClicked={() => App.instance.minimize()}
                        onMaximizeClicked={() => App.instance.maximize()}
                        onCloseClicked={() => App.instance.close()}
                        onNewVersionAvailableClicked={onNewVersionAvailableClicked}
                    />

                    {children}
                </VStack>
            </Fragment>
        </div>
    );
}
