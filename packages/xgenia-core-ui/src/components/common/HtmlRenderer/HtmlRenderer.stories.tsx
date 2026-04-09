import React from 'react';
import { StoryFn, Meta } from '@storybook/react';

import { HtmlRenderer } from './HtmlRenderer';
import { Text } from '@xgenia-core-ui/components/typography/Text';

export default {
  title: 'Common/HtmlRenderer',
  component: HtmlRenderer,
  argTypes: {}
} as Meta<typeof HtmlRenderer>;

const Template: StoryFn<typeof HtmlRenderer> = (args) => (
  <>
    <Text>Pass an HTML string to the html-prop</Text>
    <HtmlRenderer {...args} />;
  </>
);

export const Common = Template.bind({});
Common.args = {};
