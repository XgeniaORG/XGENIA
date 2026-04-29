import React from 'react';
import { StoryFn, Meta } from '@storybook/react';

import { Text } from './Text';

export default {
  title: 'Typography/Text',
  component: Text,
  argTypes: {
    children: { control: 'text' },
    textType: {
      control: {
        type: 'select',
        options: [
          // TextType
          'default',
          'disabled',
          'shy',
          'proud',

          // FeedbackType
          'success',
          'notice',
          'danger'
        ],
      },
    },
    className: { control: 'text' },
    size: {
      control: {
        type: 'select',
        options: [
          'default',
          'small',
        ],
      },
    },
    style: { control: 'object' },

    hasBottomSpacing: { control: 'boolean' },
    isSpan: { control: 'boolean' },
    isCentered: { control: 'boolean' },
  },
} as Meta<typeof Text>;

const Template: StoryFn<typeof Text> = (args) => <Text {...args}>{args.children}</Text>;

export const Common = Template.bind({});
Common.args = {
  children: "Typography",
};
