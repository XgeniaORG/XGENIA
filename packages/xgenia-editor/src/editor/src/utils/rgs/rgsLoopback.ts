// The renderer's side of the "Sign in with XGENIA" loopback (src/main/src/xgenia-rgs-loopback.js).
//
// The listening socket lives in the main process; this is the IPC to it, behind an interface so
// rgsClient.connectWithXgeniaRgs and the panel tests run without Electron (setXgeniaRgsLoopback).

/** What the browser handed back: a one-time code, or a refusal (also TIMEOUT / CANCELLED / LOOPBACK_FAILED). */
export type LoopbackOutcome = { code: string } | { error: string; message?: string };

export interface XgeniaRgsLoopback {
  /** Start listening; the redirect to give the RGS, and this computer's name to label the key with. */
  listen(): Promise<{ id: string; redirectUri: string; installLabel: string }>;
  /** Open the RGS's sign-in page in the system browser. */
  openBrowser(id: string, authorizeUrl: string): Promise<void>;
  /** Wait for the browser's answer (at most 5 minutes). Never rejects. */
  wait(id: string): Promise<LoopbackOutcome>;
  /** Stop listening; a pending wait answers CANCELLED. */
  cancel(id: string): Promise<void>;
}

let override: XgeniaRgsLoopback | null = null;

/** Replace the Electron bridge (tests). null restores it. */
export function setXgeniaRgsLoopback(loopback: XgeniaRgsLoopback | null): void {
  override = loopback;
}

/** The loopback to use, or null outside the desktop app (the web build has no main process). */
export function xgeniaRgsLoopback(): XgeniaRgsLoopback | null {
  if (override) return override;
  let ipcRenderer: any = null;
  try {
    // Lazily, as elsewhere in the editor: this module also loads where Electron does not exist.
    ipcRenderer = require('electron')?.ipcRenderer;
  } catch {
    ipcRenderer = null;
  }
  if (!ipcRenderer?.invoke) return null;
  return {
    listen: () => ipcRenderer.invoke('xgenia-rgs:listen'),
    openBrowser: (id, url) => ipcRenderer.invoke('xgenia-rgs:open-browser', id, url),
    wait: (id) => ipcRenderer.invoke('xgenia-rgs:wait', id),
    cancel: (id) => ipcRenderer.invoke('xgenia-rgs:cancel', id)
  };
}
