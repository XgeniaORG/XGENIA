import { StoryFn, Meta } from '@storybook/react';
import React from 'react';

import { CarouselIndicatorDot } from './CarouselIndicatorDot';

export default {
  title: 'Layout/Carousel Indicator Dot',
  component: CarouselIndicatorDot,
  argTypes: {}
} as Meta<typeof CarouselIndicatorDot>;

const Template: StoryFn<typeof CarouselIndicatorDot> = (args) => <CarouselIndicatorDot {...args} />;

export const Common = Template.bind({});
Common.args = {};
