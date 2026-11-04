import React, { RefObject, useState } from 'react';

import { ProjectModel } from '@xgenia-models/projectmodel';

import { ActivityIndicator } from '@xgenia-core-ui/components/common/ActivityIndicator';
import { BaseDialog } from '@xgenia-core-ui/components/layout/BaseDialog';
import { Tabs } from '@xgenia-core-ui/components/layout/Tabs';
import { PopupSection } from '@xgenia-core-ui/components/popups/PopupSection';

import { DeployContextProvider, useDeployContext } from './DeployPopup.context';
import { DeployToFolderTab } from './tabs/DeployToFolderTab';
import { Fold, XgeniaDeployTab } from './tabs/XgeniaDeployTab';
import { DeployToStakeTab } from './tabs/DeployToStakeTab/DeployToStakeTab';

function DeployPopupChild() {
  const { hasActivity } = useDeployContext();
  const [showOther, setShowOther] = useState(false);

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

        {/* (2026-11-04) Publishing to XGENIA is the job; self-hosting and Stake are other ways, folded away rather
            than tabs that sit level with it. */}
        <XgeniaDeployTab />
        <div style={{ padding: '0 16px 14px' }}>
          <Fold title="Other ways to publish" isOpen={showOther} onToggle={() => setShowOther(!showOther)}>
            <Tabs
              tabs={[
                { label: 'Self hosting', content: <DeployToFolderTab />, testId: 'self-hosting-tab-button' },
                { label: 'Stake', content: <DeployToStakeTab />, testId: 'stake-tab-button' }
              ]}
            />
          </Fold>
        </div>

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
    <DeployContextProvider onClose={props.onClose}>
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
