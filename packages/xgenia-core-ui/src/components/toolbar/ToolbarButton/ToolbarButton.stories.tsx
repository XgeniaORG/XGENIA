import React from 'react';
import { StoryFn, Meta } from '@storybook/react';

import { ToolbarButton } from './ToolbarButton';

export default {
  title: 'Toolbar/Toolbar Button',
  component: ToolbarButton,
  argTypes: {
    label: { control: 'text' },
    prefix: { control: 'slot' }
  }
} as Meta<typeof ToolbarButton>;

const Template: StoryFn<typeof ToolbarButton> = (args) => <ToolbarButton {...args} />;

export const Common = Template.bind({});
Common.args = {
  label: 'PRESS ME',
};
