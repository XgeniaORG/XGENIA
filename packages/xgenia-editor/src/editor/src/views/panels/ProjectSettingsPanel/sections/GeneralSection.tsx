import React, { useState } from 'react';

import { ProjectModel } from '@xgenia-models/projectmodel';

import { Box } from '@xgenia-core-ui/components/layout/Box';
import { PropertyPanelRow } from '@xgenia-core-ui/components/property-panel/PropertyPanelInput';
import { PropertyPanelTextInput } from '@xgenia-core-ui/components/property-panel/PropertyPanelTextInput';
import { PropertyPanelSelectInput } from '@xgenia-core-ui/components/property-panel/PropertyPanelSelectInput';
import { CollapsableSection } from '@xgenia-core-ui/components/sidebar/CollapsableSection';
import { Text } from '@xgenia-core-ui/components/typography/Text';

export function GeneralSection() {
  const [htmlTitle, setHtmlTitle] = useState(ProjectModel.instance.settings['htmlTitle'] || 'XGENIA Viewer');
  const [headCode, setHeadCode] = useState(ProjectModel.instance.settings['headCode'] || '');
  const [toolsProjectPath, setToolsProjectPath] = useState(ProjectModel.instance.settings['toolsProjectPath'] || '');
  const [navigationPathType, setNavigationPathType] = useState(ProjectModel.instance.settings['navigationPathType'] || 'hash');

  function handleHtmlTitle(value: string) {
    setHtmlTitle(value);
    ProjectModel.instance.setSetting('htmlTitle', value);
  }

  function handleHeadCode(value: string) {
    setHeadCode(value);
    ProjectModel.instance.setSetting('headCode', value);
  }

  function handleToolsProjectPath(value: string) {
    setToolsProjectPath(value);
    ProjectModel.instance.setSetting('toolsProjectPath', value);
  }

  function handleNavigationPathType(value: string | number) {
    setNavigationPathType(String(value));
    ProjectModel.instance.setSetting('navigationPathType', String(value));
  }

  return (
    <CollapsableSection title="General" hasGutter hasVisibleOverflow hasTopDivider isClosed>
      <PropertyPanelRow label="Title">
        <PropertyPanelTextInput value={htmlTitle} onChange={handleHtmlTitle} />
      </PropertyPanelRow>

      <PropertyPanelRow label="Head Code">
        <PropertyPanelTextInput value={headCode} onChange={handleHeadCode} />
      </PropertyPanelRow>

      <PropertyPanelRow label="Tools Project Path">
        <PropertyPanelTextInput value={toolsProjectPath} onChange={handleToolsProjectPath} />
      </PropertyPanelRow>

      <PropertyPanelRow label="URL Path Type">
        <PropertyPanelSelectInput
          value={navigationPathType}
          onChange={handleNavigationPathType}
          properties={{
            options: [
              { label: 'Hash', value: 'hash' },
              { label: 'Path', value: 'path' }
            ]
          }}
        />
      </PropertyPanelRow>
    </CollapsableSection>
  );
}
