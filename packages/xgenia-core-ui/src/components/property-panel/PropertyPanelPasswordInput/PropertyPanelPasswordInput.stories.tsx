import { StoryFn, Meta } from '@storybook/react';
import React from 'react';

import { PropertyPanelPasswordInput } from './PropertyPanelPasswordInput';

export default {
  title: 'Property Panel/Password',
  component: PropertyPanelPasswordInput,
  argTypes: {}
} as Meta<typeof PropertyPanelPasswordInput>;

const Template: StoryFn<typeof PropertyPanelPasswordInput> = (args) => (
  <div style={{ width: 280 }}>
    <PropertyPanelPasswordInput {...args} />
  </div>
);

export const Common = Template.bind({});
Common.args = {
  value: 'Hello World'
};
