import { useModernModel } from '@xgenia-hooks/useModel';
import React, { useState } from 'react';
import { filesystem } from '@xgenia/platform';

import { CloudService } from '@xgenia-models/CloudServices';
import { ProjectModel } from '@xgenia-models/projectmodel';
import { createEditorCompilation } from '@xgenia-utils/compilation/compilation.editor';

import { PrimaryButton } from '@xgenia-core-ui/components/inputs/PrimaryButton';
import { Select } from '@xgenia-core-ui/components/inputs/Select';
import { PopupSection } from '@xgenia-core-ui/components/popups/PopupSection';
import { Text } from '@xgenia-core-ui/components/typography/Text';
import { TextType } from '@xgenia-core-ui/components/typography/Text/Text';

import { ToastLayer } from '../../../ToastLayer/ToastLayer';
import { NO_ENVIRONMENT_VALUE } from '../../DeployPopup.constants';
import { useEnvironmentsAsOptions } from '../../DeployPopup.hooks';

export function DeployToStakeTab() {
  const cloudService = useModernModel(CloudService.instance);
  const environmentOptions = useEnvironmentsAsOptions(cloudService);

  const [environmentId, setEnvironmentId] = useState<string>(NO_ENVIRONMENT_VALUE);
  const [successMessage, setSuccessMessage] = useState('');

  function onPickFolderClicked() {
    const activityId = 'deploying-project-to-stake';

    filesystem
      .openDialog({
        allowCreateDirectory: true
      })
      .then((direntry) => {
        const compilation = createEditorCompilation(ProjectModel.instance)
          .addProjectBuildScripts()
          .addBuildScript({
            async onPreBuild() {
              ToastLayer.showActivity('Exporting for Stake...', activityId);
              setSuccessMessage('');
            },
            async onPostBuild({ status }) {
              ToastLayer.hideActivity(activityId);
              if (status === 'success') {
                ToastLayer.showSuccess('Stake export successful!');
                setSuccessMessage('Stake export successful!');
              } else {
                ToastLayer.showError('Stake export failed.');
              }
            }
          });

        const environment = cloudService.backend.items.find((x) => x.id === environmentId);

        // NOTE: Fire-n-forget
        compilation.deployToFolder(direntry, {
          environment,
          runtimeType: 'stake'
        });
      });

    // Keep popup open so the confirmation message is visible
  }

  return (
    <>
      <PopupSection>
        <Text hasBottomSpacing textType={TextType.DefaultContrast}>
          Deploy a static frontend files to Stake.com (Pro Nodes)
        </Text>

        {successMessage && <Text style={{ marginTop: '8px', fontSize: '12px', color: '#6f6' }}>{successMessage}</Text>}

        {/* {Boolean(cloudService.backend.items?.length) && (
          <Select
            options={environmentOptions}
            onChange={(value: string) => setEnvironmentId(value)}
            placeholder="No cloud services"
            value={environmentId}
            label="Connected cloud services"
            hasBottomSpacing
          />
        )} */}

        <PrimaryButton label="Pick folder" onClick={onPickFolderClicked} />
      </PopupSection>
    </>
  );
}



