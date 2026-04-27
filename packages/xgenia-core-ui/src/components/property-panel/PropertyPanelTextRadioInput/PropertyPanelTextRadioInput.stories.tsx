import { StoryFn, Meta } from '@storybook/react';
import React from 'react';

import { PropertyPanelTextRadioInput } from './PropertyPanelTextRadioInput';

export default {
  title: 'Property Panel/Radio',
  component: PropertyPanelTextRadioInput,
  argTypes: {}
} as Meta<typeof PropertyPanelTextRadioInput>;

const Template: StoryFn<typeof PropertyPanelTextRadioInput> = (args) => (
  <div style={{ width: 280 }}>
    <PropertyPanelTextRadioInput {...args} />
  </div>
);

export const Common = Template.bind({});
Common.args = {
  value: 'one',
  properties: {
    options: [
      {
        label: 'One',
        value: 'one'
      },
      {
        label: 'Two',
        value: 'two'
      },
      {
        label: 'Disabled',
        value: 'three',
        isDisabled: true
      }
    ]
  }
};
