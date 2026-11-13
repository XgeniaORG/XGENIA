import { ipcRenderer } from 'electron';
import { useEffect, useState } from 'react';

export type UpdateChannel = 'stable' | 'beta';

/** One line of a release's notes, as plain text (src/main/src/release-notes.js). */
export interface ReleaseNoteBlock {
  type: 'heading' | 'item' | 'text';
  text: string;
  /** List nesting for 'item': 0 is a top-level bullet. */
  depth?: number;
}

/** What changed in one release. */
export interface ReleaseNotes {
  version: string;
  blocks: ReleaseNoteBlock[];
}

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
  /** An update that failed while downloading or installing; shown to the user once. */
  failure: { at: string; version: string | null; message: string } | null;
  /** Every release between the running version and `version`, newest first; [] when none. */
  releaseNotes: ReleaseNotes[];
}

export const AUTO_UPDATE_IDLE: AutoUpdateState = {
  status: 'idle',
  version: null,
  percent: 0,
  channel: 'stable',
  enabled: false,
  checking: false,
  lastCheck: null,
  failure: null,
  releaseNotes: []
};

/** The updater's live state. Stays at AUTO_UPDATE_IDLE (enabled: false) where the updater is not running. */
export function useAutoUpdateState(): AutoUpdateState {
  const [update, setUpdate] = useState<AutoUpdateState>(AUTO_UPDATE_IDLE);
  useEffect(() => {
    // Spread over the idle state: a main process from before releaseNotes existed still works.
    const onState = (_event: unknown, next: AutoUpdateState) => setUpdate(next ? { ...AUTO_UPDATE_IDLE, ...next } : AUTO_UPDATE_IDLE);
    ipcRenderer.on('auto-update:state', onState);
    // The window may open after a check or download already happened. No handler (development
    // builds, auto-update off in config) just leaves it idle.
    ipcRenderer
      .invoke('auto-update:get-state')
      .then((current: AutoUpdateState) => current && setUpdate({ ...AUTO_UPDATE_IDLE, ...current }))
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

/** The GitHub page of a release, for the full notes. */
export function releasePageUrl(version: string): string {
  return `https://github.com/XgeniaORG/XGENIA/releases/tag/v${encodeURIComponent(version)}`;
}
