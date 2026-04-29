import { StoryFn, Meta } from '@storybook/react';
import React from 'react';

import { Launcher } from './Launcher';

export default {
  title: 'Preview/Launcher/[WIP] Launcher',
  component: Launcher,
  argTypes: {}
} as Meta<typeof Launcher>;

const Template: StoryFn<typeof Launcher> = (args) => <Launcher {...args}></Launcher>;

export const Primary = Template.bind({});
Primary.args = {};
