const { dialog, ipcMain } = require('electron');
const log = require('electron-log/main');
const { autoUpdater } = require('electron-updater');

function setupAutoUpdate(window) {
  if (process.env.autoUpdate === 'no') return;

  if (process.platform === 'linux') {
    return;
  }

  autoUpdater.logger = log;
  let logger = autoUpdater.logger;

  autoUpdater.logger.transports.file.level = 'info';

  autoUpdater.autoDownload = false;

  let isDownloading = false;

  const setProgress = (value) => {
    if (window && !window.isDestroyed()) {
      window.setProgressBar(value);
    }
  };

  function _checkForUpdates() {
    autoUpdater.checkForUpdates().catch((err) => {
      logger.warn('Background update check failed (non-fatal): ' + err.message);
    });
  }
  _checkForUpdates();

  if (process.env.TEST_UPDATE_FLOW === 'true') {
    setTimeout(() => {
      logger.info('[TEST] Simulating update-available');
      autoUpdater.emit('update-available', { version: '999.0.0' });
    }, 2000);
  }

  autoUpdater.on('update-available', (event) => {
    logger.info('Update available: ' + event.version);
    dialog
      .showMessageBox({
        type: 'info',
        title: 'Update available',
        message: 'A new update is available. Do you want to update now?',
        buttons: ['Update', 'No']
      })
      .then((res) => {
        if (res.response === 0) {
          isDownloading = true;
          setProgress(0);

          if (process.env.TEST_UPDATE_FLOW === 'true') {
            let percent = 0;
            const interval = setInterval(() => {
              percent += 5;
              autoUpdater.emit('download-progress', {
                percent,
                transferred: Math.round((percent / 100) * 20000000),
                total: 20000000,
                bytesPerSecond: 1000000
              });
              if (percent >= 100) {
                clearInterval(interval);
                logger.info('[TEST] Simulating update-downloaded');
                autoUpdater.emit('update-downloaded');
              }
            }, 300);
          } else {
            autoUpdater.downloadUpdate().catch((err) => {
              isDownloading = false;
              setProgress(-1);
              dialog.showErrorBox('Download Error', 'Failed to download update: ' + err.message);
              logger.error('There has been an error downloading the update: ' + err);
            });
          }
        } else {
          logger.info('User chose to skip the update.');
        }
      });
  });

  autoUpdater.on('download-progress', (progressBarObj) => {
    const percent = Number(progressBarObj?.percent);
    if (Number.isFinite(percent)) {
      setProgress(percent / 100);
      logger.info(`Download progress: ${percent.toFixed(1)}%`);
    }
  });

  autoUpdater.on('error', (err) => {
    if (isDownloading) {
      dialog.showErrorBox('Update Error', 'An error occurred during the update process: ' + err.message);
    }
    logger.error('Auto-updater error: ' + err.message);
    isDownloading = false;
    setProgress(-1);
  });

  autoUpdater.on('update-downloaded', () => {
    isDownloading = false;
    setProgress(-1);
    logger.info('Update downloaded');
    dialog
      .showMessageBox({
        type: 'info',
        title: 'Update ready',
        message: 'Update has been downloaded. Do you want to quit and restart?',
        buttons: ['Quit', 'Later']
      })
      .then((res) => {
        if (res.response === 0) {
          autoUpdater.quitAndInstall(false, true);
        }
      });
  });

  ipcMain.on('autoUpdatePopupClosed', (event, restartNow) => {
    if (restartNow) {
      autoUpdater.quitAndInstall(false, true);
    }
  });

  autoUpdater.addListener('update-not-available', () => {
    setTimeout(
      () => {
        _checkForUpdates();
      },
      12 * 60 * 60 * 1000
    );
  });

  autoUpdater.addListener('error', (event) => {
    console.log('Error while auto updating, trying again in a while...');
    setTimeout(
      () => {
        _checkForUpdates();
      },
      12 * 60 * 60 * 1000
    );
  });
}

module.exports = {
  setupAutoUpdate
};
