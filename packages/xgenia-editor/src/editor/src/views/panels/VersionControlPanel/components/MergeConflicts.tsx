import React from 'react';

import { Icon, IconName, IconSize } from '@xgenia-core-ui/components/common/Icon';
import { VStack } from '@xgenia-core-ui/components/layout/Stack';
import { Section } from '@xgenia-core-ui/components/sidebar/Section';
import { Label } from '@xgenia-core-ui/components/typography/Label';
import { Box } from '@xgenia-core-ui/components/layout/Box';
import { Text, TextType } from '@xgenia-core-ui/components/typography/Text';
import { Container } from '@xgenia-core-ui/components/layout/Container';
import { PrimaryButton, PrimaryButtonSize } from '@xgenia-core-ui/components/inputs/PrimaryButton';

export function MergeConflicts() {
  return (
    <VStack>
      <Section hasVisibleOverflow hasGutter>
        <Container>
          <Icon icon={IconName.WarningTriangle} size={IconSize.Small} />
          <Box>
            <Label hasLeftSpacing variant={TextType.Shy}>
              Warning
            </Label>
            <Label hasLeftSpacing>Merge conflict</Label>
          </Box>
        </Container>
      </Section>
      <Section hasVisibleOverflow hasGutter>
        <Text hasBottomSpacing>
          You and your collaborators have made changes to the same nodes and you need to resolve them
        </Text>
        <PrimaryButton
          label="Open warnings"
          isGrowing
          size={PrimaryButtonSize.Small}
          onClick={() => {
            // The top bar only renders the warnings badge when there ARE warnings, so
            // this lookup can legitimately miss. It used to throw.
            document.getElementById('editortopbar-warning-button')?.click();
          }}
        />
      </Section>
    </VStack>
  );
}
