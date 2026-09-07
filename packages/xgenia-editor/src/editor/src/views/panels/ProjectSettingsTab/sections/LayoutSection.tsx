import React from 'react';

import { PropertyPanelCheckbox } from '@xgenia-core-ui/components/property-panel/PropertyPanelCheckbox';
import { PropertyPanelRow } from '@xgenia-core-ui/components/property-panel/PropertyPanelInput';
import { CollapsableSection } from '@xgenia-core-ui/components/sidebar/CollapsableSection';

import { useProjectSetting } from '../useProjectSetting';

export function LayoutSection() {
  const [bodyScroll, setBodyScroll] = useProjectSetting('bodyScroll', false);

  return (
    <CollapsableSection title="Layout" hasGutter hasVisibleOverflow hasTopDivider isClosed>
      <PropertyPanelRow label="Body Scroll">
        <PropertyPanelCheckbox value={bodyScroll} onChange={setBodyScroll} />
      </PropertyPanelRow>
    </CollapsableSection>
  );
}
