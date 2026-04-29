import { StoryFn, Meta } from '@storybook/react';
import React from 'react';

import { Group } from './Group';

export default {
  title: 'CATEGORY_HERE/Group',
  component: Group,
  argTypes: {}
} asMeta<typeof Group>;

const Template: ComponentStory<typeof Group> = (args) => <Group {...args} />;

export const Common = Template.bind({});
Common.args = {};
