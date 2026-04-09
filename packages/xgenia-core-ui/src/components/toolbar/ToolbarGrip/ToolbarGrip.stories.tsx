import { StoryFn, Meta } from '@storybook/react';
import React from 'react';

import { ToolbarGrip } from './ToolbarGrip';

export default {
  title: 'Toolbar/Toolbar Grip',
  component: ToolbarGrip,
  argTypes: {}
} as Meta<typeof ToolbarGrip>;

const Template: StoryFn<typeof ToolbarGrip> = (args) => <ToolbarGrip {...args} />;

export const Common = Template.bind({});
Common.args = {};
