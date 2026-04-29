import { StoryFn, Meta } from '@storybook/react';
import React from 'react';

import { Group } from './Group';

export default {
  title: 'Preview/Property Panel/[WIP] Group',
  component: Group,
  argTypes: {}
} as Meta<typeof Group>;

const Template: StoryFn<typeof Group> = (args) => <Group></Group>;

export const Primary = Template.bind({});
Primary.args = {};
