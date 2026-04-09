import React from 'react';
import { BasePanel } from '@xgenia-core-ui/components/sidebar/BasePanel';
import { FeatureBaseWidget } from './FeatureBaseWidget';

export const FeedbackPanel_ID = 'feedback-panel';

export function FeedbackPanel() {
  return (
    <BasePanel title="Feedback & Feature Requests" isFill>
      <FeatureBaseWidget />
    </BasePanel>
  );
} 