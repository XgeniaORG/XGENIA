import React from 'react';
import { StoryFn, Meta } from '@storybook/react';

import { LegacyIconButton } from './LegacyIconButton';

export default {
  title: 'Inputs/Legacy Icon Button',
  component: LegacyIconButton,
  argTypes: {},
} as Meta<typeof LegacyIconButton>;

const Template: StoryFn<typeof LegacyIconButton> = (args) => (
  <>
    DONT USE THIS COMPONENT
    <LegacyIconButton {...args} />
  </>
);

export const Common = Template.bind({});
Common.args = {};
