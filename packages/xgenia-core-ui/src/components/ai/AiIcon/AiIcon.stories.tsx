import { StoryFn, Meta } from '@storybook/react';
import React from 'react';

import { AiIcon } from './AiIcon';

export default {
  title: 'Ai/Ai Icon',
  component: AiIcon,
  argTypes: {}
} as Meta<typeof AiIcon>;

const Template: StoryFn<typeof AiIcon> = (args) => <AiIcon {...args} />;

export const Common = Template.bind({});
Common.args = {};
