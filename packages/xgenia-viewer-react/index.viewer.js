// MUST BE THE FIRST IMPORT. ES imports are hoisted, so the only way to install the
// console capture before any other module's silencer is to import it first — a
// top-level IIFE here would run AFTER every import in this file. See console-capture.js.
import './console-capture';

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
