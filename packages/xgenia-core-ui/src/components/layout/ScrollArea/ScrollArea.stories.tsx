import { StoryFn, Meta } from '@storybook/react';
import React from 'react';

import { ScrollArea } from './ScrollArea';

export default {
  title: 'Layout/ScrollArea',
  component: ScrollArea,
  argTypes: {}
} as Meta<typeof ScrollArea>;

const Template: StoryFn<typeof ScrollArea> = (args) => <ScrollArea {...args} />;

export const Common = Template.bind({});
Common.args = {};
