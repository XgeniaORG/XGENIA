import React from 'react';
import { StoryFn, Meta } from '@storybook/react';

import { Icon } from './Icon';

export default {
  title: 'CATEGORY_HERE/Icon',
  component: Icon,
  argTypes: {},
} asMeta<typeof Icon>;

const Template: ComponentStory<typeof Icon> = (args) => <Icon {...args} />;

export const Common = Template.bind({});
Common.args = {};
