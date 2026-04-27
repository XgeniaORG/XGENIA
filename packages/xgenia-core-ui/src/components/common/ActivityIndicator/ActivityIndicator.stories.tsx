import React from 'react';
import { StoryFn, Meta } from '@storybook/react';

import { ActivityIndicator } from './ActivityIndicator';

export default {
  title: 'Common/Activity Indicator',
  component: ActivityIndicator,
  argTypes: {},
} as Meta<typeof ActivityIndicator>;

const Template: StoryFn<typeof ActivityIndicator> = (args) => (
  <ActivityIndicator {...args} />
);

export const Common = Template.bind({});
Common.args = {};
