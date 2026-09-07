import { useModel } from '@xgenia-hooks/useModel';
import React from 'react';

import { SidebarModel } from '@xgenia-models/sidebar';
import { EditorSettings } from '@xgenia-utils/editorsettings';

import { Checkbox, CheckboxVariant } from '@xgenia-core-ui/components/inputs/Checkbox';
import { Box } from '@xgenia-core-ui/components/layout/Box';
import { VStack } from '@xgenia-core-ui/components/layout/Stack';
import { CollapsableSection } from '@xgenia-core-ui/components/sidebar/CollapsableSection';
import { ExperimentalFlag, ExperimentalFlagVariant } from '@xgenia-core-ui/components/sidebar/ExperimentalFlag';
import { Section } from '@xgenia-core-ui/components/sidebar/Section';
import { Text, TextSize } from '@xgenia-core-ui/components/typography/Text';

/**
 * Editor-scoped settings — the "Editor" tab of the Settings panel.
 *
 * Everything here goes to `EditorSettings`, which persists to JSONStorage under
 * the `editorSettings` key: it is per-machine, never enters project.json and
 * never reaches the deployed app. See ProjectSettingsTab for the other scope.
 */
export function EditorSettingsTab() {
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
    <>
      <Section hasGutter hasVisibleOverflow>
        <Text size={TextSize.Medium}>Applies to this machine only — not saved in the project.</Text>
      </Section>

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
    </>
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
