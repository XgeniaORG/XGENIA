import React from "react";
import { StoryFn, Meta } from "@storybook/react";

import { Logo, LogoVariant } from "./Logo";

export default {
  title: "Common/Logo",
  component: Logo,
  argTypes: {},
} as Meta<typeof Logo>;

const Template: StoryFn<typeof Logo> = (args) => (
  <div style={{ padding: '10px' }}>
    <Logo {...args} />
  </div>
);

export const Common = Template.bind({});
Common.args = {};

export const Inverted = Template.bind({});
Inverted.args = {
  variant: LogoVariant.Inverted
};

export const Grayscale = Template.bind({});
Grayscale.args = {
  variant: LogoVariant.Grayscale
};
