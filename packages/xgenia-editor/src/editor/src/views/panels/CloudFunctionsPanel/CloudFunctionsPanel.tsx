import { useActiveEnvironment } from '@xgenia-hooks/useActiveEnvironment';
import { ipcRenderer } from 'electron';
import React, { useState } from 'react';

import { Keybindings } from '@xgenia-constants/Keybindings';
import { CloudServiceType } from '@xgenia-models/CloudServices/type';
import { ProjectModel } from '@xgenia-models/projectmodel';

import { IconName } from '@xgenia-core-ui/components/common/Icon';
import { ActionButton, ActionButtonVariant } from '@xgenia-core-ui/components/inputs/ActionButton';
import {
  PrimaryButton,
  PrimaryButtonSize,
  PrimaryButtonVariant
} from '@xgenia-core-ui/components/inputs/PrimaryButton';
import { TextButton } from '@xgenia-core-ui/components/inputs/TextButton';
import { Box } from '@xgenia-core-ui/components/layout/Box';
import { Container, ContainerDirection } from '@xgenia-core-ui/components/layout/Container';
import { VStack, HStack } from '@xgenia-core-ui/components/layout/Stack';
import { Tooltip } from '@xgenia-core-ui/components/popups/Tooltip';
import { BasePanel } from '@xgenia-core-ui/components/sidebar/BasePanel';

import { ToastLayer } from '../../ToastLayer/ToastLayer';
import { ComponentsPanel } from '../componentspanel';
import { CorsConfigDialog } from './CorsConfigDialog';
import { SupabaseEdgeFunctionsPanel } from './SupabaseEdgeFunctionsPanel';

export function CloudFunctionsPanel() {
  const environment = useActiveEnvironment(ProjectModel.instance);
  const [showSupabasePanel, setShowSupabasePanel] = useState(false);
  const [showCorsDialog, setShowCorsDialog] = useState(false);
  const [selectedComponent, setSelectedComponent] = useState(null);

  const componentPanelOptions = {
    showSheetList: false,
    lockCurrentSheetName: '__cloud__',
    componentTitle: 'Cloud Components'
  };

  const isSupabaseEnvironment = environment?.type === CloudServiceType.SUPABASE;

  const handleOpenCorsDialog = () => {
    // Create a sample component for demonstration
    // In a real implementation, this would get the currently selected cloud function component
    const sampleComponent = {
      name: '/#__cloud__/my-cloud-function',
      id: 'sample-cloud-function-id',
      metadata: {
        cors: {
          allowedOrigins: '*',
          allowedMethods: 'GET, POST, PUT, DELETE, OPTIONS',
          allowedHeaders: 'Content-Type, Authorization, X-Parse-Application-Id, X-Parse-Session-Token',
          maxAge: '86400'
        }
      }
    };
    setSelectedComponent(sampleComponent);
    setShowCorsDialog(true);
  };

  const handleCorsSave = (corsConfig) => {
    console.log('CORS configuration saved:', corsConfig);

    // Show success message
    ToastLayer.showSuccess('CORS configuration saved successfully!');

    // In a real implementation, you would:
    // 1. Find the actual component in ProjectModel.instance
    // 2. Update its metadata with the new CORS configuration
    // 3. Save the project
    // 4. Optionally redeploy the function if it's already deployed

    // Example of what the real implementation might look like:
    // const component = ProjectModel.instance.getComponentWithName(selectedComponent.name);
    // if (component) {
    //   component.metadata = { ...component.metadata, cors: corsConfig };
    //   // Save project and potentially redeploy
    // }
  };

  // Show Supabase Edge Functions panel if requested
  if (showSupabasePanel) {
    return <SupabaseEdgeFunctionsPanel isVisible={showSupabasePanel} onClose={() => setShowSupabasePanel(false)} />;
  }

  return (
    <BasePanel title="Cloud Functions" isFill>
      <Container direction={ContainerDirection.Vertical} isFill>
        <ActionButton
          prefixText="Active cloud service"
          label={environment?.name}
          icon={IconName.CloudData}
          variant={ActionButtonVariant.Default}
          isInactive
        />

        <Box hasXSpacing hasYSpacing>
          <VStack>
            {/* Supabase Edge Functions Button */}
            {isSupabaseEnvironment && (
              <Box hasBottomSpacing>
                <Tooltip content="Manage Supabase Edge Functions">
                  <PrimaryButton
                    icon={IconName.CloudFunction}
                    label="Supabase Edge Functions"
                    size={PrimaryButtonSize.Small}
                    variant={PrimaryButtonVariant.MutedOnLowBg}
                    onClick={() => setShowSupabasePanel(true)}
                    isGrowing
                  />
                </Tooltip>
              </Box>
            )}

            <Box hasBottomSpacing>
              <Tooltip content="Open cloud dev tools" fineType={Keybindings.OPEN_CLOUD_DEVTOOLS.label}>
                <PrimaryButton
                  icon={IconName.Bug}
                  label="Open cloud dev tools"
                  size={PrimaryButtonSize.Small}
                  variant={PrimaryButtonVariant.MutedOnLowBg}
                  onClick={() => ipcRenderer.send('cloud-runtime-open-devtools')}
                  isGrowing
                />
              </Tooltip>
            </Box>
            <Box hasBottomSpacing>
              <Tooltip content="Refresh cloud functions">
                <PrimaryButton
                  icon={IconName.Refresh}
                  label="Refresh cloud functions"
                  size={PrimaryButtonSize.Small}
                  variant={PrimaryButtonVariant.MutedOnLowBg}
                  onClick={() => ipcRenderer.send('cloud-runtime-refresh')}
                  isGrowing
                />
              </Tooltip>
            </Box>

            {/* CORS Configuration Button */}
            {isSupabaseEnvironment && (
              <Tooltip content="Configure CORS settings for browser access">
                <PrimaryButton
                  icon={IconName.Setting}
                  label="Configure CORS"
                  size={PrimaryButtonSize.Small}
                  variant={PrimaryButtonVariant.MutedOnLowBg}
                  onClick={handleOpenCorsDialog}
                  isGrowing
                />
              </Tooltip>
            )}
          </VStack>
        </Box>

        <div style={{ flex: '1', overflow: 'hidden' }}>
          <ComponentsPanel options={componentPanelOptions} />
        </div>
      </Container>

      {/* CORS Configuration Dialog */}
      {showCorsDialog && selectedComponent && (
        <CorsConfigDialog
          component={selectedComponent}
          onClose={() => setShowCorsDialog(false)}
          onSave={handleCorsSave}
        />
      )}
    </BasePanel>
  );
}
