import { autoUpdateActions, useAutoUpdateState } from '@xgenia-hooks/useAutoUpdateState';
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

// Per renderer, not per BaseWindow: switching pages remounts this component, and the "ready"
// dialog should open once per downloaded version, not on every page.
let promptedUpdateVersion: string | null = null;
// Same for a failed update: told once per failure.
let shownUpdateFailure: string | null = null;

export function BaseWindow({
    title = ProjectModel.instance?.name || 'XGENIA',
    variant = BaseWindowVariant.Default,
    children
}: BaseWindowProps) {
    // Drives the maximize/restore glyph. Sourced from the window rather than from our own
    // clicks, because the WM can maximize us too (see App.onMaximizedChanged).
    const [isMaximized, setIsMaximized] = useState(() => App.instance.isMaximized());
    useEffect(() => App.instance.onMaximizedChanged(setIsMaximized), []);

    const update = useAutoUpdateState();

    const [UpdateDialog, showUpdateDialog] = useConfirmationDialog({
        title: 'Update ready',
        message: `XGENIA ${update.version ?? ''} has been downloaded. Restart now to install it, or it installs the next time you quit XGENIA.`,
        confirmButtonLabel: 'Restart now',
        cancelButtonLabel: 'Later'
    });

    function askToRestart() {
        showUpdateDialog()
            .then(() => autoUpdateActions.install())
            .catch(() => {
                /* Later: it installs on quit */
            });
    }

    // Open the dialog once when an update becomes ready; after "Later", the title bar button stays.
    useEffect(() => {
        if (update.status === 'ready' && update.version && promptedUpdateVersion !== update.version) {
            promptedUpdateVersion = update.version;
            askToRestart();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [update.status, update.version]);

    // An update that failed while downloading or installing (on macOS: Squirrel could not stage it)
    // is told to the user, not only logged. The next check tries again.
    const [FailureDialog, showFailureDialog] = useConfirmationDialog(
        {
            title: 'Update failed',
            message: `XGENIA ${update.failure?.version ?? ''} could not be installed: ${update.failure?.message ?? ''}. XGENIA will try again later, or use Settings → Editor → Updates → Check for updates.`,
            confirmButtonLabel: 'OK',
            isCancelButtonHidden: true
        },
        true
    );
    useEffect(() => {
        if (update.failure && shownUpdateFailure !== update.failure.at) {
            shownUpdateFailure = update.failure.at;
            showFailureDialog().catch(() => {});
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [update.failure?.at]);

    const titleBarState =
        update.status === 'ready'
            ? TitleBarState.Updated
            : update.status === 'downloading'
              ? TitleBarState.UpdateDownloading
              : TitleBarState.Default;

    return (
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}>
            {/* Wrap the ENTIRE content in a Fragment */}
            <Fragment>
                {UpdateDialog()}
                {FailureDialog()}

                <VStack UNSAFE_style={{ height: '100%' }}>
                    <TitleBar
                        title={title}
                        variant={TitleBarVariant.Default}
                        version={platform.getVersionWithTag()}
                        state={titleBarState}
                        updateProgress={update.percent}
                        // The window is created with `frame: false`, so the WM draws no
                        // controls. macOS still gets its traffic lights from
                        // `titleBarStyle: 'hidden'`; Windows and Linux get nothing, so we
                        // draw our own. Leaving this at win32 was why Linux had no
                        // minimize/maximize/close at all.
                        hasWindowControls={process.platform !== 'darwin'}
                        isMaximized={isMaximized}
                        onMinimizeClicked={() => App.instance.minimize()}
                        onMaximizeClicked={() => App.instance.maximize()}
                        onCloseClicked={() => App.instance.close()}
                        onNewUpdateAvailableClicked={askToRestart}
                    />

                    {children}
                </VStack>
            </Fragment>
        </div>
    );
}
