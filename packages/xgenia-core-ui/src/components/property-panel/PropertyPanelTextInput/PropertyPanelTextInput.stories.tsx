import { StoryFn, Meta } from '@storybook/react';
import React from 'react';

import { PropertyPanelTextInput } from './PropertyPanelTextInput';

export default {
  title: 'Property Panel/Text',
  component: PropertyPanelTextInput,
  argTypes: {}
} as Meta<typeof PropertyPanelTextInput>;

const Template: StoryFn<typeof PropertyPanelTextInput> = (args) => (
  <div style={{ width: 280 }}>
    <PropertyPanelTextInput {...args} />
  </div>
);

export const Common = Template.bind({});
Common.args = {
  value: 'Hello World'
};
