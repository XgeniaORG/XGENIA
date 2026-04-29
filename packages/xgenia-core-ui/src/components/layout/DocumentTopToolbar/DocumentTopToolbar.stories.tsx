import { StoryFn, Meta } from '@storybook/react';
import React from 'react';

import { DocumentTopToolbar } from './DocumentTopToolbar';

export default {
  title: 'Layout/DocumentTopToolbar',
  component: DocumentTopToolbar,
  argTypes: {}
} as Meta<typeof DocumentTopToolbar>;

const Template: StoryFn<typeof DocumentTopToolbar> = (args) => <DocumentTopToolbar {...args} />;

export const Common = Template.bind({});
Common.args = {};
