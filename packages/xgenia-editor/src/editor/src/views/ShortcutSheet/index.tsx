import React from 'react';

import { DialogLayerModel } from '@xgenia-models/DialogLayerModel';
import { isTypingTarget } from '@xgenia-utils/keyboardhandler';

import { ShortcutSheet } from './ShortcutSheet';

const SHEET_ID = 'keyboard-shortcuts';

export function toggleShortcutSheet() {
  const layer = DialogLayerModel.instance;
  if (layer.isOpen(SHEET_ID)) {
    layer.closeById(SHEET_ID);
    return;
  }
  layer.show(SHEET_ID, () => <ShortcutSheet onClose={() => layer.closeById(SHEET_ID)} />);
}

let installed = false;

/** Help > Keyboard Shortcuts, and ? while not typing (the preview forwards its own ?). */
export function installShortcutSheet() {
  if (installed) return;
  installed = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ipcRenderer } = require('electron');
    ipcRenderer.on('editor-menu-command', (_event: unknown, args: { command?: string }) => {
      if (args && args.command === 'showShortcuts') toggleShortcutSheet();
    });
  } catch {
    // not in Electron
  }
  document.addEventListener('keydown', (e) => {
    if (e.key !== '?' || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    if (isTypingTarget(document.activeElement)) return;
    e.preventDefault();
    toggleShortcutSheet();
  });
}
