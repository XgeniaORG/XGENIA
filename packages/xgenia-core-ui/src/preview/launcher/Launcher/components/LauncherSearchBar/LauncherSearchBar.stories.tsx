import React from 'react';
import { StoryFn, Meta } from '@storybook/react';

import { LauncherSearchBar } from './LauncherSearchBar';

export default {
  title: 'CATEGORY_HERE/LauncherSearchBar',
  component: LauncherSearchBar,
  argTypes: {},
} as Meta<typeof LauncherSearchBar>;

const Template: StoryFn<typeof LauncherSearchBar> = (args) => <LauncherSearchBar {...args} />;

export const Common = Template.bind({});
Common.args = {};
