// .storybook/manager.ts
//import React, { Fragment, useEffect, useMemo, useState } from 'react';
// import { addons } from '@storybook/preview-api';
// import {create} from '@storybook/theming';
// import { useStorybookApi } from '@storybook/manager-api';
// import type { Preview } from '@storybook/react'
// import { themes } from '@storybook/theming';
import { addons } from '@storybook/addons';
import { create } from '@storybook/theming/create'


addons.setConfig({
    theme: create({
        base: 'dark', // or 'light'
        // ... other theme options ...
    }),
});
