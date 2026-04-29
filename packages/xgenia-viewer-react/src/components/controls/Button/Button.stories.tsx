import { StoryFn, Meta } from '@storybook/react';
import React from 'react';

import { Button } from './Button';

export default {
  title: 'CATEGORY_HERE/Button',
  component: Button,
  argTypes: {}
} asMeta<typeof Button>;

const Template: ComponentStory<typeof Button> = (args) => <Button {...args} />;

export const Common = Template.bind({});
Common.args = {};
