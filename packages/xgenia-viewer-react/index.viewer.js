// ─── RECORD EVERY LOG FROM BOOT, PRINT WHAT PRODUCTION SHOULD PRINT ─────────────────
// (2026-08-15, user: "in order for the console to show errors I need to keep it open,
// as when I open it it's empty")
//
// Two separate things were wrong, and only one of them was DevTools.
//
//  1. DevTools shows nothing that happened before you opened it. Nothing can change that
//     — but a ring buffer we own can hold the history, so opening the console late (or
//     taking a debug export hours later) still gets it.
//
//  2. This block used to replace console.log/debug/info with empty functions in
//     production, and the viewer bundle the editor loads IS the production build. So 359
//     console.log call sites across the engine never ran AT ALL — not late, not ever,
//     not even with DevTools open from the first frame. Every "[PixiStage Node …]" and
//     "[PixiReelController] …" progress line was dead code in the editor, and the reason
//     debug exports have always shipped `consoleLogs.viewer: []`.
//
// Capturing has to happen HERE, before anything else in the bundle, and it has to wrap
// rather than replace: silence the noisy levels on SCREEN, but keep them in the buffer.
// That is what makes a post-mortem possible without putting 359 log lines back in front
// of the user.
//
// The buffer shape is the existing contract — window.XgeniaRuntimeLogs of
// {type, message, timestamp} — so ChatPanel's readViewerConsoleLogs and every debug
// export pick it up with no change. XgeniaLogCaptureInitialized tells that code its own
// late-installed hook is unnecessary, which is what closes the "entries logged before
// the first install are lost" gap its comments already admitted to.
(function () {
  if (typeof window === 'undefined' || window.XgeniaLogCaptureInitialized) return;
  window.XgeniaLogCaptureInitialized = true;

  var MAX_ENTRIES = 2000;
  var buffer = (window.XgeniaRuntimeLogs = window.XgeniaRuntimeLogs || []);
  var original = {
    log: console.log, debug: console.debug, info: console.info,
    warn: console.warn, error: console.error
  };
  // Quiet levels still record; they just do not reach the screen in a production build.
  var quiet = process.env.NODE_ENV === 'production';

  function render(a) {
    try {
      if (a instanceof Error) return a.name + ': ' + a.message + (a.stack ? '\n' + a.stack : '');
      if (typeof a === 'object' && a !== null) return JSON.stringify(a);
      return String(a);
    } catch (e) { return '[unserialisable]'; }
  }

  function capture(type, args, print) {
    try {
      buffer.push({
        type: type,
        message: Array.prototype.map.call(args, render).join(' ').slice(0, 4000),
        timestamp: new Date().toISOString()
      });
      if (buffer.length > MAX_ENTRIES) buffer.shift();
    } catch (e) { /* never let logging break the frame */ }
    if (print && original[type]) original[type].apply(console, args);
  }

  console.log = function () { capture('log', arguments, !quiet); };
  console.debug = function () { capture('debug', arguments, !quiet); };
  console.info = function () { capture('info', arguments, !quiet); };
  // Warnings and errors always print — they did before this change too.
  console.warn = function () { capture('warn', arguments, true); };
  console.error = function () { capture('error', arguments, true); };

  // Typed into DevTools at any point, this returns everything since boot — including the
  // levels that never printed. The whole point is that you do not have to have been
  // watching.
  window.XgeniaDumpLogs = function (filter) {
    var out = filter
      ? buffer.filter(function (e) { return e.type === filter || e.message.indexOf(filter) !== -1; })
      : buffer.slice();
    return out.map(function (e) { return e.timestamp + '  [' + e.type + '] ' + e.message; }).join('\n');
  };
})();

// CRITICAL: Initialize XGENIA object IMMEDIATELY to prevent ReferenceError
// This must be the very first code that runs in the bundle
(function () {
  if (typeof window !== "undefined" && !window.XGENIA) {
    window.XGENIA = {
      deployed: false,
      Events: { emit: function () { } }, // Minimal Events object to prevent errors
      _viewerReact: null
    };
  }
})();

// Import for side effects only (runs the script, sets window.XgeniaViewerReact)
import './xgenia-viewer-react';

// Conditionally import pro-nodes if available (webpack will bundle them)
// This ensures pro-nodes are included in the build
import './src/load-agent-nodes';
import './src/load-pro-nodes';

window.ELECTRON_DISABLE_SECURITY_WARNINGS = true;

// Assign the globally available object
if (window.XgeniaViewerReact) {
  window.XGENIA._viewerReact = window.XgeniaViewerReact;
}
