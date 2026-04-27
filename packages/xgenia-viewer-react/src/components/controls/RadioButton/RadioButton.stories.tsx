import { StoryFn, Meta } from '@storybook/react';
import React from 'react';

import { RadioButton } from './RadioButton';

export default {
  title: 'Controls/Radio Button',
  component: RadioButton,
  argTypes: {}
} asMeta<typeof RadioButton>;

const Template: ComponentStory<typeof RadioButton> = (args) => <RadioButton {...args} />;

export const Common = Template.bind({});
Common.args = {};
