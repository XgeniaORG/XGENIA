import React from 'react';

import { PropertyPanelCheckbox } from '@xgenia-core-ui/components/property-panel/PropertyPanelCheckbox';
import { PropertyPanelRow } from '@xgenia-core-ui/components/property-panel/PropertyPanelInput';
import { CollapsableSection } from '@xgenia-core-ui/components/sidebar/CollapsableSection';

import { useProjectSetting } from '../useProjectSetting';

export function SitemapSection() {
  const [enabled, setEnabled] = useProjectSetting('sitemap.enabled', false);

  return (
    <CollapsableSection title="Experimental features - Sitemap" hasGutter hasVisibleOverflow hasTopDivider isClosed>
      <PropertyPanelRow label="Enable">
        <PropertyPanelCheckbox value={enabled} onChange={setEnabled} />
      </PropertyPanelRow>
    </CollapsableSection>
  );
}
