import React, { RefObject } from 'react';

import { ProjectModel } from '@xgenia-models/projectmodel';

import { ActivityIndicator } from '@xgenia-core-ui/components/common/ActivityIndicator';
import { BaseDialog } from '@xgenia-core-ui/components/layout/BaseDialog';
import { Tabs } from '@xgenia-core-ui/components/layout/Tabs';
import { PopupSection } from '@xgenia-core-ui/components/popups/PopupSection';

import { DeployContextProvider, useDeployContext } from './DeployPopup.context';
import { DeployToFolderTab } from './tabs/DeployToFolderTab';
import { XgeniaDeployTab } from './tabs/XgeniaDeployTab';
import { DeployToStakeTab } from './tabs/DeployToStakeTab/DeployToStakeTab';

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
        <PopupSection title="Publish options" />

        <Tabs
          tabs={[
            { label: 'XGENIA', content: <XgeniaDeployTab />, testId: 'xgenia-tab-button' },
            { label: 'Self Hosting', content: <DeployToFolderTab />, testId: 'self-hosting-tab-button' },
            { label: 'Deploy to Stake', content: <DeployToStakeTab />, testId: 'stake-tab-button' }
          ]}
        />

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
    <DeployContextProvider>
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
