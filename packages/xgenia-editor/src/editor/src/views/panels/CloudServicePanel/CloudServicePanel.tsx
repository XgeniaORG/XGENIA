import { useModernModel } from '@xgenia-hooks/useModel';
import React, { useState } from 'react';

import { CloudService } from '@xgenia-models/CloudServices';

import { ActivityIndicator } from '@xgenia-core-ui/components/common/ActivityIndicator';
import { IconName, IconSize } from '@xgenia-core-ui/components/common/Icon';
import { IconButton } from '@xgenia-core-ui/components/inputs/IconButton';
import { PrimaryButton } from '@xgenia-core-ui/components/inputs/PrimaryButton';
import { Box } from '@xgenia-core-ui/components/layout/Box';
import { ConditionalContainer } from '@xgenia-core-ui/components/layout/ConditionalContainer';
import { Container } from '@xgenia-core-ui/components/layout/Container';
import { VStack } from '@xgenia-core-ui/components/layout/Stack';
import { useConfirmationDialog } from '@xgenia-core-ui/components/popups/ConfirmationDialog/ConfirmationDialog.hooks';
import { BasePanel } from '@xgenia-core-ui/components/sidebar/BasePanel';
import { Section, SectionVariant } from '@xgenia-core-ui/components/sidebar/Section';
import { Text } from '@xgenia-core-ui/components/typography/Text';

import { CloudServiceCardItem } from './CloudServiceCardItem';
import { CloudServiceCreateModal } from './CloudServiceCreateModal/CloudServiceCreateModal';
import { CloudServiceContextProvider, useCloudServiceContext } from './CloudServicePanel.context';

export function CloudServicePanel() {
  return (
    <CloudServiceContextProvider>
      <CloudServicePanelChild />
    </CloudServiceContextProvider>
  );
}

function CloudServicePanelChild() {
  const { hasActivity } = useCloudServiceContext();
  const cloudService = useModernModel(CloudService.instance);

  const [DeleteDialog, deleteEnvironment] = useConfirmationDialog({
    title: 'Please confirm',
    message: 'Are you sure you want to delete this cloud service?',
    isDangerousAction: true
  });

  const [isCreateModalVisible, setIsCreateModalVisible] = useState(false);

  return (
    <BasePanel title="Cloud Services" hasActivityBlocker={hasActivity} hasContentScroll>
      <DeleteDialog />

      <ConditionalContainer doRenderWhen={Boolean(cloudService.backend.items)} loaderVisibilityDelayMs={0}>
        <>
          <Section
            title="Available Cloud Services"
            variant={SectionVariant.Panel}
            actions={
              <IconButton
                icon={IconName.Plus}
                size={IconSize.Small}
                onClick={() => setIsCreateModalVisible(true)}
                testId="add-cloud-service-tab-button"
              />
            }
          >
            {cloudService.backend.items?.length ? (
              <VStack>
                {cloudService.backend.items?.map((environment) => (
                  <CloudServiceCardItem
                    key={environment.id}
                    environment={environment}
                    deleteEnvironment={deleteEnvironment}
                  />
                ))}
              </VStack>
            ) : cloudService.backend.isLoading ? (
              <Container hasLeftSpacing hasTopSpacing>
                <ActivityIndicator />
              </Container>
            ) : (
              <Container hasLeftSpacing hasTopSpacing>
                <Text>No cloud services</Text>
              </Container>
            )}
          </Section>
        </>
      </ConditionalContainer>

      <CloudServiceCreateModal isVisible={isCreateModalVisible} onClose={() => setIsCreateModalVisible(false)} />
    </BasePanel>
  );
}
