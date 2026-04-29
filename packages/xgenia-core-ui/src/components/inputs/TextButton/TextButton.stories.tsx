import React from 'react';
import { StoryFn, Meta } from '@storybook/react';

import { TextButton } from './TextButton';
import { FeedbackType } from '@xgenia-constants/FeedbackType';
import { TextType } from '@xgenia-core-ui/components/typography/Text';

export default {
  title: 'Inputs/Text Button',
  component: TextButton,
  argTypes: {},
} as Meta<typeof TextButton>;

const Template: StoryFn<typeof TextButton> = (args) => (
  <TextButton {...args} />
);

export const Common = Template.bind({});
Common.args = {};

export const Submit = Template.bind({});
Submit.args = {
  label: 'Submit',
};

//
// variant: FeedbackType
//

export const Danger = Template.bind({});
Danger.args = {
  label: 'Submit',
  variant: FeedbackType.Danger,
};

export const Notice = Template.bind({});
Notice.args = {
  label: 'Submit',
  variant: FeedbackType.Notice,
};

export const Success = Template.bind({});
Success.args = {
  label: 'Submit',
  variant: FeedbackType.Success,
};

//
// variant: TextType
//

export const DefaultContrast = Template.bind({});
DefaultContrast.args = {
  label: 'Submit',
  variant: TextType.DefaultContrast,
};

export const Disabled = Template.bind({});
Disabled.args = {
  label: 'Submit',
  variant: TextType.Disabled,
};

export const Proud = Template.bind({});
Disabled.args = {
  label: 'Submit',
  variant: TextType.Proud,
};

export const Shy = Template.bind({});
Disabled.args = {
  label: 'Submit',
  variant: TextType.Shy,
};
