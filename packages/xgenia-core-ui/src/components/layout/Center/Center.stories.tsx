import { StoryFn, Meta } from '@storybook/react';
import React from 'react';

import { Center } from './Center';

export default {
  title: 'Layout/Center',
  component: Center,
  argTypes: {}
} as Meta<typeof Center>;

const Template: StoryFn<typeof Center> = (args) => <Center {...args} />;

export const Common = Template.bind({});
Common.args = {};
