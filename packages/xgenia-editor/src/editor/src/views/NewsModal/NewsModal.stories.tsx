import React from 'react';
import { StoryFn, Meta } from '@storybook/react';

import { NewsModal } from './NewsModal';

export default {
  title: 'CATEGORY_HERE/NewsModal',
  component: NewsModal,
  argTypes: {},
} asMeta<typeof NewsModal>;

const Template: ComponentStory<typeof NewsModal> = (args) => <NewsModal {...args} />;

export const Common = Template.bind({});
Common.args = {};
