/**
 * linux-desktop-entry.js — make the desktop shell show the XGENIA logo instead of the
 * generic gear.
 *
 * WHY THIS EXISTS (2026-08-27, user report: "on Ubuntu the XGENIA icon does not appear,
 * the default gear is shown instead"). The BrowserWindow `icon:` option was never the
 * problem. Measured on this Ubuntu 24.04 / GNOME 46 box: the editor window carries a
 * complete 1024x1024 `_NET_WM_ICON` (1048578 CARDINALs, read straight off the X
 * property) and the dock still drew a gear. GNOME 45+ no longer renders a window's own
 * icon: a window it cannot attribute to an *installed application* gets a placeholder
 * app whose icon is `application-x-executable` — the gear. (`_NET_WM_ICON` is still
 * worth setting, and main.js still does: XFCE, KDE and the tiling WMs do read it.)
 *
 * Attribution runs through WM_CLASS. Electron derives it from app.getName(), so the
 * window announces itself as ("xgenia", "XGENIA"), and the shell looks for a desktop
 * entry whose StartupWMClass is one of those:
 *
 *   - installed .deb  → electron-builder writes StartupWMClass=XGENIA into
 *                       /usr/share/applications, so it already resolves. We stay out.
 *   - `npm run dev`   → no entry anywhere.
 *   - dist/linux-unpacked → no entry anywhere.
 *
 * The last two are exactly the two cases that showed the gear, so we write a user-level
 * entry for them. It is NoDisplay: it exists so the shell can name and illustrate our
 * window, not to add a launcher for a build directory to the user's app grid. NoDisplay
 * entries stay in g_app_info_get_all(), so StartupWMClass matching still finds them
 * (verified against GNOME 46 before this module was written).
 *
 * The entry is deliberately NOT named `xgenia-editor.desktop`: that is the basename the
 * .deb installs (electron-builder derives it from package.json `name`), and a file in
 * XDG_DATA_HOME shadows the system one. A stale NoDisplay copy would then hide XGENIA
 * from the app grid of a machine that later installed the package.
 */
const { app, nativeImage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Must not collide with the .deb's own entry — see the header comment.
const ENTRY_FILENAME = 'xgenia-editor-local.desktop';
const ICON_FILENAME = 'xgenia-editor-local.png';
// GNOME scales freely from one source, and 512 keeps the file (and the write we do on
// every launch that finds it stale) at a few hundred KB rather than the 1.7MB of the
// 1024x1024 original.
const ICON_SIZE = 512;

/**
 * An installed package ships its own desktop entry and its own icon theme files, so
 * there is nothing for us to add — and adding it would risk shadowing them.
 */
function isSystemInstall() {
  return process.execPath.startsWith('/opt/') || process.execPath.startsWith('/usr/');
}

function xdgDataHome() {
  const fromEnv = process.env.XDG_DATA_HOME;
  // The spec says a relative XDG_DATA_HOME must be ignored.
  if (fromEnv && path.isAbsolute(fromEnv)) return fromEnv;
  return path.join(os.homedir(), '.local', 'share');
}

/**
 * Desktop-entry values are not shell words: only the Exec key is tokenized, and there a
 * path containing spaces has to be double-quoted.
 */
function quoteExecArg(value) {
  return `"${value.replace(/(["`$\\])/g, '\\$1')}"`;
}

function buildExec() {
  // Packaged: process.execPath IS the app. Unpackaged: Electron needs to be told which
  // app to load, the same way `electron .` does.
  const argv = app.isPackaged ? [process.execPath] : [process.execPath, app.getAppPath()];
  return `${argv.map(quoteExecArg).join(' ')} %U`;
}

function buildEntry(iconFile) {
  // Icon= takes an absolute path as well as a theme name, and a path skips the icon
  // theme cache — which nothing regenerates for us after we write the PNG.
  return [
    '[Desktop Entry]',
    '# Written by XGENIA (src/main/src/linux-desktop-entry.js) so the desktop shell can',
    '# attribute this window to XGENIA and draw its logo. Safe to delete; it comes back',
    '# on the next launch of a dev or unpacked build.',
    'Type=Application',
    `Name=${app.getName()}`,
    'Comment=Node-Based App Builder',
    `Exec=${buildExec()}`,
    `Icon=${iconFile}`,
    'Terminal=false',
    'Categories=Development;IDE;',
    // Electron sets WM_CLASS from app.getName(); this is the value the shell matches on.
    `StartupWMClass=${app.getName()}`,
    'NoDisplay=true',
    ''
  ].join('\n');
}

function isUnchanged(file, contents) {
  try {
    return Buffer.compare(fs.readFileSync(file), Buffer.from(contents)) === 0;
  } catch {
    return false; // missing or unreadable
  }
}

function write(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

function hasIcon(file) {
  try {
    return fs.statSync(file).size > 0;
  } catch {
    return false;
  }
}

/**
 * Ensure a user-level desktop entry exists that the shell can match this window to.
 *
 * Call before the first window is created: the shell resolves a window's app when the
 * window is mapped, so an entry that lands afterwards may not be picked up until the
 * next launch.
 *
 * @param {string} iconPath source PNG for the entry's icon; may live inside app.asar.
 */
function ensureLinuxDesktopEntry(iconPath) {
  if (process.platform !== 'linux') return;

  try {
    if (isSystemInstall()) return;

    const dataHome = xdgDataHome();
    // fs reads through app.asar, GNOME does not — so the entry can never point at the
    // packaged copy and we keep our own on the real filesystem.
    const iconFile = path.join(dataHome, 'icons', 'hicolor', `${ICON_SIZE}x${ICON_SIZE}`, 'apps', ICON_FILENAME);
    const entryFile = path.join(dataHome, 'applications', ENTRY_FILENAME);
    const entry = buildEntry(iconFile);

    // Steady state is two stats. Decoding and rescaling the 1024x1024 source costs ~90ms,
    // which is not worth paying on every boot to rewrite bytes that already match.
    if (isUnchanged(entryFile, entry) && hasIcon(iconFile)) return;

    const image = nativeImage.createFromPath(iconPath);
    if (image.isEmpty()) {
      console.warn('[linux-desktop-entry] icon could not be decoded, skipping:', iconPath);
      return;
    }
    write(iconFile, image.resize({ width: ICON_SIZE, height: ICON_SIZE, quality: 'best' }).toPNG());
    write(entryFile, entry);
    console.warn('[linux-desktop-entry] wrote', entryFile);
  } catch (e) {
    // Cosmetic feature — a read-only or unusual HOME must never stop the editor booting.
    console.warn('[linux-desktop-entry] skipped:', e && e.message ? e.message : e);
  }
}

module.exports = { ensureLinuxDesktopEntry };
