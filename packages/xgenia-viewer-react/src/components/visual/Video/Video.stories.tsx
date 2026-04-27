import { StoryFn, Meta } from '@storybook/react';
import React from 'react';

import { Video } from './Video';

export default {
  title: 'CATEGORY_HERE/Video',
  component: Video,
  argTypes: {}
} asMeta<typeof Video>;

const Template: ComponentStory<typeof Video> = (args) => <Video {...args} />;

export const Common = Template.bind({});
Common.args = {};
