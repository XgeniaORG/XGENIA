import React from 'react';
import { StoryFn, Meta } from '@storybook/react';

import { NotificationFeedbackDisplay } from './NotificationFeedbackDisplay';

export default {
  title: 'Inputs/Notification Feedback Display',
  component: NotificationFeedbackDisplay,
  argTypes: {},
} as Meta<typeof NotificationFeedbackDisplay>;

const Template: StoryFn<typeof NotificationFeedbackDisplay> = (args) => <NotificationFeedbackDisplay {...args} />;

export const Common = Template.bind({});
Common.args = {};
