import { StoryFn, Meta } from '@storybook/react';
import React from 'react';

import { Text } from '@xgenia-core-ui/components/typography/Text';

import { HStack } from './Stack';

export default {
  title: 'Layout/HStack',
  component: HStack,
  argTypes: {}
} as Meta<typeof HStack>;

const Template: StoryFn<typeof HStack> = (args) => (
  <div style={{ width: 280 }}>
    <HStack {...args}></HStack>
  </div>
);

export const Common = Template.bind({});
Common.args = {};

const ListTemplate: StoryFn<typeof HStack> = (args) => (
  /* Showcase how it is when the size is set on the parent */
  <div style={{ width: 500, height: 500 }}>
    <HStack {...args}>
      {[...Array(10)].map((_, i) => (
        <Text>Item {i}</Text>
      ))}
    </HStack>
  </div>
);

export const List = ListTemplate.bind({});

export const ListSpacing = ListTemplate.bind({});
ListSpacing.args = {
  hasSpacing: true
};
