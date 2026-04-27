import React from 'react';
import { StoryFn, Meta } from '@storybook/react';

import { Drag } from './Drag';

export default {
  title: 'CATEGORY_HERE/Drag',
  component: Drag,
  argTypes: {},
} asMeta<typeof Drag>;

const Template: ComponentStory<typeof Drag> = (args) => <Drag {...args} />;

export const Common = Template.bind({});
Common.args = {};
