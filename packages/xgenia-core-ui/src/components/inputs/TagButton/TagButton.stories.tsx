import React from 'react';
import { StoryFn, Meta } from '@storybook/react';

import { TagButton } from './TagButton';

export default {
  title: 'Inputs/Tag Button',
  component: TagButton,
  argTypes: {},
} as Meta<typeof TagButton>;

const Template: StoryFn<typeof TagButton> = (args) => <TagButton {...args} />;

export const Common = Template.bind({});
Common.args = {
  label: 'Hello World',
};
