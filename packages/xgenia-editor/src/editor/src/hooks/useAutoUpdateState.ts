import { ipcRenderer } from 'electron';
import { useEffect, useState } from 'react';

export type UpdateChannel = 'stable' | 'beta';

/** What src/main/src/autoupdater.js broadcasts on 'auto-update:state'. */
export interface AutoUpdateState {
  status: 'idle' | 'downloading' | 'ready';
  version: string | null;
  percent: number;
  channel: UpdateChannel;
  /** This install can update itself. False in development builds and unsupported Linux installs. */
  enabled: boolean;
  checking: boolean;
  lastCheck: { at: string; result: 'up-to-date' | 'available' | 'error'; message?: string } | null;
}

export const AUTO_UPDATE_IDLE: AutoUpdateState = {
  status: 'idle',
  version: null,
  percent: 0,
  channel: 'stable',
  enabled: false,
  checking: false,
  lastCheck: null
};

/** The updater's live state. Stays at AUTO_UPDATE_IDLE (enabled: false) where the updater is not running. */
export function useAutoUpdateState(): AutoUpdateState {
  const [update, setUpdate] = useState<AutoUpdateState>(AUTO_UPDATE_IDLE);
  useEffect(() => {
    const onState = (_event: unknown, next: AutoUpdateState) => setUpdate(next || AUTO_UPDATE_IDLE);
    ipcRenderer.on('auto-update:state', onState);
    // The window may open after a check or download already happened. No handler (development
    // builds, auto-update off in config) just leaves it idle.
    ipcRenderer
      .invoke('auto-update:get-state')
      .then((current: AutoUpdateState) => current && setUpdate(current))
      .catch(() => {});
    return () => {
      ipcRenderer.off('auto-update:state', onState);
    };
  }, []);
  return update;
}

export const autoUpdateActions = {
  check: (): Promise<AutoUpdateState> => ipcRenderer.invoke('auto-update:check'),
  setChannel: (channel: UpdateChannel): Promise<AutoUpdateState> => ipcRenderer.invoke('auto-update:set-channel', channel),
  install: () => ipcRenderer.send('auto-update:install')
};
