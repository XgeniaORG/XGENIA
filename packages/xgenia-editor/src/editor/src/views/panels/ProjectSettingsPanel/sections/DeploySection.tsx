import React from 'react';

import { Box } from '@xgenia-core-ui/components/layout/Box';
import { PropertyPanelCheckbox } from '@xgenia-core-ui/components/property-panel/PropertyPanelCheckbox';
import { PropertyPanelRow } from '@xgenia-core-ui/components/property-panel/PropertyPanelInput';
import { PropertyPanelTextInput } from '@xgenia-core-ui/components/property-panel/PropertyPanelTextInput';
import { CollapsableSection } from '@xgenia-core-ui/components/sidebar/CollapsableSection';
import { ExperimentalFlag, ExperimentalFlagVariant } from '@xgenia-core-ui/components/sidebar/ExperimentalFlag';
import { Text } from '@xgenia-core-ui/components/typography/Text';

import { useProjectSetting } from '../useProjectSetting';

export function DeploySection() {
  const [baseUrl, setBaseUrl] = useProjectSetting('baseUrl', '');
  const [enabledDeployDate, setEnabledDeployDate] = useProjectSetting('deployEnvDate', false);
  const [enabledGitStats, setEnabledGitStats] = useProjectSetting('deployEnvGitStats', false);

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
        <PropertyPanelTextInput value={baseUrl} onChange={setBaseUrl} />
      </PropertyPanelRow>
      <PropertyPanelRow label="Deploy Date">
        <PropertyPanelCheckbox value={enabledDeployDate} onChange={setEnabledDeployDate} />
      </PropertyPanelRow>
      <PropertyPanelRow label="Git Stats">
        <PropertyPanelCheckbox value={enabledGitStats} onChange={setEnabledGitStats} />
      </PropertyPanelRow>
    </CollapsableSection>
  );
}
