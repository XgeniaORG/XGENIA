import React from 'react';

import { Title } from '@xgenia-core-ui/components/typography/Title';
import { LauncherPage } from '@xgenia-core-ui/preview/launcher/Launcher/components/LauncherPage';

export interface LearningCenterViewProps {}

export function LearningCenter({}: LearningCenterViewProps) {
  return <LauncherPage title="Learning Center"></LauncherPage>;
}
