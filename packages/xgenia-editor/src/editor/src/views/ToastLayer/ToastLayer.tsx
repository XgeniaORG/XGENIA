import React from 'react';
import toast from 'react-hot-toast';

import { EventDispatcher } from '../../../../shared/utils/EventDispatcher';
import { ToastCard, ToastType } from './components/ToastCard';

export const ToastLayer = {
  showInteraction(message: string) {
    toast.success(<ToastCard type={ToastType.Neutral} message={message} />);
  },

  showActivity(message: string, toastId = 'no-id') {
    // The deploy pipeline already narrates every step through this toast, so mirroring
    // it onto the event bus gives the publish store its step labels without a second
    // source of truth for the wording. Listeners filter by toastId.
    EventDispatcher.instance.emit('toast-activity', { message, toastId });
    toast.promise(
      new Promise(() => {
        // noop
      }),
      {
        loading: <ToastCard type={ToastType.Pending} message={message} hasActivity />,
        success: '',
        error: ''
      },
      { id: toastId, duration: 1000000 }
    );
  },

  hideActivity(toastId = 'no-id') {
    EventDispatcher.instance.emit('toast-activity', { message: null, toastId });
    toast.dismiss(toastId);
  },

  hideAll() {
    toast.dismiss();
  },

  showSuccess(message: string) {
    toast.success(<ToastCard type={ToastType.Success} message={message} />);
  },

  showError(message: string, duration = 1000000) {
    toast.error((t) => <ToastCard type={ToastType.Danger} message={message} onClose={() => toast.dismiss(t.id)} />, {
      duration
    });
  },

  showProgress(message: string, progress: number, toastId: string) {
    if (progress) {
      toast.loading(<ToastCard type={ToastType.Pending} message={message} progress={progress} hasActivity />, {
        id: toastId
      });
    }
  },

  hideProgress(toastId: string) {
    toast.dismiss(toastId);
  }
};
