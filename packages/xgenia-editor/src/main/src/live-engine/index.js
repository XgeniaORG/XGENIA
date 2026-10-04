// Live engine: the preview engine, the export runtime and the RGS compiler come from a signed pack
// CI publishes, instead of only from the app build. Design:
// docs/superpowers/specs/2026-10-03-live-engine-design.md
'use strict';
const fs = require('fs');
const path = require('path');
const { EngineStore } = require('./engine-store');
const { selectEngine, markHealthy, markBad, markCleanExit } = require('./select');
const { checkForEngineUpdate } = require('./updater');
const { ENGINE_PUBLIC_KEY_PEM } = require('./public-key');
const { SHELL_API_VERSION } = require('./shell-api');

async function fetchBytes(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function channelFor(env, store) {
  if (env.XGENIA_ENGINE_CHANNEL === 'beta' || env.XGENIA_ENGINE_CHANNEL === 'stable') return env.XGENIA_ENGINE_CHANNEL;
  try {
    const s = JSON.parse(fs.readFileSync(path.join(store.baseDir, 'settings.json'), 'utf8'));
    if (s.channel === 'beta' || s.channel === 'stable') return s.channel;
  } catch {
    /* no settings file */
  }
  return 'stable';
}

function setupLiveEngine({
  app,
  ipcMain,
  env = process.env,
  log = console,
  publicKeyPem = ENGINE_PUBLIC_KEY_PEM,
  shellApi = SHELL_API_VERSION,
  fetch: fetchImpl = fetchBytes,
  timings = {}
}) {
  const { checkAfterMs = 15000, checkEveryMs = 6 * 3600 * 1000, healthTimeoutMs = 90000 } = timings;
  const store = new EngineStore(path.join(app.getPath('userData'), 'engine'));
  let info;
  try {
    info = selectEngine({ appPath: app.getAppPath(), isPackaged: app.isPackaged, env, store, publicKeyPem, shellApi });
  } catch (e) {
    const root = path.join(app.getAppPath(), 'src/external');
    info = { root, builtinRoot: root, version: 'builtin', source: 'builtin', reason: 'engine selection failed: ' + e.message, allowUpdates: false };
  }
  env.XGENIA_ENGINE_ROOT = info.root;
  env.XGENIA_ENGINE_VERSION = info.version;
  global.xgeniaLiveEngine = info;
  log.log(`[live-engine] ${info.source} ${info.version} — ${info.reason} (${info.root})`);

  const timers = [];
  if (info.source === 'live') {
    let healthy = false;
    let healthTimer = null;
    ipcMain.on('live-engine:viewer-ok', (_event, version) => {
      if (healthy || version !== info.version) return;
      healthy = true;
      if (healthTimer) clearTimeout(healthTimer);
      markHealthy(store, info.version);
    });
    app.on('xgenia:viewer-bundle-served', () => {
      if (healthy || healthTimer) return;
      healthTimer = setTimeout(() => {
        if (healthy) return;
        log.warn(`[live-engine] the preview never reported in on ${info.version}; the next start returns to the previous engine`);
        markBad(store, info.version);
      }, healthTimeoutMs);
      if (healthTimer.unref) healthTimer.unref();
      timers.push(healthTimer);
    });
  }
  if (info.source === 'live' || info.allowUpdates) {
    app.on('will-quit', () => {
      try {
        markCleanExit(store);
      } catch {
        /* quitting anyway */
      }
    });
  }

  if (info.allowUpdates) {
    const check = () =>
      checkForEngineUpdate({ store, channel: channelFor(env, store), fetchBytes: fetchImpl, publicKeyPem, shellApi })
        .then((r) => log.log('[live-engine] update check: ' + JSON.stringify(r)))
        .catch((e) => log.warn('[live-engine] update check failed: ' + e.message));
    const first = setTimeout(check, checkAfterMs);
    const every = setInterval(check, checkEveryMs);
    for (const t of [first, every]) {
      if (t.unref) t.unref();
      timers.push(t);
    }
  }
  return {
    info,
    store,
    stop: () =>
      timers.forEach((t) => {
        clearTimeout(t);
        clearInterval(t);
      })
  };
}

module.exports = { setupLiveEngine, channelFor };
