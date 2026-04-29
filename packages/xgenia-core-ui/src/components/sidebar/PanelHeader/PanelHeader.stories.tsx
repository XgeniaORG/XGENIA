import React from 'react';
import { StoryFn, Meta } from '@storybook/react';

import { PanelHeader } from './PanelHeader';

export default {
  title: 'Sidebar/Panel Header',
  component: PanelHeader,
  argTypes: {}
} as Meta<typeof PanelHeader>;

const Template: StoryFn<typeof PanelHeader> = (args) => (
  <div style={{ width: 280 }}>
    <PanelHeader {...args} />
  </div>
);

export const Common = Template.bind({});
Common.args = {};

export const Example = Template.bind({});
Example.args = {
  title: 'Hello World'
};
