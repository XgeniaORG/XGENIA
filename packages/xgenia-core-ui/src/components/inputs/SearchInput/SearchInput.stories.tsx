import React from 'react';
import { StoryFn, Meta } from '@storybook/react';

import { SearchInput } from './SearchInput';

export default {
  title: 'Inputs/Search Input',
  component: SearchInput,
  argTypes: {},
} as Meta<typeof SearchInput>;

const Template: StoryFn<typeof SearchInput> = (args) => <SearchInput {...args} />;

export const Common = Template.bind({});
Common.args = {};
