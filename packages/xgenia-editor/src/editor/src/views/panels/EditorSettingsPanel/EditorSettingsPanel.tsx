import { useModel } from '@xgenia-hooks/useModel';
import React from 'react';

import { SidebarModel } from '@xgenia-models/sidebar';
import { EditorSettings } from '@xgenia-utils/editorsettings';

import { Checkbox, CheckboxVariant } from '@xgenia-core-ui/components/inputs/Checkbox';
import { Box } from '@xgenia-core-ui/components/layout/Box';
import { VStack } from '@xgenia-core-ui/components/layout/Stack';
import { BasePanel } from '@xgenia-core-ui/components/sidebar/BasePanel';
import { CollapsableSection } from '@xgenia-core-ui/components/sidebar/CollapsableSection';
import { ExperimentalFlag, ExperimentalFlagVariant } from '@xgenia-core-ui/components/sidebar/ExperimentalFlag';
import { Text, TextSize } from '@xgenia-core-ui/components/typography/Text';

export function EditorSettingsPanel() {
  // @ts-expect-error Model is yeah, not great!
  useModel(EditorSettings.instance, ['updated']);

  const experimentalPanels = SidebarModel.instance.getExperimentalItems();

  const experimentalFeatures = [
    {
      id: 'nodeGraphEditor.snapToGrid',
      settingsKey: 'nodeGraphEditor.snapToGrid',
      name: 'Snap nodes to grid',
      description: '',
      enabled: !!EditorSettings.instance.get('nodeGraphEditor.snapToGrid')
    }
  ];

  return (
    <BasePanel title="Editor Settings" hasContentScroll>
      {/* Only the panel list depends on there being experimental panels registered.
          The feature toggles below are independent — they used to share this guard,
          which meant unregistering the last experimental panel silently hid them. */}
      {Boolean(experimentalPanels.length) && (
        <CollapsableSection title="Experimental panels" isClosed>
          <ExperimentalFlag variant={ExperimentalFlagVariant.Small} />
          <Box hasXSpacing hasTopSpacing={1} hasBottomSpacing={5}>
            <VStack hasSpacing>
              {experimentalPanels.map((item) => (
                <ExperimentalFeatureItem key={item.id} {...item} labelPrefix="Enable " />
              ))}
            </VStack>
          </Box>
        </CollapsableSection>
      )}

      <CollapsableSection title="Experimental features" isClosed>
        <Box hasXSpacing hasTopSpacing={1} hasBottomSpacing={5}>
          <VStack hasSpacing>
            {experimentalFeatures.map((item) => (
              <ExperimentalFeatureItem key={item.id} {...item} />
            ))}
          </VStack>
        </Box>
      </CollapsableSection>
    </BasePanel>
  );
}

function ExperimentalFeatureItem(item) {
  return (
    <Box>
      <Checkbox
        key={item.id}
        label={`${item.labelPrefix || ''}${item.name}`}
        variant={CheckboxVariant.Sidebar}
        isChecked={item.enabled}
        onChange={(ev) => {
          EditorSettings.instance.set(item.settingsKey, ev.target.checked);
        }}
      />
      {Boolean(item.description) && (
        <Box hasXSpacing hasTopSpacing>
          <Text size={TextSize.Medium}>{item.description}</Text>
        </Box>
      )}
    </Box>
  );
}
