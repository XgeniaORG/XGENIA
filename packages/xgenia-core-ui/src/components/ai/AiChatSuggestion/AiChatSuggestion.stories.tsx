import { StoryFn, Meta } from '@storybook/react';
import React, { useState } from 'react';

import { PrimaryButton, PrimaryButtonVariant } from '@xgenia-core-ui/components/inputs/PrimaryButton';
import { Box } from '@xgenia-core-ui/components/layout/Box';

import { AiChatSuggestion } from './AiChatSuggestion';

export default {
  title: 'Ai/Ai Chat Suggestion',
  component: AiChatSuggestion,
  argTypes: {}
} as Meta<typeof AiChatSuggestion>;

const Template: StoryFn<typeof AiChatSuggestion> = (args) => (
  <div style={{ maxWidth: '280px' }}>
    <AiChatSuggestion {...args} />
  </div>
);

export const Common = Template.bind({});
Common.args = {
  text: 'What are the required inputs for this node to work correctly?'
};

export const IsLoading = Template.bind({});
IsLoading.args = {
  isLoading: true
};

export const OnUpdate = () => {
  const [count, setCount] = useState(1);
  return (
    <div style={{ maxWidth: '280px' }}>
      <AiChatSuggestion text={`Count: ${count}`} />
      <Box hasTopSpacing>
        <PrimaryButton
          label="Increment"
          variant={PrimaryButtonVariant.Muted}
          isGrowing
          onClick={() => setCount((prev) => prev + 1)}
        />
      </Box>
    </div>
  );
};
