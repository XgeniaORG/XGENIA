import { StoryFn, Meta } from '@storybook/react';
import React from 'react';

import { Portal } from './Portal';

export default {
  title: 'Layout/Portal',
  component: Portal,
  argTypes: {}
} as Meta<typeof Portal>;

const Template: StoryFn<typeof Portal> = (args) => <Portal {...args} />;

export const Common = Template.bind({});
Common.args = {
  portalRoot: document.querySelector('.dialog-layer-portal-target')
};
