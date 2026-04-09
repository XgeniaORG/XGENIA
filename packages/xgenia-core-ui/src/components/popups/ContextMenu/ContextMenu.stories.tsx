import React from 'react';
import { StoryFn, Meta } from '@storybook/react';
import {
  ContextMenu,
  ContextMenuProps
} from '@xgenia-core-ui/components/popups/ContextMenu/ContextMenu';
import { IconName } from '@xgenia-core-ui/components/common/Icon';

export default {
  title: 'Popups/Context Menu',
  component: ContextMenu,
  argTypes: {}
} as Meta<typeof ContextMenu>;

const Template: StoryFn<typeof ContextMenu> = (args: ContextMenuProps) => (
  <div style={{ width: '100vw', height: '100vh' }}>
    <ContextMenu {...args} />
  </div>
);

export const Common = Template.bind({});
Common.args = {
  menuItems: [
    {
      label: 'Action',
      icon: IconName.Plus
    },
    {
      label: 'Another Action'
    },
    'divider',
    {
      label: 'Success'
    },
    {
      label: 'Danger',
      isDangerous: true
    },
    {
      label: 'Copy Me',
      icon: IconName.Copy
    },
    {
      label: 'With subtitle',
      endSlot: 'Subtitle goes here'
    }
  ]
};
