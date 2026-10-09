const { autoUpdater: squirrelMac, dialog, ipcMain } = require('electron');
const log = require('electron-log/main');
const { autoUpdater } = require('electron-updater');
const { updateFitsThisMachine } = require('./update-arch');

function setupAutoUpdate(window) {
  if (process.env.autoUpdate === 'no') return;

  if (process.platform === 'linux') {
    return;
  }

  autoUpdater.logger = log;
  let logger = autoUpdater.logger;

  autoUpdater.logger.transports.file.level = 'info';

  autoUpdater.autoDownload = false;

  // On macOS electron-updater's 'update-downloaded' only means ITS download finished. The zip then goes to
  // Squirrel.Mac, which fetches it again through a local proxy, unzips and verifies it, and only then can it
  // install. Asking "restart now?" at the first event meant the click did nothing visible for the next
  // 15-30 s; quitting by hand in that gap dropped the update and nothing relaunched (2026-10-08). So on
  // macOS the prompt waits for Squirrel's own 'update-downloaded'. Squirrel only starts on its own because
  // autoInstallOnAppQuit is on, which is also what makes "Later" install at the next quit.
  autoUpdater.autoInstallOnAppQuit = true;
  const waitsForSquirrel = process.platform === 'darwin' && process.env.TEST_UPDATE_FLOW !== 'true';
  let stage = 'idle'; // 'downloading' -> 'staging' (macOS) -> 'ready'
  let squirrelReady = false;
  let downloadedVersion = null;

  const setProgress = (value) => {
    if (window && !window.isDestroyed()) {
      window.setProgressBar(value);
    }
  };

  // A sheet on the editor window, not an app-modal box: with no parent, macOS runs the alert in a modal loop
  // and the main process does nothing until it is answered — the live-engine check and everything else at
  // startup waited behind it (2026-10-07), and so did Squirrel.Mac's staging (2026-10-08).
  const showBox = (box) => {
    const parent = window && !window.isDestroyed() ? window : undefined;
    return parent ? dialog.showMessageBox(parent, box) : dialog.showMessageBox(box);
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
    if (!updateFitsThisMachine(event && event.files)) {
      logger.warn(
        `Update ${event.version} has no ${process.arch} build in its feed (${(event.files || []).map((f) => f && f.url).join(', ')}) — not offered.`
      );
      return;
    }
    showBox({
      type: 'info',
      title: 'Update available',
      message: 'A new update is available. Do you want to update now?',
      buttons: ['Update', 'No']
    }).then((res) => {
      if (res.response === 0) {
        stage = 'downloading';
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
            stage = 'idle';
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
    if (stage === 'downloading' || stage === 'staging') {
      dialog.showErrorBox('Update Error', 'An error occurred during the update process: ' + err.message);
    }
    logger.error('Auto-updater error: ' + err.message);
    stage = 'idle';
    setProgress(-1);
  });

  function offerRestart() {
    stage = 'ready';
    setProgress(-1);
    showBox({
      type: 'info',
      title: 'Update ready',
      message: `XGENIA ${downloadedVersion || 'update'} is ready to install.`,
      detail: 'Restart now to finish, or it installs the next time you quit XGENIA.',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1
    }).then((res) => {
      if (res.response === 0) {
        autoUpdater.quitAndInstall(false, true);
      }
    });
  }

  autoUpdater.on('update-downloaded', (info) => {
    downloadedVersion = (info && info.version) || downloadedVersion;
    if (waitsForSquirrel && !squirrelReady) {
      stage = 'staging';
      setProgress(1);
      logger.info('Update downloaded; waiting for Squirrel.Mac to stage it');
      return;
    }
    logger.info('Update downloaded');
    offerRestart();
  });

  if (waitsForSquirrel) {
    squirrelMac.on('update-downloaded', () => {
      squirrelReady = true;
      logger.info('Squirrel.Mac staged the update');
      if (stage === 'staging') offerRestart();
    });
  }

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
