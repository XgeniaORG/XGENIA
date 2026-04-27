import { StoryFn, Meta } from '@storybook/react';
import React from 'react';

import { InputNotificationDisplayMode } from '@xgenia-types/globalInputTypes';
import { FeedbackType } from '@xgenia-constants/FeedbackType';

import { TextArea } from './TextArea';

export default {
  title: 'Inputs/Text Area',
  component: TextArea,
  argTypes: {}
} as Meta<typeof TextArea>;

const Template: StoryFn<typeof TextArea> = (args) => (
  <div style={{ width: 280 }}>
    <TextArea {...args} />
  </div>
);

export const Common = Template.bind({});
Common.args = {};

export const ErrorMessage = Template.bind({});
ErrorMessage.args = {
  value: 'I got the error',
  notification: {
    type: FeedbackType.Danger,
    message: 'I am error!',
    displayMode: InputNotificationDisplayMode.Stay
  }
};

export const BigMessage = Template.bind({});
BigMessage.args = {
  value: 'Hello\nHello\nHello\nHello\n',
  isResizeDisabled: true
};
