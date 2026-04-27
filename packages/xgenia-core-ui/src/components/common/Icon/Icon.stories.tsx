import React from 'react';
import { StoryFn, Meta } from '@storybook/react';

import { Icon, IconName } from './Icon';

export default {
  title: 'Common/Icon',
  component: Icon,
  argTypes: {
    icon: { control: 'select', options: IconName }
  }
} as Meta<typeof Icon>;

const Template: StoryFn<typeof Icon> = (args) => <Icon {...args} />;

export const Common = Template.bind({});
Common.args = {};
