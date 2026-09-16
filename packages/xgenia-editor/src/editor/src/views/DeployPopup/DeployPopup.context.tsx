import { ActivityQueue, useActivityQueue } from '@xgenia-hooks/useActivityQueue';
import React, { createContext, useContext } from 'react';

export type DeployUpdateQueueItem = {
  frontendId: string;
  environmentId: string;
};

// Based on:
// https://github.com/xgeniaapp/xgenia/tree/ac0c3fc39ff11282fd91fb90a58423c4d02bdc3a/packages/xgenia-editor/src/editor/src/contexts/HostingContext
interface IDeployContext {
  updateQueue: DeployUpdateQueueItem[];

  hasActivity: ActivityQueue['hasActivity'];
  runActivity: ActivityQueue['runActivity'];

  /**
   * Close the Publish popup. For actions that leave it for the editor's main
   * area — Compliance on a deployed domain opens a document there, and a popup
   * left open over it would hide what was just opened.
   */
  closePopup: () => void;
}

const DeployContext = createContext<IDeployContext>({
  updateQueue: null,
  hasActivity: null,
  runActivity: null,
  closePopup: null
});

export function DeployContextProvider({ children, onClose }: { children: React.ReactNode; onClose?: () => void }) {
  const { hasActivity, runActivity } = useActivityQueue({});

  return (
    <DeployContext.Provider
      value={{
        updateQueue: null,
        hasActivity,
        runActivity,
        closePopup: () => onClose?.()
      }}
    >
      {children}
    </DeployContext.Provider>
  );
}

export function useDeployContext() {
  const context = useContext(DeployContext);

  if (context === undefined) {
    throw new Error('useDeployContext must be a child of DeployContextProvider');
  }

  return context;
}
