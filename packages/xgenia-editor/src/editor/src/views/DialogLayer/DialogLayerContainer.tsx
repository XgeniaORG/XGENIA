import { useModernModel } from '@xgenia-hooks/useModel';
import React, { ReactElement } from 'react';

import { DialogLayerModel } from '@xgenia-models/DialogLayerModel';

import css from './DialogLayerContainer.module.scss';

export function DialogLayerContainer() {
  const { dialogs } = useModernModel(DialogLayerModel.instance);

  return (
    <div className={css['Root']} style={{ pointerEvents: dialogs.length ? 'auto' : 'none' }}>
      {dialogs.map(({ id, slot }) => {
        const element = slot() as ReactElement;
        return <React.Fragment key={id}>{element}</React.Fragment>;
      })}
    </div>
  );
}

/*
<ConfirmDialog
  title="Your Free Trial  Expries in 7 Days"
  text="Thank you for trying our platform! Your 30-day free trial will expire in 7 days. After that you won't have access to paid features. Please consider upgrading to a paid plan."
  confirmText="Manage plan"
/>
*/
