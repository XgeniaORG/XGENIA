// Disable console.log in production - must be first!
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'production') {
  console.log = () => {};
  console.debug = () => {};
  console.info = () => {};
  // Keep console.warn and console.error for important messages
}

import React from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
// Updated import for React 19
import XgeniaRuntime from '@xgenia/runtime';

import registerPolyfills from './src/polyfills';
import registerNodes from './src/register-nodes';
import Viewer, { ssrSetupRuntime } from './src/viewer.jsx';

registerPolyfills();

// Expose React and ReactDOM to global scope for debugging
if (typeof window !== 'undefined') {
  // Don't override window.React/ReactDOM if they already exist (from HTML script)
  if (!window.React) window.React = React;
  if (!window.ReactDOM) window.ReactDOM = { createRoot, hydrateRoot };
  console.log('React and ReactDOM exposed to global scope', (window.React && window.React.version) || React.version);
}

function createArgs() {
  // Support SSR
  if (typeof window === 'undefined') {
    return {
      type: 'browser',
      platform: {
        requestUpdate: (callback) =>
          typeof setImmediate !== 'undefined' ? setImmediate(callback) : setTimeout(callback, 0),
        getCurrentTime: () => 0,
        objectToString: (o) => JSON.stringify(o, null, 2)
      },
      componentFilter: (c) => !c.name.startsWith('/#__cloud__/')
    };
  }

  return {
    type: 'browser',
    platform: {
      requestUpdate: (callback) => window.requestAnimationFrame(callback),
      getCurrentTime: () => window.performance.now(),
      objectToString: (o) => JSON.stringify(o, null, 2)
    },
    componentFilter: (c) => !c.name.startsWith('/#__cloud__/')
  };
}

export { ssrSetupRuntime };

// Helper to ensure React is ready
function ensureReactReady(callback) {
  if (typeof window === 'undefined') {
    callback(true); // SSR context, no window
    return;
  }

  // If the window flag is set, React is already initialized
  if (window.__REACT_READY) {
    console.log('React is ready (flag detected)');
    callback(true);
    return;
  }

  // Check for proper ReactDOM setup
  if (
    window.React &&
    window.ReactDOM &&
    typeof window.ReactDOM.createRoot === 'function' &&
    typeof window.ReactDOM.hydrateRoot === 'function'
  ) {
    console.log('React is ready (APIs detected)');
    callback(true);
    return;
  }

  // Wait a moment for scripts to initialize
  console.log('Waiting for React to initialize...');
  setTimeout(() => {
    if (
      window.React &&
      window.ReactDOM &&
      typeof window.ReactDOM.createRoot === 'function' &&
      typeof window.ReactDOM.hydrateRoot === 'function'
    ) {
      console.log('React ready after delay');
      callback(true);
    } else {
      console.error('React initialization timeout - APIs still missing');
      console.log('window.React:', typeof window.React);
      console.log('window.ReactDOM:', typeof window.ReactDOM);
      if (window.ReactDOM) {
        console.log('window.ReactDOM keys:', Object.keys(window.ReactDOM));
      }
      callback(false);
    }
  }, 500); // 500ms delay
}

// Define the main object directly
const viewerReactAPI = {
  _root: null,
  _deployedRoot: null,

  render(element, xgeniaModules, { isLocal = false }) {
    ensureReactReady((reactReady) => {
      if (!reactReady) {
        console.error('React or ReactDOM client APIs not defined. Make sure React is loaded before calling render.');
        element.innerHTML = `
          <div style="padding: 20px; color: red; font-family: Arial, sans-serif;">
            <h2>Error Rendering Application</h2>
            <pre>React or ReactDOM client APIs not defined</pre>
            <p>Make sure React is loaded before calling render.</p>
          </div>
        `;
        return;
      }

      const runtimeArgs = createArgs();

      if (isLocal) {
        runtimeArgs.platform.isRunningLocally = () => true;
      }

      console.log('Rendering viewer with React', (window.React && window.React.version) || 'unknown version');

      try {
        // Clean up any existing root
        if (this._root) {
          try {
            this._root.unmount();
          } catch (e) {
            console.warn('Error unmounting previous root:', e);
          }
          this._root = null;
        }

        const runtime = new XgeniaRuntime(runtimeArgs);
        
        // Store runtime globally for access by nodes like LoaderNode
        if (typeof window !== 'undefined') {
          window.XGENIA = window.XGENIA || {};
          window.XGENIA._runtime = runtime;
        }

        // Log what we're trying to render
        console.log('Rendering element to', element);

        // Use createRoot from window.ReactDOM for rendering in React 19
        this._root = window.ReactDOM.createRoot(element);
        this._root.render(window.React.createElement(Viewer, { xgeniaRuntime: runtime, xgeniaModules }));

        console.log('Render complete');
      } catch (e) {
        // Show a visible error message in the DOM
        console.error('Error rendering viewer:', e);
        element.innerHTML = `
          <div style="padding: 20px; color: red; font-family: Arial, sans-serif;">
            <h2>Error Rendering Application</h2>
            <pre>${e.message || 'Unknown error'}</pre>
            <p>Check the console for more details.</p>
          </div>
        `;
      }
    });
  },

  renderDeployed(element, xgeniaModules, projectData) {
    ensureReactReady((reactReady) => {
      if (!reactReady) {
        console.error('React or ReactDOM client APIs not defined for deployed app.');
        element.innerHTML = `
          <div style="padding: 20px; color: red; font-family: Arial, sans-serif;">
            <h2>Error Rendering Deployed Application</h2>
            <pre>React or ReactDOM client APIs not defined</pre>
          </div>
        `;
        return;
      }

      try {
        if (this._deployedRoot) {
          try {
            this._deployedRoot.unmount();
            this._deployedRoot = null;
          } catch (e) {
            console.warn('Error unmounting deployed root:', e);
          }
        }

        const runtime = new XgeniaRuntime({
          ...createArgs(),
          runDeployed: true
        });
        
        // Store runtime globally for access by nodes like LoaderNode
        if (typeof window !== 'undefined') {
          window.XGENIA = window.XGENIA || {};
          window.XGENIA._runtime = runtime;
        }

        // Register all node types including Router
        console.log('[renderDeployed] Registering all node types');
        registerNodes(runtime);

        // React SSR adds a 'data-reactroot' attribute on the root element to be able to hydrate the app.
        if (element.children.length > 0 && element.children[0].hasAttribute('data-reactroot')) {
          console.log('Using hydrateRoot for deployed app');
          this._deployedRoot = window.ReactDOM.hydrateRoot(
            element,
            window.React.createElement(Viewer, { xgeniaRuntime: runtime, xgeniaModules, projectData })
          );
        } else {
          console.log('Using createRoot for deployed app');
          this._deployedRoot = window.ReactDOM.createRoot(element);
          this._deployedRoot.render(
            window.React.createElement(Viewer, { xgeniaRuntime: runtime, xgeniaModules, projectData })
          );
        }
      } catch (e) {
        console.error('Error rendering deployed app:', e);
        element.innerHTML = `
          <div style="padding: 20px; color: red; font-family: Arial, sans-serif;">
            <h2>Error Rendering Application</h2>
            <pre>${e.message || 'Unknown error'}</pre>
            <p>Check the console for more details.</p>
          </div>
        `;
      }
    });
  },

  /** This can be called for server side rendering too. */
  createElement(xgeniaModules, projectData) {
    const runtime = new XgeniaRuntime({
      ...createArgs(),
      runDeployed: true
    });
    
    // Store runtime globally for access by nodes like LoaderNode
    if (typeof window !== 'undefined') {
      window.XGENIA = window.XGENIA || {};
      window.XGENIA._runtime = runtime;
    }

    // Register all node types including Router
    console.log('[createElement] Registering all node types');
    registerNodes(runtime);

    // Use React.createElement instead of JSX
    const ReactToUse = typeof window !== 'undefined' ? window.React : React;
    return ReactToUse.createElement(Viewer, { xgeniaRuntime: runtime, xgeniaModules, projectData });
  }
};

// Assign the object directly to the window
if (typeof window !== 'undefined') {
  window.XgeniaViewerReact = viewerReactAPI;
  console.log('[xgenia-viewer-react.js] Explicitly assigned API object to window.XgeniaViewerReact');
}
