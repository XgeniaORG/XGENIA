import React from 'react';
import { createRoot } from 'react-dom/client';
import { ipcRenderer } from 'electron';

import { LocalStorageKey } from '@xgenia-constants/LocalStorageKey';
import getDocsEndpoint from '@xgenia-utils/getDocsEndpoint';
import PopupLayer from './views/popuplayer';
import { NewsModal } from './views/NewsModal';

/**
 * Display latest what's-new-post if the user hasn't seen one after it was last published
 */
export async function whatsnewRender() {
    // News modal disabled
    return;

    const newEditorVersionAvailable = JSON.parse(localStorage.getItem(LocalStorageKey.hasNewEditorVersionAvailable));

    // If user runs an older version, the changelog will be irrelevant
    if (newEditorVersionAvailable) return;

    const latestChangelogPost = await fetch(`${getDocsEndpoint()}/whats-new/feed.json`)
        .then((data) => data.json())
        .then((json) => json.items[0]);

    const lastSeenChangelogDate = new Date(
        JSON.parse(localStorage.getItem(LocalStorageKey.lastSeenChangelogDate))
    ).getTime();
    const latestChangelogDate = new Date(latestChangelogPost.date_modified).getTime();

    if (lastSeenChangelogDate >= latestChangelogDate) return;

    ipcRenderer.send('viewer-hide');

    // Ensure modal container exists
    let modalContainer = document.getElementById('modal-root');

    if (!modalContainer) {
        modalContainer = document.createElement('div');
        modalContainer.id = 'modal-root';
        modalContainer.classList.add('popup-layer-react-modal');
        PopupLayer.instance.el.find('.popup-layer-modal').before(modalContainer);
    }

    // Render the modal using createRoot
    const root = createRoot(modalContainer);
    root.render(
        React.createElement(NewsModal, {
            content: latestChangelogPost.content_html,
            onFinished: () => {
                ipcRenderer.send('viewer-show');
                root.unmount(); // Cleanup when modal closes
            }
        })
    );

    // Update local storage
    localStorage.setItem(LocalStorageKey.lastSeenChangelogDate, latestChangelogDate.toString());
}
