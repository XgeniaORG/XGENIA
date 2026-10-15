const Store = require('electron-store');
const { ipcMain, safeStorage } = require('electron');

// The async safeStorage methods: the sync ones are deprecated in Electron 45 and removed in 46.
// They use the same OS key stores, so strings encrypted by older builds still decrypt.
async function execute(method, args) {
  switch (method) {
    case 'decryptString':
      return (await safeStorage.decryptStringAsync(Buffer.from(args[0], 'latin1'))).result;

    case 'encryptString':
      return (await safeStorage.encryptStringAsync(args[0])).toString('latin1');

    case 'isEncryptionAvailable':
      return safeStorage.isAsyncEncryptionAvailable();
  }
}

module.exports = {
  setup(mainWindow) {
    Store.initRenderer();

    ipcMain.on('storage-api', async (_, { token, method, args }) => {
      let data;
      try {
        data = await execute(method, args);
      } catch (error) {
        // Still answer, or the renderer's promise waits forever.
        console.error('[Storage]', error);
      }
      if (!mainWindow.isDestroyed()) mainWindow.webContents.send('storage-api', { token, data });
    });
  }
};
