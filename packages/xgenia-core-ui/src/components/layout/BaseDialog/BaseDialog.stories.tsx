import React, { useState } from 'react';
import { StoryFn, Meta } from '@storybook/react';

import { BaseDialog } from './BaseDialog';

export default {
  title: 'Layout/Base Dialog',
  component: BaseDialog,
  argTypes: {}
} as Meta<typeof BaseDialog>;

const Template: StoryFn<typeof BaseDialog> = (args) => {
  const [isDialogVisible, setIsDialogVisible] = useState(false);
  const [reload, setReload] = useState(Date.now());
  return (
    <>
      <BaseDialog {...args} isVisible={isDialogVisible} onClose={() => setIsDialogVisible(false)}>
        I am a dialog
      </BaseDialog>

      <p
        onMouseEnter={() => setIsDialogVisible(true)}
        onMouseLeave={() => setIsDialogVisible(false)}
      >
        Hover to show
      </p>
      <button onClick={() => setIsDialogVisible(true)}>Show dialog</button>
      <br />
      <button onClick={() => setReload(Date.now())}>Trigger reload</button>
    </>
  );
};

export const Common = Template.bind({});
Common.args = {};
