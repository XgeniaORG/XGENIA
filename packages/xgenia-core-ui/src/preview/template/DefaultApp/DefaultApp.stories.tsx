import React from "react";
import { ComponentStory, ComponentMeta } from "@storybook/react";

import { DefaultApp } from "./DefaultApp";

export default {
  title: "Preview/Template/App",
  component: DefaultApp,
  argTypes: {},
} as Meta<typeof DefaultApp>;

const Template: StoryFn<typeof DefaultApp> = (args) => (
  <DefaultApp {...args}></DefaultApp>
);

export const Common = Template.bind({});
Common.args = {};
