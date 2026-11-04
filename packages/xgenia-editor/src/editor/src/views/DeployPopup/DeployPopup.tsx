import React, { RefObject } from 'react';

import { ProjectModel } from '@xgenia-models/projectmodel';

import { ActivityIndicator } from '@xgenia-core-ui/components/common/ActivityIndicator';
import { BaseDialog } from '@xgenia-core-ui/components/layout/BaseDialog';
import { PopupSection } from '@xgenia-core-ui/components/popups/PopupSection';

import { DeployContextProvider, useDeployContext } from './DeployPopup.context';
import { XgeniaDeployTab } from './tabs/XgeniaDeployTab';

function DeployPopupChild() {
  const { hasActivity } = useDeployContext();

  return (
    <div style={{ width: 400 }}>
      <div
        style={{
          backgroundColor: '#444444',
          position: 'relative',
          maxHeight: `calc(90vh - 40px)`,
          overflowY: 'overlay',
          overflowX: 'hidden'
        }}
      >
        <PopupSection title="Publish" />

        {/* Other ways to ship the game (download, Stake) are a page inside the Publish window. */}
        <XgeniaDeployTab />

        {hasActivity && <ActivityIndicator isOverlay />}
      </div>
    </div>
  );
}

export interface DeployPopupProps {
  triggerRef: RefObject<HTMLElement>;
  isVisible: boolean;
  onClose: () => void;
}

export function DeployPopup(props: DeployPopupProps) {
  return (
    <DeployContextProvider onClose={props.onClose} isVisible={props.isVisible}>
      <BaseDialog
        triggerRef={props.triggerRef}
        isVisible={props.isVisible}
        onClose={props.onClose}
        hasArrow
        isLockingScroll
        alwaysMounted
      >
        <DeployPopupChild />
      </BaseDialog>
    </DeployContextProvider>
  );
}
