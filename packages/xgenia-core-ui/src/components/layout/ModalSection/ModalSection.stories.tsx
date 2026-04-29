import { StoryFn, Meta } from '@storybook/react';
import React from 'react';

import { ModalSection } from './ModalSection';

export default {
  title: 'Layout/Modal Section',
  component: ModalSection,
  argTypes: {}
} as Meta<typeof ModalSection>;

const Template: StoryFn<typeof ModalSection> = (args) => <ModalSection {...args} />;

export const Common = Template.bind({});
Common.args = {};
