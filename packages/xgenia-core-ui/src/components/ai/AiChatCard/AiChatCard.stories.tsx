import { StoryFn, Meta } from '@storybook/react';
import React from 'react';

import { AiChatCard } from './AiChatCard';

export default {
  title: 'Ai/Ai Chat Card',
  component: AiChatCard,
  argTypes: {}
} as Meta<typeof AiChatCard>;

const Template: StoryFn<typeof AiChatCard> = (args) => <AiChatCard {...args} />;

export const Common = Template.bind({});
Common.args = {
  title: 'Home page',
  subtitle: 'Landing page for the app'
};
