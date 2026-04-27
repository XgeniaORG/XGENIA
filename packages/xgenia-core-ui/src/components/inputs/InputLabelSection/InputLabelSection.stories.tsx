import React from 'react';
import { StoryFn, Meta } from '@storybook/react';

import { InputLabelSection } from './InputLabelSection';

export default {
  title: 'Inputs/Input Label Section',
  component: InputLabelSection,
  argTypes: {},
} as Meta<typeof InputLabelSection>;

const Template: StoryFn<typeof InputLabelSection> = (args) => <InputLabelSection {...args} />;

export const Common = Template.bind({});
Common.args = {
  label: 'Hello World',
};
