// Which engine this start runs — decided once, before the window opens, from disk only (never the
// network). The web server, export and the Maths panel all read the answer, so the preview,
// exported games and compiled maths always come from the same engine. (2026-10-03)
'use strict';
const fs = require('fs');
const path = require('path');

function selectEngine({ appPath, isPackaged, env, store, publicKeyPem, shellApi, appVersion }) {
  const builtinRoot = path.join(appPath, 'src/external');
  const builtin = (reason, allowUpdates) => ({ root: builtinRoot, builtinRoot, version: 'builtin', source: 'builtin', reason, allowUpdates, trial: false });
  if (env.XGENIA_ENGINE === 'builtin') return builtin('forced by XGENIA_ENGINE=builtin', false);
  if (!isPackaged && env.XGENIA_LIVE_ENGINE !== '1') return builtin('development build', false);

  const state = store.readState();
  // The last start put a new engine on trial and its preview timed out, or the app died before the
  // preview came up: treat it as broken and go back to the last engine that proved itself.
  if (state.trial && state.trial === state.active && (!state.cleanExit || state.trialTimedOut === state.trial)) {
    state.bad = [...new Set([...state.bad, state.trial])];
    state.active = state.previous;
    state.previous = null;
    state.trial = null;
    state.trialTimedOut = null;
  }
  state.cleanExit = false;

  // A new app build ships the newest engine itself (nightly builds carry the latest private/), so an
  // engine downloaded under the old build is older than the one now built in: start from the app's.
  // (2026-10-06)
  if (appVersion && state.appVersion !== appVersion) {
    state.active = null;
    state.previous = null;
    state.pending = null;
    state.trial = null;
    state.trialTimedOut = null;
    state.appVersion = appVersion;
  }

  const usable = (v) => {
    if (!v || state.bad.includes(v)) return null;
    const m = store.readInstalledManifest(v, publicKeyPem);
    // Built for exactly this app shell: an engine for a newer shell cannot run here, and one for an
    // older shell is older than the engine this app ships with.
    return m && m.minShell === shellApi && store.isComplete(m) ? m : null;
  };

  let chosen = usable(state.pending);
  if (chosen) {
    if (state.active !== chosen.version) {
      // Only an engine that proved itself becomes the way back; an unproven one is just dropped.
      if (!state.trial) state.previous = state.active;
      state.active = chosen.version;
      state.trial = chosen.version;
      state.trialTimedOut = null;
    }
  } else {
    chosen = usable(state.active);
    if (!chosen) {
      state.active = null;
      state.trial = null;
    }
  }
  state.pending = null;
  store.writeState(state);

  if (!chosen) return builtin('no verified live engine installed', true);
  // Size and mtime of every file just hash-checked: whoever reads an engine file later (the preview
  // server, export, the compiler loader) can tell it is still the file that was verified.
  const files = {};
  for (const f of chosen.files) {
    try {
      const st = fs.statSync(path.join(store.versionDir(chosen.version), f.path));
      files[f.path] = { size: st.size, mtimeMs: st.mtimeMs };
    } catch {
      /* isComplete just read it; a file gone since is caught when it is used */
    }
  }
  return {
    root: store.versionDir(chosen.version),
    builtinRoot,
    version: chosen.version,
    source: 'live',
    reason: state.trial === chosen.version ? 'on trial' : 'live',
    allowUpdates: true,
    trial: state.trial === chosen.version,
    files
  };
}

/** The preview came up on this engine: it is no longer on trial. */
function markHealthy(store, version) {
  const s = store.readState();
  if (s.trial !== version) return;
  s.trial = null;
  s.trialTimedOut = null;
  store.writeState(s);
  store.prune([s.active, s.previous, s.pending].filter(Boolean));
}

/** This engine failed here: never pick it again; the next start runs the one before it. */
function markBad(store, version) {
  const s = store.readState();
  s.bad = [...new Set([...s.bad, version])];
  if (s.active === version) {
    s.active = s.previous;
    s.previous = null;
    s.trial = null;
  }
  if (s.pending === version) s.pending = null;
  store.writeState(s);
}

/** This run's trial engine never reported in: the next start drops it unless it reports in first. */
function markTrialTimedOut(store, version) {
  const s = store.readState();
  if (s.trial !== version) return;
  s.trialTimedOut = version;
  store.writeState(s);
}

function markCleanExit(store) {
  const s = store.readState();
  s.cleanExit = true;
  store.writeState(s);
}

module.exports = { selectEngine, markHealthy, markBad, markTrialTimedOut, markCleanExit };
