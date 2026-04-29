import React from 'react';
import { StoryFn, Meta } from '@storybook/react';

import { IconButton } from './IconButton';

export default {
  title: 'Inputs/Icon Button',
  component: IconButton,
  argTypes: {}
} as Meta<typeof IconButton>;

const Template: StoryFn<typeof IconButton> = (args) => (
  <>
    <IconButton {...args} />
  </>
);

export const Common = Template.bind({});
Common.args = {};
