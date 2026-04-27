import React, { useState } from 'react';

import { ProjectModel } from '@xgenia-models/projectmodel';

import { Box } from '@xgenia-core-ui/components/layout/Box';
import { PropertyPanelCheckbox } from '@xgenia-core-ui/components/property-panel/PropertyPanelCheckbox';
import { PropertyPanelRow } from '@xgenia-core-ui/components/property-panel/PropertyPanelInput';
import { CollapsableSection } from '@xgenia-core-ui/components/sidebar/CollapsableSection';
import { Text } from '@xgenia-core-ui/components/typography/Text';

export function ExperimentalSection() {
  const [bodyScroll, setBodyScroll] = useState(!!ProjectModel.instance.settings['bodyScroll']);

  function handleBodyScroll(value: boolean) {
    setBodyScroll(value);
    ProjectModel.instance.setSetting('bodyScroll', value);
  }

  return (
    <CollapsableSection title="Experimental features" hasGutter hasVisibleOverflow hasTopDivider isClosed>
      <PropertyPanelRow label="Body Scroll">
        <PropertyPanelCheckbox value={bodyScroll} onChange={handleBodyScroll} />
      </PropertyPanelRow>
    </CollapsableSection>
  );
}
