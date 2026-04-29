import { StoryFn, Meta } from '@storybook/react';
import React from 'react';

import { Columns } from './Columns';

export default {
  title: 'CATEGORY_HERE/Columns',
  component: Columns,
  argTypes: {}
} asMeta<typeof Columns>;

const Template: ComponentStory<typeof Columns> = (args) => <Columns {...args} />;

export const Common = Template.bind({});
Common.args = {};
