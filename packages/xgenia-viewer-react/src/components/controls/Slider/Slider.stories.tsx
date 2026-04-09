import { StoryFn, Meta } from '@storybook/react';
import React from 'react';

import { Slider } from './Slider';

export default {
  title: 'Controls/Slider',
  component: Slider,
  argTypes: {}
} asMeta<typeof Slider>;

const Template: ComponentStory<typeof Slider> = (args) => <Slider {...args} />;

export const Common = Template.bind({});
Common.args = {};
