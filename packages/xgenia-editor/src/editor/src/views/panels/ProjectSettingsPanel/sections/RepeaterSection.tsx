import React, { useState } from 'react';

import { ProjectModel } from '@xgenia-models/projectmodel';

import { Box } from '@xgenia-core-ui/components/layout/Box';
import { PropertyPanelCheckbox } from '@xgenia-core-ui/components/property-panel/PropertyPanelCheckbox';
import { PropertyPanelRow } from '@xgenia-core-ui/components/property-panel/PropertyPanelInput';
import { CollapsableSection } from '@xgenia-core-ui/components/sidebar/CollapsableSection';
import { Text } from '@xgenia-core-ui/components/typography/Text';

export function RepeaterSection() {
  const [disabledWhenUnmounted, setDisabledWhenUnmounted] = useState(!!ProjectModel.instance.settings['repeaterDisabledWhenUnmounted']);
  const [createComponentsAsync, setCreateComponentsAsync] = useState(!!ProjectModel.instance.settings['repeaterCreateComponentsAsync']);

  function handleDisabledWhenUnmounted(value: boolean) {
    setDisabledWhenUnmounted(value);
    ProjectModel.instance.setSetting('repeaterDisabledWhenUnmounted', value);
  }

  function handleCreateComponentsAsync(value: boolean) {
    setCreateComponentsAsync(value);
    ProjectModel.instance.setSetting('repeaterCreateComponentsAsync', value);
  }

  return (
    <CollapsableSection title="Experimental features - Repeater" hasGutter hasVisibleOverflow hasTopDivider isClosed>
      <PropertyPanelRow label="Disable when unmounted">
        <PropertyPanelCheckbox value={disabledWhenUnmounted} onChange={handleDisabledWhenUnmounted} />
      </PropertyPanelRow>
      <PropertyPanelRow label="Create asynchronously">
        <PropertyPanelCheckbox value={createComponentsAsync} onChange={handleCreateComponentsAsync} />
      </PropertyPanelRow>
    </CollapsableSection>
  );
}
