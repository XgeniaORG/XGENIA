import React from 'react';
import { StoryFn, Meta } from '@storybook/react';

import { TestView } from './TestView';

export default {
  title: 'Layout/TestView',
  component: TestView,
  argTypes: {}
} as Meta<typeof TestView>;

const Template: StoryFn<typeof TestView> = (args) => <TestView {...args} />

export const Common = Template.bind({});
Common.args = {};
