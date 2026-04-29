import { useProjectDesignTokenContext } from '@xgenia-contexts/ProjectDesignTokenContext';
import React from 'react';

import { Box } from '@xgenia-core-ui/components/layout/Box';
import { VStack } from '@xgenia-core-ui/components/layout/Stack';
import { Tabs, TabsVariant } from '@xgenia-core-ui/components/layout/Tabs';
import { BasePanel } from '@xgenia-core-ui/components/sidebar/BasePanel';
import { Section } from '@xgenia-core-ui/components/sidebar/Section';
import { Label } from '@xgenia-core-ui/components/typography/Label';

import { ColorsTab } from './components/ColorsTab';

export function DesignTokenPanel() {
  const { textStyles } = useProjectDesignTokenContext();

  return (
    <BasePanel title="Design Tokens">
      <Tabs
        variant={TabsVariant.Sidebar}
        tabs={[
          {
            label: 'Colors',
            content: <ColorsTab />
          },
          {
            label: 'Typography',
            content: (
              <Section title="Experimental features">
                <Box hasXSpacing hasTopSpacing>
                  <VStack>
                    {textStyles.map((textStyle) => (
                      <Box key={textStyle.name} hasBottomSpacing={1}>
                        <Label>{JSON.stringify(textStyle)}</Label>
                      </Box>
                    ))}
                  </VStack>
                </Box>
              </Section>
            )
          }
        ]}
      />
    </BasePanel>
  );
}
