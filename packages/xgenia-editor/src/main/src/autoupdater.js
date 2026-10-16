// The update flow most Electron apps use (VS Code, Slack, Discord): check in the background,
// download in the background, show it in the app once it is on disk, and install it on quit when
// the user does not restart sooner. No native dialogs: the title bar and an in-app dialog
// (BaseWindow.tsx) show the state this module broadcasts, and Settings → Editor → Updates
// (UpdatesSection.tsx) picks the channel and checks on demand.
//
// Every update is checked before it is downloaded: CI signs each release's latest*.yml, and the
// files electron-updater is about to fetch must match that signed manifest (update-manifest.js).
// A release without a valid signature is never downloaded.
//
// Channel, chosen by the user and Stable unless they opt in (like Slack's release channel or
// Obsidian's early access), saved in <userData>/update-settings.json:
//   - stable: stable releases only.
//   - beta:   betas and nightlies (.github/workflows/nightly.yml) as well as stable releases.
// Never a downgrade: leaving Beta keeps the running build until a newer stable release ships, so a
// project saved by a nightly is never opened by an older build. A nightly already downloaded when
// the user leaves Beta is dropped, not installed.
//
// Linux: the AppImage replaces itself; the .deb installs through pkexec (electron-updater picks
// DebUpdater from resources/package-type). Anything else on Linux cannot update itself.
const fs = require('fs');
const path = require('path');
const { app, autoUpdater: squirrelMac, BrowserWindow, ipcMain, net } = require('electron');
const log = require('electron-log/main');
const { autoUpdater } = require('electron-updater');

const { MAX_MANIFEST_BYTES, manifestName, releaseAssetUrl, verifyUpdateInfo } = require('./update-manifest');
const { UPDATE_PUBLIC_KEY_PEM } = require('./update-public-key');
const { updateFitsThisMachine } = require('./update-arch');

// Where releases are published (packages/xgenia-editor/package.json → build.publish).
const RELEASE_REPO = 'XgeniaORG/XGENIA';
const FIRST_CHECK_DELAY_MS = 30 * 1000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const CHANNELS = ['stable', 'beta'];
const DEFAULT_CHANNEL = 'stable';

/**
 * What the renderer shows.
 *   status:    idle | downloading | ready
 *   enabled:   this install can update itself
 *   checking:  a check is running
 *   lastCheck: { at, result: 'up-to-date' | 'available' | 'error', message? } or null
 *   failure:   { at, version, message } when an update failed while downloading or installing
 *              (BaseWindow shows it once); null otherwise. A failed background check is not one.
 */
let state = {
  status: 'idle',
  version: null,
  percent: 0,
  channel: DEFAULT_CHANNEL,
  enabled: false,
  checking: false,
  lastCheck: null,
  failure: null
};

function setState(next) {
  state = { ...state, ...next };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('auto-update:state', state);
  }
}

function settingsPath() {
  return path.join(app.getPath('userData'), 'update-settings.json');
}

function readChannel() {
  try {
    const { channel } = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    return CHANNELS.includes(channel) ? channel : DEFAULT_CHANNEL;
  } catch {
    return DEFAULT_CHANNEL;
  }
}

function writeChannel(channel) {
  fs.writeFileSync(settingsPath(), JSON.stringify({ channel }, null, 2));
}

const isPrerelease = (version) => /-/.test(String(version || ''));

/** Whether an update to `version` belongs to the chosen channel. */
const wanted = (version) => state.channel === 'beta' || !isPrerelease(version);

function applyChannel(channel) {
  autoUpdater.allowPrerelease = channel === 'beta';
  autoUpdater.allowDowngrade = false;
}

function canUpdateOnLinux() {
  if (process.env.APPIMAGE) return true;
  try {
    return fs.readFileSync(path.join(process.resourcesPath, 'package-type'), 'utf8').trim() === 'deb';
  } catch {
    return false;
  }
}

async function fetchText(url) {
  const res = await net.fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_MANIFEST_BYTES) throw new Error(`${url}: too large`);
  return buf;
}

/** Throws unless the update electron-updater found is what our CI signed. */
async function verifyAgainstSignedManifest(info) {
  const tag = info.tag || `v${info.version}`;
  const name = manifestName();
  const [manifest, signature] = await Promise.all([
    fetchText(releaseAssetUrl(RELEASE_REPO, tag, name)),
    fetchText(releaseAssetUrl(RELEASE_REPO, tag, name + '.sig'))
  ]);
  verifyUpdateInfo({ info, manifest, signature: signature.toString('utf8'), publicKeyPem: UPDATE_PUBLIC_KEY_PEM });
}

let started = false;
let progressWindow = null;

function setupAutoUpdate(window) {
  // Called wherever a main window is created; the updater and its IPC handlers are set up once,
  // and the taskbar progress follows the newest window.
  progressWindow = window;
  if (started) return;
  started = true;

  const testFlow = process.env.TEST_UPDATE_FLOW === 'true';
  const enabled =
    !testFlow && process.env.autoUpdate !== 'no' && (process.platform !== 'linux' || canUpdateOnLinux());
  const channel = readChannel();
  state = { ...state, channel, enabled: enabled || testFlow };

  ipcMain.handle('auto-update:get-state', () => state);
  ipcMain.handle('auto-update:check', () => checkForUpdates());
  ipcMain.handle('auto-update:set-channel', (_event, next) => setChannel(next));
  ipcMain.on('auto-update:install', () => {
    if (state.status === 'ready' && !testFlow) autoUpdater.quitAndInstall(false, true);
  });

  if (testFlow) {
    simulateUpdate();
    return;
  }
  if (!enabled) {
    log.info('Auto-update: off for this install (autoUpdate=no, or Linux without AppImage/.deb)');
    return;
  }

  autoUpdater.logger = log;
  log.transports.file.level = 'info';
  // Download only after the signature check below.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  applyChannel(channel);

  const setProgress = (value) => {
    if (progressWindow && !progressWindow.isDestroyed()) progressWindow.setProgressBar(value);
  };

  setTimeout(checkForUpdates, FIRST_CHECK_DELAY_MS);
  setInterval(checkForUpdates, CHECK_INTERVAL_MS).unref();

  let downloaded = null;
  // An update that was downloading or being installed failed: the user is told (BaseWindow shows
  // `failure` once), not left looking at "Downloading 100%". Back to idle, so the next check retries.
  const failInstall = (err) => {
    const message = String((err && err.message) || err || 'unknown error');
    const at = new Date().toISOString();
    log.error(`Update ${state.version || ''} failed: ${message}`);
    setProgress(-1);
    downloaded = null;
    setState({
      status: 'idle',
      version: null,
      percent: 0,
      failure: { at, version: state.version, message },
      lastCheck: { at, result: 'error', message: 'The update could not be installed.' }
    });
  };

  autoUpdater.on('update-not-available', () => {
    setState({ lastCheck: { at: new Date().toISOString(), result: 'up-to-date' } });
  });

  autoUpdater.on('update-available', async (info) => {
    if (!wanted(info.version)) return;
    // A feed with no build for this machine's architecture (an arm64-only release on an Intel Mac) is not offered.
    if (!updateFitsThisMachine(info && info.files)) {
      log.warn(`Update ${info.version} has no ${process.arch} build in its feed — not offered.`);
      return;
    }
    try {
      await verifyAgainstSignedManifest(info);
    } catch (err) {
      log.error(`Update ${info.version} refused: ${err.message}`);
      setState({ lastCheck: { at: new Date().toISOString(), result: 'error', message: 'The update could not be verified.' } });
      return;
    }
    log.info(`Update ${info.version} verified, downloading in the background`);
    setState({
      status: 'downloading',
      version: info.version,
      percent: 0,
      failure: null,
      lastCheck: { at: new Date().toISOString(), result: 'available' }
    });
    autoUpdater.downloadUpdate().catch((err) => {
      if (state.status === 'downloading') failInstall(err);
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    const percent = Number(progress?.percent);
    if (Number.isFinite(percent)) {
      setProgress(percent / 100);
      setState({ percent: Math.round(percent) });
    }
  });

  // A failed background check is logged and retried at the next interval; a failure while an update
  // is downloading or being installed (on macOS that includes Squirrel's own errors, which
  // electron-updater passes on here) is shown to the user.
  autoUpdater.on('error', (err) => {
    if (state.status === 'downloading') return failInstall(err);
    setProgress(-1);
    log.error('Auto-updater error: ' + (err?.message || err));
  });

  // On macOS electron-updater's 'update-downloaded' only means ITS download finished: Squirrel.Mac then fetches
  // the zip again through a local proxy, unzips and verifies it, and only then can it install. Showing "ready"
  // at the first event made Restart do nothing visible for 15-30 s, and quitting in that gap dropped the update
  // (2026-10-08). So on macOS the update is ready once Squirrel's own 'update-downloaded' has arrived too.
  const waitsForSquirrel = process.platform === 'darwin' && !!squirrelMac && typeof squirrelMac.on === 'function';
  let squirrelReady = false;
  const markReady = () => {
    if (!downloaded || (waitsForSquirrel && !squirrelReady)) return;
    log.info('Update ready to install: ' + downloaded);
    setState({ status: 'ready', version: downloaded, percent: 100 });
  };
  if (waitsForSquirrel) {
    squirrelMac.on('update-downloaded', () => { squirrelReady = true; markReady(); });
    // Staging can fail (a bad signature, a full disk): tell the user rather than wait forever.
    squirrelMac.on('error', (err) => {
      if (state.status === 'downloading') failInstall(err);
      else log.error('Squirrel.Mac: ' + (err?.message || err));
    });
  }

  autoUpdater.on('update-downloaded', (info) => {
    setProgress(-1);
    // The user left Beta while a nightly was downloading: never install it.
    if (!wanted(info.version)) {
      autoUpdater.autoInstallOnAppQuit = false;
      setState({ status: 'idle', version: null, percent: 0 });
      return;
    }
    autoUpdater.autoInstallOnAppQuit = true;
    downloaded = info.version;
    log.info('Update downloaded: ' + info.version + (waitsForSquirrel && !squirrelReady ? ' (macOS: waiting for Squirrel to stage it)' : ''));
    if (waitsForSquirrel && !squirrelReady) setState({ status: 'downloading', version: info.version, percent: 100 });
    markReady();
  });
}

let checking = null;
/** Runs one check (background timer or the Settings button); resolves to the state after it. */
function checkForUpdates() {
  // One downloaded update is enough: it installs on quit, and the next start checks again.
  if (!state.enabled || process.env.TEST_UPDATE_FLOW === 'true' || state.status !== 'idle') return Promise.resolve(state);
  if (!checking) {
    setState({ checking: true });
    checking = autoUpdater
      .checkForUpdates()
      .catch((err) => {
        log.warn('Update check failed (non-fatal): ' + err.message);
        setState({ lastCheck: { at: new Date().toISOString(), result: 'error', message: 'Could not reach the update server.' } });
      })
      .finally(() => {
        checking = null;
        setState({ checking: false });
      });
  }
  return checking.then(() => state);
}

function setChannel(next) {
  if (!CHANNELS.includes(next)) throw new Error(`unknown update channel: ${next}`);
  writeChannel(next);
  setState({ channel: next, lastCheck: null });
  if (process.env.TEST_UPDATE_FLOW === 'true' || !state.enabled) return state;
  applyChannel(next);
  // Leaving Beta with a nightly already downloaded: drop it rather than install it on quit.
  if (state.status === 'ready' && !wanted(state.version)) {
    autoUpdater.autoInstallOnAppQuit = false;
    setState({ status: 'idle', version: null, percent: 0 });
  }
  log.info('Update channel set to ' + next);
  checkForUpdates();
  return state;
}

// TEST_UPDATE_FLOW=true: walk the UI through downloading and ready without touching the network.
function simulateUpdate() {
  setTimeout(() => {
    setState({ status: 'downloading', version: '999.0.0', percent: 0 });
    let percent = 0;
    const interval = setInterval(() => {
      percent += 10;
      setState({ percent });
      if (percent >= 100) {
        clearInterval(interval);
        setState({ status: 'ready' });
      }
    }, 300);
  }, 2000);
}

/**
 * Where the updater does not run (development builds, Config.enableAutoUpdate off), the windows still
 * ask for its state on load. Answer with the idle, disabled state instead of leaving the calls with
 * no handler: Electron logs every one of those as an error, which buried real ones in the log.
 */
function setupDisabledAutoUpdate() {
  if (started) return;
  started = true;
  ipcMain.handle('auto-update:get-state', () => state);
  ipcMain.handle('auto-update:check', () => state);
  ipcMain.handle('auto-update:set-channel', () => state);
}

module.exports = {
  setupAutoUpdate,
  setupDisabledAutoUpdate
};
