const { dialog, ipcMain } = require('electron');
const log = require('electron-log/main');
const { autoUpdater } = require('electron-updater');
const ProgressBar = require('electron-progressbar');

function setupAutoUpdate(window) {


  if (process.env.autoUpdate === 'no') return;

  if (process.platform === 'linux') {
    return;
  }

  autoUpdater.logger = log;
  let logger = autoUpdater.logger;

  autoUpdater.logger.transports.file.level = 'info';

  //Set autodownload to false (prevents the update from being downloaded automatically)
  autoUpdater.autoDownload = false;

  // Configure update URL for dev mode (from package.json build.publish.url)
  // In dev mode, electron-updater needs explicit configuration
  const updateUrl = 'https://pcrghrjikkcmelflwiys.supabase.co/functions/v1/xgenia-releases';
  autoUpdater.setFeedURL({
    provider: 'generic',
    url: updateUrl
  });

  let progressBar;
  const createProgressBar = () => {
    if (progressBar) return progressBar;
    progressBar = new ProgressBar({
      text: 'Preparing data...',
      detail: 'Wait...',
      abortOnError: true,
      closeOnComplete: false,
      browserWindow: {
        alwaysOnTop: true
      }
    });
    progressBar
      .on('completed', function () {
        progressBar.detail = 'Updates has been downloaded. We are preparing your install.';
      })
      .on('progress', function (value) {
        progressBar.detail = `Value ${value} out of ${progressBar.getOptions().maxValue}...`;
      });
    return progressBar;
  };

  let isDownloading = false;

  function _checkForUpdates() {
    autoUpdater.checkForUpdates().catch((err) => {
      logger.warn('Background update check failed (non-fatal): ' + err.message);
    });
  }
  _checkForUpdates();

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
          createProgressBar();
          autoUpdater.downloadUpdate().catch((err) => {
            isDownloading = false;
            dialog.showErrorBox('Download Error', 'Failed to download update: ' + err.message);
            logger.error('There has been an error downloading the update: ' + err);
            if (progressBar) {
              progressBar.close();
              progressBar = undefined;
            }
          });
        } else {
          logger.info('User chose to skip the update.');
        }
      });
  });

  autoUpdater.on('download-progress', (progressBarObj) => {
    if (!progressBar) {
      createProgressBar();
    }
    progressBar.value = progressBarObj.percent;
  });

  autoUpdater.on('error', (err) => {
    if (isDownloading) {
      dialog.showErrorBox('Update Error', 'An error occurred during the update process: ' + err.message);
    }
    logger.error('Auto-updater error: ' + err.message);
    isDownloading = false;
    if (progressBar) {
      progressBar.close();
      progressBar = undefined;
    }
  });

  autoUpdater.on('update-downloaded', () => {
    isDownloading = false;
    logger.info('Update downloaded');
    if (progressBar) {
      progressBar.close();
      progressBar = undefined;
    }
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

  // ipcMain.on('autoUpdatePopupClosed', (event, restartNow) => {
  //   if (restartNow) {
  //     autoUpdater.quitAndInstall();
  //   }
  // });

  // autoUpdater.addListener("error", (error) => {
  //   console.log('Auto update error', error);
  // });

  // autoUpdater.addListener('update-not-available', () => {
  //   setTimeout(() => {
  //     _checkForUpdates();
  //   }, 60 * 1000);
  // });

  // autoUpdater.addListener('error', (event) => {
  //   // There was an error while trying to update, try again
  //   console.log('Error while auto updating, trying again in a while...');
  //   setTimeout(() => {
  //     _checkForUpdates();
  //   }, 60 * 1000);
  // });
}

module.exports = {
  setupAutoUpdate
};