import React from 'react';
import { StoryFn, Meta } from '@storybook/react';

import { ExternalLink } from './ExternalLink';

export default {
  title: 'Inputs/External Link',
  component: ExternalLink,
  argTypes: {}
} as Meta<typeof ExternalLink>;

const Template: StoryFn<typeof ExternalLink> = (args) => <ExternalLink {...args} />;

export const Common = Template.bind({});
Common.args = { children: 'I am a link' };
