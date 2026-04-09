import React, { useState } from 'react';
import { StoryFn, Meta } from '@storybook/react';

import { TextInput } from '@xgenia-core-ui/components/inputs/TextInput';
import { useAutofocusInput } from '@xgenia-core-ui/hooks/useAutofocusInput';

export default {
  title: 'Hooks/useAutofocusInput',
  component: TextInput,
  argTypes: {}
} as Meta<typeof TextInput>;

const Template: StoryFn<typeof TextInput> = () => {
  const setRef = useAutofocusInput();
  const [secondInputState, setSecondInputState] = useState('Focus me manually');

  return (
    <>
      <TextInput onRefChange={setRef} value="Unmutable value makes this story cleaner" />
      <TextInput value={secondInputState} onChange={(e) => setSecondInputState(e.target.value)} />
    </>
  );
};

export const Common = Template.bind({});
Common.args = {};
