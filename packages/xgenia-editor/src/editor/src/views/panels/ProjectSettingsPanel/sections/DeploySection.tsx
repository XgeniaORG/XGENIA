import React, { useState } from 'react';

import { ProjectModel } from '@xgenia-models/projectmodel';

import { Box } from '@xgenia-core-ui/components/layout/Box';
import { PropertyPanelCheckbox } from '@xgenia-core-ui/components/property-panel/PropertyPanelCheckbox';
import { PropertyPanelRow } from '@xgenia-core-ui/components/property-panel/PropertyPanelInput';
import { PropertyPanelTextInput } from '@xgenia-core-ui/components/property-panel/PropertyPanelTextInput';
import { CollapsableSection } from '@xgenia-core-ui/components/sidebar/CollapsableSection';
import { ExperimentalFlag, ExperimentalFlagVariant } from '@xgenia-core-ui/components/sidebar/ExperimentalFlag';
import { Text } from '@xgenia-core-ui/components/typography/Text';

export function DeploySection() {
  const [enabledDeployDate, setEnabledDeployDate] = useState(!!ProjectModel.instance.settings['deployEnvDate']);
  const [enabledGitStats, setEnabledGitStats] = useState(!!ProjectModel.instance.settings['deployEnvGitStats']);
  const [baseUrl, setBaseUrl] = useState<string>(ProjectModel.instance.settings['baseUrl']);

  function handleBaseUrl(value: string) {
    setBaseUrl(value);
    ProjectModel.instance.setSetting('baseUrl', value);
  }

  function handleEnableDeployDate(value: boolean) {
    setEnabledDeployDate(value);
    ProjectModel.instance.setSetting('deployEnvDate', value);
  }

  function handleEnableGitStats(value: boolean) {
    setEnabledGitStats(value);
    ProjectModel.instance.setSetting('deployEnvGitStats', value);
  }

  return (
    <CollapsableSection title="Experimental features - Deploy Settings" hasGutter hasVisibleOverflow isClosed>
      <ExperimentalFlag
        variant={ExperimentalFlagVariant.NoPadding}
        text="All these settings are temporary and will be moved to another place in a future version."
      />
      <Box hasBottomSpacing>
        <Text>The Base Url.</Text>
      </Box>
      <PropertyPanelRow label="Custom Base Url">
        <PropertyPanelTextInput value={baseUrl} onChange={handleBaseUrl} />
      </PropertyPanelRow>
      <PropertyPanelRow label="Deploy Date">
        <PropertyPanelCheckbox value={enabledDeployDate} onChange={handleEnableDeployDate} />
      </PropertyPanelRow>
      <PropertyPanelRow label="Git Stats">
        <PropertyPanelCheckbox value={enabledGitStats} onChange={handleEnableGitStats} />
      </PropertyPanelRow>
    </CollapsableSection>
  );
}
