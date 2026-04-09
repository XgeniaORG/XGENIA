import { StoryFn, Meta } from '@storybook/react';
import React from 'react';

import { TextInput } from './TextInput';

export default {
  title: 'CATEGORY_HERE/TextInput',
  component: TextInput,
  argTypes: {}
} asMeta<typeof TextInput>;

const Template: ComponentStory<typeof TextInput> = (args) => <TextInput {...args} />;

export const Common = Template.bind({});
Common.args = {};
