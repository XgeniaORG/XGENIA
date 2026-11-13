import React from 'react';
import { Toaster as HotToaster, ToasterProps } from 'react-hot-toast';

import css from './ToastLayerContainer.module.scss';

// react-hot-toast is typed against the root @types/react, the editor against its own pinned
// copy; TypeScript 5.1+ checks JSX element types strictly enough to tell the two apart.
const Toaster = HotToaster as unknown as React.FC<ToasterProps>;

export function ToastLayerContainer() {
  return (
    <div className={css['Root']}>
      <Toaster
        position="bottom-right"
        containerClassName={css['ToastContainer']}
        toastOptions={{
          icon: null,
          style: {
            border: 'none',
            padding: '0',
            backgroundColor: 'transparent',
            margin: 0
          },
          duration: 6000
        }}
      />

      {/* <div className={css['Debugger']}>
        <button onClick={() => ToastLayer.showSuccess('Successfully pressed the button')}>Show success</button>
        <button onClick={() => ToastLayer.showError('Failed to not press the button')}>Show error</button>
        <button onClick={() => ToastLayer.showInteraction('Interacted')}>Show interaction</button>
        <button onClick={() => ToastLayer.showActivity('Successfully pressed the button', 'my-id')}>
          Show activity
        </button>
        <button onClick={() => ToastLayer.hideActivity('my-id')}>Hide activity</button>
        <button onClick={() => ToastLayer.hideAll()}>Hide all</button>
      </div> */}
    </div>
  );
}
