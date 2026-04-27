import { StoryFn, Meta } from '@storybook/react';
import React from 'react';

import { PropertyPanelNumberInput } from './PropertyPanelNumberInput';

export default {
  title: 'Property Panel/Number',
  component: PropertyPanelNumberInput,
  argTypes: {}
} as Meta<typeof PropertyPanelNumberInput>;

const Template: StoryFn<typeof PropertyPanelNumberInput> = (args) => (
  <div style={{ width: 280 }}>
    <PropertyPanelNumberInput {...args} />
  </div>
);

export const Common = Template.bind({});
Common.args = {};
