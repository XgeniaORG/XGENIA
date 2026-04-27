import React from "react";
import { ComponentStory, ComponentMeta } from "@storybook/react";

import { LauncherApp, LauncherSidebarExample } from "./LauncherApp";

export default {
  title: "Preview/Template/Launcher",
  component: LauncherApp,
  argTypes: {},
} as Meta<typeof LauncherApp>;

const Template: StoryFn<typeof LauncherApp> = (args) => (
  <LauncherApp {...args}></LauncherApp>
);

export const Common = Template.bind({});
Common.args = {};

export const WithSidebar = Template.bind({});
WithSidebar.args = {
  sidePanel: <LauncherSidebarExample />
};
