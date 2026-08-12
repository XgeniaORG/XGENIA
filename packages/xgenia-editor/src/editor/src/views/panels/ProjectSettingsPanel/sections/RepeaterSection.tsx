import React from 'react';

import { PropertyPanelCheckbox } from '@xgenia-core-ui/components/property-panel/PropertyPanelCheckbox';
import { PropertyPanelRow } from '@xgenia-core-ui/components/property-panel/PropertyPanelInput';
import { CollapsableSection } from '@xgenia-core-ui/components/sidebar/CollapsableSection';

import { useProjectSetting } from '../useProjectSetting';

export function RepeaterSection() {
  const [disabledWhenUnmounted, setDisabledWhenUnmounted] = useProjectSetting(
    'repeaterDisabledWhenUnmounted',
    false
  );
  const [createComponentsAsync, setCreateComponentsAsync] = useProjectSetting(
    'repeaterCreateComponentsAsync',
    false
  );

  return (
    <CollapsableSection title="Experimental features - Repeater" hasGutter hasVisibleOverflow hasTopDivider isClosed>
      <PropertyPanelRow label="Disable when unmounted">
        <PropertyPanelCheckbox value={disabledWhenUnmounted} onChange={setDisabledWhenUnmounted} />
      </PropertyPanelRow>
      <PropertyPanelRow label="Create asynchronously">
        <PropertyPanelCheckbox value={createComponentsAsync} onChange={setCreateComponentsAsync} />
      </PropertyPanelRow>
    </CollapsableSection>
  );
}
