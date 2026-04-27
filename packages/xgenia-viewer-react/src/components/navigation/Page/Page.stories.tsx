import React from 'react';
import { StoryFn, Meta } from '@storybook/react';

import { Page } from './Page';

export default {
  title: 'Navigation/Page',
  component: Page,
  argTypes: {},
} asMeta<typeof Page>;

const Template: ComponentStory<typeof Page> = (args) => <Page {...args} />;

export const Common = Template.bind({});
Common.args = {};
