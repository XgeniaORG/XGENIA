import React from 'react';
import { StoryFn, Meta } from '@storybook/react';

import { ToggleSwitch } from './ToggleSwitch';

export default {
  title: 'Inputs/Toggle Switch',
  component: ToggleSwitch,
  argTypes: {}
} as Meta<typeof ToggleSwitch>;

const Template: StoryFn<typeof ToggleSwitch> = (args) => <ToggleSwitch {...args} />;

export const Common = Template.bind({});
Common.args = {};
