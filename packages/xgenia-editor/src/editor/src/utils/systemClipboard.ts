import { ipcRenderer } from 'electron';

/**
 * The system clipboard, from the editor's renderer.
 *
 * Electron 44 removed the `clipboard` module from renderer processes, so `require('electron')
 * .clipboard` is undefined here. Text goes through the W3C async Clipboard API (the editor's
 * session grants the clipboard permissions); when that refuses, typically because the document
 * isn't focused, the main process does it (`clipboard:*` handlers in main.js).
 */
export async function writeClipboardText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    /* fall through to the main process */
  }
  await ipcRenderer.invoke('clipboard:write-text', text);
}

export async function readClipboardText(): Promise<string> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    /* fall through to the main process */
  }
  return (await ipcRenderer.invoke('clipboard:read-text')) || '';
}
