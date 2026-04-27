// Main render function
function render(domElement, modules, options = {}) {
  console.log('[xgenia-viewer-react.js] render function called.');
  
  // Check if React is globally available and ready
  if (typeof window === 'undefined' || !window.React || !window.ReactDOM || !window.__REACT_READY) {
    console.error('React or ReactDOM not ready or not found on window. Aborting render.');
    domElement.innerHTML = '<div style="color:red; padding:20px;">Error: React environment not properly initialized.</div>';
    return;
  } else {
    console.log('[xgenia-viewer-react.js] React is ready (flag detected)');
  }

  // Log the modules received right at the start of the render function
  console.log('[xgenia-viewer-react.js] Modules received in render function:', modules);
  console.log('[xgenia-viewer-react.js] window.__xgenia_modules at render start:', window.__xgenia_modules);


  // Check if createRoot exists and use it (React 18+)
  if (typeof window.ReactDOM.createRoot === 'function') {
    console.log(`[xgenia-viewer-react.js] Rendering viewer with React ${window.React.version}`);
    // ... existing code ...
  }
} 