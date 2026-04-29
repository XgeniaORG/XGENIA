import React from 'react';
import { GitProvider } from '@xgenia/git';

import { FeedbackType } from '@xgenia-constants/FeedbackType';

import { Icon, IconName, IconSize } from '@xgenia-core-ui/components/common/Icon';
import { TextInput, TextInputVariant } from '@xgenia-core-ui/components/inputs/TextInput';
import { Container } from '@xgenia-core-ui/components/layout/Container';
import { Section, SectionVariant } from '@xgenia-core-ui/components/sidebar/Section';
import { Text } from '@xgenia-core-ui/components/typography/Text';

type OriginSectionProps = {
  provider: GitProvider;
  origin: string;
  onOriginChanged: (origin: string) => void;
};

export function OriginSection({ provider, origin, onOriginChanged }: OriginSectionProps) {
  return (
    <Section title="Git Origin" variant={SectionVariant.InModal} hasGutter>
      <TextInput
        hasBottomSpacing
        label="Git Origin"
        value={origin}
        variant={TextInputVariant.InModal}
        onChange={(ev) => onOriginChanged(ev.target.value)}
      />
      {provider === 'xgenia' && (
        <Container hasBottomSpacing UNSAFE_style={{ alignItems: 'center', gap: '8px' }}>
          <Icon
            icon={IconName.WarningTriangle}
            size={IconSize.Default}
            variant={FeedbackType.Danger}
            UNSAFE_style={{ flexShrink: 0 }}
          />
          <Text>
            This project has a git origin set to a deprecated XGENIA git hosting service. Please update to a different
            origin, such as GitHub.
          </Text>
        </Container>
      )}
    </Section>
  );
}
