import React from 'react';
import { StoryFn, Meta } from '@storybook/react';

import { Box } from './Box';
import { Text } from '@xgenia-core-ui/components/typography/Text';

export default {
  title: 'Layout/Box',
  component: Box,
  argTypes: {}
} as Meta<typeof Box>;

const Template: StoryFn<typeof Box> = (args) => (
  <div style={{ width: 280 }}>
    <Box {...args}>
      <Text>Text</Text>
    </Box>
  </div>
);

export const Common = Template.bind({});
Common.args = {};
