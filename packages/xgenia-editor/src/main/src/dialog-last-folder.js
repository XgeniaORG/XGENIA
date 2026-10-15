const path = require('path');

/**
 * Electron 43 opens a file dialog that has no `defaultPath` in Downloads, and the OS no longer
 * remembers the last folder between dialogs. This puts the old behaviour back for every caller,
 * main process and @electron/remote alike (they share this `dialog` object): a dialog without a
 * `defaultPath` starts in the folder the user last picked from this session.
 */
function rememberDialogFolder(dialog) {
  let lastFolder;

  const remember = (picked) => {
    if (typeof picked === 'string' && picked) lastFolder = path.dirname(picked);
  };

  // (options) or (window, options); options may be missing.
  const withDefaultPath = (args) => {
    const i = args.length >= 2 ? 1 : 0;
    const options = args[i] || {};
    if (options.defaultPath || !lastFolder) return args;
    const next = args.length ? [...args] : [options];
    next[i] = { ...options, defaultPath: lastFolder };
    return next;
  };

  const { showOpenDialog, showOpenDialogSync, showSaveDialog, showSaveDialogSync } = dialog;

  dialog.showOpenDialog = async (...args) => {
    const result = await showOpenDialog.apply(dialog, withDefaultPath(args));
    if (!result.canceled) remember(result.filePaths[0]);
    return result;
  };
  dialog.showOpenDialogSync = (...args) => {
    const filePaths = showOpenDialogSync.apply(dialog, withDefaultPath(args));
    remember(filePaths && filePaths[0]);
    return filePaths;
  };
  dialog.showSaveDialog = async (...args) => {
    const result = await showSaveDialog.apply(dialog, withDefaultPath(args));
    if (!result.canceled) remember(result.filePath);
    return result;
  };
  dialog.showSaveDialogSync = (...args) => {
    const filePath = showSaveDialogSync.apply(dialog, withDefaultPath(args));
    remember(filePath);
    return filePath;
  };
}

module.exports = { rememberDialogFolder };
