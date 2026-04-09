import { StoryFn, Meta } from '@storybook/react';
import React from 'react';

import { Card } from './Card';

export default {
  title: 'Common/Card',
  component: Card,
  argTypes: {}
} as Meta<typeof Card>;

const Template: StoryFn<typeof Card> = (args) => <Card {...args} />;

export const Common = Template.bind({});
Common.args = {};
