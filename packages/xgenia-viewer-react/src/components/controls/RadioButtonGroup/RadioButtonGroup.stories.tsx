import { StoryFn, Meta } from '@storybook/react';
import React from 'react';

import { RadioButtonGroup } from './RadioButtonGroup';

export default {
  title: 'Controls/RadioButtonGroup',
  component: RadioButtonGroup,
  argTypes: {}
} asMeta<typeof RadioButtonGroup>;

const Template: ComponentStory<typeof RadioButtonGroup> = (args) => <RadioButtonGroup {...args} />;

export const Common = Template.bind({});
Common.args = {};
