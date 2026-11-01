import React from 'react';

import { PropertyPanelRow } from '@xgenia-core-ui/components/property-panel/PropertyPanelInput';
import { PropertyPanelSelectInput } from '@xgenia-core-ui/components/property-panel/PropertyPanelSelectInput';
import { PropertyPanelTextInput } from '@xgenia-core-ui/components/property-panel/PropertyPanelTextInput';
import { CollapsableSection } from '@xgenia-core-ui/components/sidebar/CollapsableSection';

import { useProjectSetting } from '../useProjectSetting';

/**
 * `simple` (the newcomer rail, "Show all tools" off): only the title, which is the one a game maker
 * recognises. Head code, the tools path and the URL path type are web-site plumbing.
 */
export function GeneralSection({ simple = false }: { simple?: boolean }) {
  const [htmlTitle, setHtmlTitle] = useProjectSetting('htmlTitle', 'XGENIA Viewer');
  const [headCode, setHeadCode] = useProjectSetting('headCode', '');
  const [toolsProjectPath, setToolsProjectPath] = useProjectSetting('toolsProjectPath', '');
  const [navigationPathType, setNavigationPathType] = useProjectSetting('navigationPathType', 'hash');

  return (
    <CollapsableSection title="General" hasGutter hasVisibleOverflow hasTopDivider isClosed={!simple}>
      <PropertyPanelRow label="Title">
        <PropertyPanelTextInput value={htmlTitle} onChange={setHtmlTitle} />
      </PropertyPanelRow>

      {!simple && (
        <>
          <PropertyPanelRow label="Head Code">
            <PropertyPanelTextInput value={headCode} onChange={setHeadCode} />
          </PropertyPanelRow>

          <PropertyPanelRow label="Tools Project Path">
            <PropertyPanelTextInput value={toolsProjectPath} onChange={setToolsProjectPath} />
          </PropertyPanelRow>

          <PropertyPanelRow label="URL Path Type">
            <PropertyPanelSelectInput
              value={navigationPathType}
              onChange={(value) => setNavigationPathType(String(value))}
              properties={{
                options: [
                  { label: 'Hash', value: 'hash' },
                  { label: 'Path', value: 'path' }
                ]
              }}
            />
          </PropertyPanelRow>
        </>
      )}
    </CollapsableSection>
  );
}
