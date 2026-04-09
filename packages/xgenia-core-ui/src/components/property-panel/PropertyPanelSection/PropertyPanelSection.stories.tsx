import { StoryFn, Meta } from '@storybook/react';
import React from 'react';

import { PropertyPanelSection } from './PropertyPanelSection';

export default {
  title: 'Property Panel/Property Panel Section',
  component: PropertyPanelSection,
  argTypes: {}
} as Meta<typeof PropertyPanelSection>;

const Template: StoryFn<typeof PropertyPanelSection> = (args) => <PropertyPanelSection {...args} />;

export const Common = Template.bind({});
Common.args = { title: 'Section title' };
