// Which engine this start runs — decided once, before the window opens, from disk only (never the
// network). The web server, export and the Maths panel all read the answer, so the preview,
// exported games and compiled maths always come from the same engine. (2026-10-03)
'use strict';
const path = require('path');

function selectEngine({ appPath, isPackaged, env, store, publicKeyPem, shellApi }) {
  const builtinRoot = path.join(appPath, 'src/external');
  const builtin = (reason, allowUpdates) => ({ root: builtinRoot, builtinRoot, version: 'builtin', source: 'builtin', reason, allowUpdates });
  if (env.XGENIA_ENGINE === 'builtin') return builtin('forced by XGENIA_ENGINE=builtin', false);
  if (!isPackaged && env.XGENIA_LIVE_ENGINE !== '1') return builtin('development build', false);

  const state = store.readState();
  // The last start put a new engine on trial and then neither saw the preview come up on it nor
  // quit cleanly: treat it as broken and go back to what ran before.
  if (state.trial && state.trial === state.active && !state.cleanExit) {
    state.bad = [...new Set([...state.bad, state.trial])];
    state.active = state.previous;
    state.previous = null;
    state.trial = null;
  }
  state.cleanExit = false;

  const usable = (v) => {
    if (!v || state.bad.includes(v)) return null;
    const m = store.readInstalledManifest(v, publicKeyPem);
    return m && m.minShell <= shellApi && store.isComplete(m) ? m : null;
  };

  let chosen = usable(state.pending);
  if (chosen) {
    if (state.active !== chosen.version) {
      state.previous = state.active;
      state.active = chosen.version;
      state.trial = chosen.version;
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
  return {
    root: store.versionDir(chosen.version),
    builtinRoot,
    version: chosen.version,
    source: 'live',
    reason: state.trial === chosen.version ? 'first run of this engine' : 'live',
    allowUpdates: true
  };
}

/** The preview came up on this engine: it is no longer on trial. */
function markHealthy(store, version) {
  const s = store.readState();
  if (s.trial !== version) return;
  s.trial = null;
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

function markCleanExit(store) {
  const s = store.readState();
  s.cleanExit = true;
  store.writeState(s);
}

module.exports = { selectEngine, markHealthy, markBad, markCleanExit };
