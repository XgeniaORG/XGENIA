// Live engine: the preview engine, the export runtime and the RGS compiler come from a signed pack
// CI publishes, instead of only from the app build. Design:
// private/docs/live-engine/2026-10-03-live-engine-design.md
'use strict';
const fs = require('fs');
const path = require('path');
const { EngineStore } = require('./engine-store');
const { selectEngine, markHealthy, markTrialTimedOut, markCleanExit } = require('./select');
const { checkForEngineUpdate } = require('./updater');
const { ENGINE_PUBLIC_KEY_PEM } = require('./public-key');
const { SHELL_API_VERSION } = require('./shell-api');

/**
 * Electron's own network stack when there is one (system proxy settings, the OS certificate store,
 * as corporate networks need), Node's fetch otherwise. Electron's net is usable once the app is
 * ready; the first update check runs well after that.
 */
function pickFetch(electronModule, nodeFetch) {
  if (electronModule && electronModule.net && typeof electronModule.net.fetch === 'function') {
    return (url, init) => electronModule.net.fetch(url, init);
  }
  return nodeFetch;
}

let electronModule;
try {
  electronModule = require('electron');
} catch {
  electronModule = undefined;
}
const doFetch = pickFetch(electronModule, globalThis.fetch);

/** GET a URL into a Buffer, refusing anything over `maxBytes` (declared or streamed). */
async function fetchBytes(url, maxBytes = 64 * 1024 * 1024) {
  const res = await doFetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const tooBig = () => new Error(`${url} exceeds ${maxBytes} bytes`);
  if (Number(res.headers.get('content-length')) > maxBytes) {
    try {
      await res.body.cancel();
    } catch {
      /* already closed */
    }
    throw tooBig();
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of res.body) {
    total += chunk.length;
    if (total > maxBytes) throw tooBig();
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function record(store, key, value) {
  try {
    const s = store.readState();
    s[key] = { at: new Date().toISOString(), ...value };
    store.writeState(s);
  } catch {
    /* bookkeeping only */
  }
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
  const { checkAfterMs = 15000, checkEveryMs = 6 * 3600 * 1000, retryAfterMs = 5 * 60 * 1000, healthTimeoutMs = 90000 } = timings;
  const store = new EngineStore(path.join(app.getPath('userData'), 'engine'));
  let info;
  try {
    info = selectEngine({ appPath: app.getAppPath(), appVersion: app.getVersion?.(), isPackaged: app.isPackaged, env, store, publicKeyPem, shellApi });
  } catch (e) {
    const root = path.join(app.getAppPath(), 'src/external');
    info = { root, builtinRoot: root, version: 'builtin', source: 'builtin', reason: 'engine selection failed: ' + e.message, allowUpdates: false, trial: false };
  }
  env.XGENIA_ENGINE_ROOT = info.root;
  env.XGENIA_ENGINE_VERSION = info.version;
  global.xgeniaLiveEngine = info;
  log.log(`[live-engine] ${info.source} ${info.version} — ${info.reason} (${info.root})`);
  // The production main process silences console.log; state.json is the record of what ran.
  if (info.source === 'live' || info.allowUpdates) record(store, 'lastStart', { version: info.version, source: info.source, reason: info.reason });

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
    // Only a run that is an engine's trial can fail it; a proven engine is never banned by one slow
    // preview. The web server announces the first request for the preview page or the engine bundle.
    app.on('xgenia:preview-requested', () => {
      if (!info.trial || healthy || healthTimer) return;
      healthTimer = setTimeout(() => {
        if (healthy) return;
        log.warn(`[live-engine] the preview has not reported in on ${info.version}; unless it does, the next start returns to the previous engine`);
        markTrialTimedOut(store, info.version);
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
    // A failed or refused check (offline, or the manifest and its signature fetched mid-publish) is
    // tried again soon, once, rather than at the next 6-hour tick.
    let retryPending = false;
    const check = (isRetry = false) =>
      checkForEngineUpdate({ store, channel: channelFor(env, store), fetchBytes: fetchImpl, publicKeyPem, shellApi })
        .then((r) => {
          record(store, 'lastCheck', r);
          log.log('[live-engine] update check: ' + JSON.stringify(r));
          if ((r.status === 'error' || r.status === 'rejected') && !isRetry && !retryPending) {
            retryPending = true;
            const t = setTimeout(() => {
              retryPending = false;
              check(true);
            }, retryAfterMs);
            if (t.unref) t.unref();
            timers.push(t);
          }
        })
        .catch((e) => log.warn('[live-engine] update check failed: ' + e.message));
    const first = setTimeout(() => check(), checkAfterMs);
    const every = setInterval(() => check(), checkEveryMs);
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

module.exports = { setupLiveEngine, channelFor, fetchBytes, pickFetch };
