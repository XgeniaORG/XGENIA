import React from 'react';
import { StoryFn, Meta } from '@storybook/react';

import { BasePanel } from './BasePanel';

export default {
  title: 'Sidebar/Base Panel',
  component: BasePanel,
  argTypes: {}
} as Meta<typeof BasePanel>;

const Template: StoryFn<typeof BasePanel> = (args) => (
  <div style={{ width: 280 }}>
    <BasePanel {...args} />
  </div>
);

export const Common = Template.bind({});
Common.args = {
  title: 'Common'
};

export const WithFooter = Template.bind({});
WithFooter.args = {
  title: 'Common',
  children: 'Children',
  footerSlot: 'Footer'
};
