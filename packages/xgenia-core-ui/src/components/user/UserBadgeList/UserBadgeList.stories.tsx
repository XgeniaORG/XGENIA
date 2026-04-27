import { StoryFn, Meta } from '@storybook/react';
import React from 'react';

import { UserBadgeList } from './UserBadgeList';

export default {
  title: 'User/UserBadgeList',
  component: UserBadgeList,
  argTypes: {}
} as Meta<typeof UserBadgeList>;

const Template: StoryFn<typeof UserBadgeList> = (args) => <UserBadgeList {...args} />;

export const Common = Template.bind({});
Common.args = {
  badges: [
    {
      email: 'kotte@xgenia.net',
      id: 'kotte',
      name: 'Kotte Aistre'
    },
    {
      email: 'eric@xgenia.net',
      id: 'eric',
      name: 'Eric Tuvesson'
    },
    {
      email: 'michael@xgenia.net',
      id: 'michael',
      name: 'Michael Cartner'
    }
  ]
};
