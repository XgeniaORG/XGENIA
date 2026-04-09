// Import for side effects (sets window.XgeniaViewerReact) and named export
import './xgenia-viewer-react';
import { ssrSetupRuntime } from './xgenia-viewer-react';

// Re-export the named export
export { ssrSetupRuntime };

// Assign functions to globalThis, ensuring XgeniaViewerReact exists on window
if (typeof window !== 'undefined' && window.XgeniaViewerReact) {
  globalThis.XgeniaSSR = { 
    createElement: window.XgeniaViewerReact.createElement,
    ssrSetupRuntime 
  };
} else if (typeof globalThis !== 'undefined') {
  // Fallback for non-window environments, might need adjustment
  // This assumes XgeniaViewerReact might be available differently in SSR context
  // If XgeniaViewerReact relies strictly on window, this part might fail.
  // We need to check if xgenia-viewer-react.js sets up a global in SSR correctly.
  console.warn('[index.ssr.js] window not found. Attempting to find XgeniaViewerReact globally for SSR.');
  // A safer approach might be needed here depending on how xgenia-viewer-react handles SSR contexts
  const globalNVR = globalThis.XgeniaViewerReact || (typeof XgeniaViewerReact !== 'undefined' ? XgeniaViewerReact : undefined);
  if (globalNVR) {
    globalThis.XgeniaSSR = { 
      createElement: globalNVR.createElement, 
      ssrSetupRuntime 
    };
  } else {
     console.error('[index.ssr.js] XgeniaViewerReact not found in global scope for SSR setup.');
     globalThis.XgeniaSSR = { ssrSetupRuntime }; // Assign partial if creation fails
  }
}
