import { StoryFn, Meta } from '@storybook/react';
import React from 'react';

import { PropertyPanelCheckbox } from '@xgenia-core-ui/components/property-panel/PropertyPanelCheckbox';

export default {
  title: 'Property Panel/Checkbox',
  component: PropertyPanelCheckbox,
  argTypes: {}
} as Meta<typeof PropertyPanelCheckbox>;

const Template: StoryFn<typeof PropertyPanelCheckbox> = (args) => (
  <div style={{ width: 280 }}>
    <PropertyPanelCheckbox {...args} />
  </div>
);

export const Common = Template.bind({});
Common.args = {};
