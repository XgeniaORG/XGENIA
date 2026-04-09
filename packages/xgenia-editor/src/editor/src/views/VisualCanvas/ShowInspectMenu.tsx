import { getCurrentWindow, screen } from '@electron/remote';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MenuDialog, MenuDialogWidth } from '@xgenia-core-ui/components/popups/MenuDialog';

import PopupLayer from '../popuplayer';

export function showInspectMenu(items: TSFixme) {
  const container = document.createElement('div');
  const screenPoint = screen.getCursorScreenPoint();
  const [winX, winY] = getCurrentWindow().getPosition();

    const root = createRoot(container);
    const popout = PopupLayer.instance.showPopout({
        content: { el: $(container) },
        arrowColor: 'transparent',
        attachToPoint: {
            x: screenPoint.x - winX,
            y: screenPoint.y - winY
        },
        position: 'top',
        onClose: () => {
            // Use the new unmount API
            root.unmount();
        }
    });


    root.render(
        <MenuDialog
            title="Nodes"
            width={MenuDialogWidth.Large}
            isVisible={true}
            triggerRef={{ current: container }}
            onClose={() => {
                PopupLayer.instance.hidePopout(popout);
                root.unmount(); // Unmount the component when the menu is closed
            }}
            items={items}
        />
    );
}
