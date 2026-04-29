import React from 'react';

import { NoHomeError } from './components/common/NoHomeError';
import GraphWarnings from './graph-warnings';
import { Highlighter } from './highlighter';
import Inspector from './inspector';
import XgeniaJSAPI from './xgenia-js-api';
import projectSettings from './project-settings';
import { createNodeFromReactComponent } from './react-component-node';
import registerNodes from './register-nodes';
import Styles from './styles';

// --->>> ADDED: Error Boundary Component <<<---
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI.
    console.log('[ViewerErrorBoundary] getDerivedStateFromError caught:', error);
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    // Log the error to an error reporting service or console
    console.error("[ViewerErrorBoundary] Uncaught error:", error, errorInfo);
    this.setState({ error, errorInfo });
  }

  render() {
    if (this.state.hasError) {
      // Render custom fallback UI
      return (
        <div style={{ padding: '20px', color: 'red', border: '2px solid red', backgroundColor: '#fee', height: '100vh', overflow: 'auto' }}>
          <h2>Something went wrong rendering the XGENIA view.</h2>
          <p>Check the console (both editor and webview) for details.</p>
          <details style={{ whiteSpace: 'pre-wrap', marginTop: '10px' }}>
            <summary>Error Details</summary>
            <pre>
              {this.state.error && this.state.error.toString()}
              {"\n"}
              {this.state.errorInfo && this.state.errorInfo.componentStack}
            </pre>
          </details>
        </div>
      );
    }

    return this.props.children;
  }
}

// Add icon stylesheet loading utility
function loadIconStylesheets(xgeniaModules) {
  if (typeof document === 'undefined') return; // Skip during SSR

  console.log('[Icon Loader] Loading icon stylesheets for modules:', xgeniaModules?.length || 0);

  xgeniaModules?.forEach((module) => {
    if (module.manifest?.type === 'iconset' || module.type === 'iconset') {
      const manifest = module.manifest || module;
      console.log('[Icon Loader] Processing iconset module:', manifest.name);

      // Check if stylesheets are already loaded
      const moduleId = manifest.name?.replace(/\s+/g, '-').toLowerCase();
      const existingStylesheet = document.querySelector(`#xgenia-iconset-${moduleId}`);

      if (!existingStylesheet && manifest.browser?.stylesheets) {
        console.log('[Icon Loader] Loading stylesheets for:', manifest.name);

        manifest.browser.stylesheets.forEach((sheet, idx) => {
          if (typeof sheet === 'string') {
            const link = document.createElement('link');
            link.id = `xgenia-iconset-${moduleId}-${idx}`;
            link.rel = 'stylesheet';
            link.href = sheet;
            link.crossOrigin = 'anonymous';

            console.log('[Icon Loader] Adding stylesheet:', sheet);
            document.head.appendChild(link);

            // Listen for load/error events
            link.onload = () => console.log('[Icon Loader] Successfully loaded:', sheet);
            link.onerror = () => console.error('[Icon Loader] Failed to load:', sheet);
          }
        });
      } else if (existingStylesheet) {
        console.log('[Icon Loader] Stylesheets already loaded for:', manifest.name);
      } else {
        console.log('[Icon Loader] No stylesheets found for:', manifest.name);
      }
    }
  });
}

export function ssrSetupRuntime(xgeniaRuntime, xgeniaModules, projectData) {
  registerNodes(xgeniaRuntime);

  // XGENIA static API
  XgeniaJSAPI(xgeniaRuntime);

  xgeniaRuntime.setProjectSettings(projectSettings);

  // Load icon stylesheets for modules
  loadIconStylesheets(xgeniaModules);

  // Register module nodes
  if (xgeniaModules) {
    for (const module of xgeniaModules) {
      if (module.reactNodes) {
        const reactNodes = [];
        for (const nodeDefinition of module.reactNodes) {
          reactNodes.push(createNodeFromReactComponent(nodeDefinition));
        }
        const nodes = module.nodes || [];
        module.nodes = nodes.concat(reactNodes);
      }
      xgeniaRuntime.registerModule(module);
    }
  }

  const styles = new Styles({
    graphModel: xgeniaRuntime.graphModel,
    getNodeScope: () => xgeniaRuntime.context.rootComponent && xgeniaRuntime.context.rootComponent.nodeScope,
    nodeRegister: xgeniaRuntime.context.nodeRegister
  });

  //make the styles available to all nodes via `this.context.styles`
  xgeniaRuntime.context.styles = styles;

  console.log('Project Data:', projectData);

  xgeniaRuntime.setData(projectData);
  xgeniaRuntime._disableLoad = true;
}

export default class Viewer extends React.Component {
  constructor(props) {
    super(props);

    this.state = {
      popups: []
    };

    const { xgeniaRuntime } = props;
    this.runningDeployed = this.props.projectData !== undefined;
    this.focusedXgeniaNodes = [];

    xgeniaRuntime.context.setNodeFocused = this.setNodeFocused.bind(this);

    const enableDebugInspectors =
      (typeof document !== 'undefined' && document.location.href.indexOf('forceDebugger=true') !== -1) ||
      XGENIA.enableDebugInspectors;
    xgeniaRuntime.setDebugInspectorsEnabled(enableDebugInspectors);

    xgeniaRuntime.context.setPopupCallbacks({
      onShow: (popup) => {
        const newPopupArray = this.state.popups.concat([popup]);

        const bodyScroll = xgeniaRuntime.getProjectSettings().bodyScroll;

        //Disable body scroll when showing a popup
        if (bodyScroll && newPopupArray.length === 1) {
          document.body.style.width = document.body.clientWidth + 'px';
          document.body.style.top = `-${window.scrollY}px`;
          document.body.style.position = 'fixed';
        }

        this.setState({
          popups: newPopupArray
        });
      },
      onClose: (popup) => {
        const newPopupArray = this.state.popups.filter((p) => p !== popup);

        this.setState({
          popups: newPopupArray
        });

        const bodyScroll = xgeniaRuntime.getProjectSettings().bodyScroll;

        //Enable body scroll when hiding all popups
        if (bodyScroll && newPopupArray.length === 0) {
          const scrollY = document.body.style.top;
          document.body.style.position = '';
          document.body.style.top = '';
          document.body.style.width = '100%';
          window.scrollTo(0, parseInt(scrollY || '0') * -1);
        }
      }
    });

    registerNodes(xgeniaRuntime);

    // XGENIA static API
    XgeniaJSAPI(xgeniaRuntime);

    xgeniaRuntime.setProjectSettings(projectSettings);

    // Register module nodes
    if (this.props.xgeniaModules) {
      for (const module of this.props.xgeniaModules) {
        if (module.reactNodes) {
          const reactNodes = [];
          for (const nodeDefinition of module.reactNodes) {
            reactNodes.push(createNodeFromReactComponent(nodeDefinition));
          }
          const nodes = module.nodes || [];
          module.nodes = nodes.concat(reactNodes);
        }
        xgeniaRuntime.registerModule(module);
      }
    }

    xgeniaRuntime.eventEmitter.on('rootComponentUpdated', () => {
      //wait until next frame to trigger a react update, so inputs etc have a chance to settle
      //(forceUpdate is synchronous)
      requestAnimationFrame(() => this.forceUpdate());
    });

    xgeniaRuntime.graphModel.on('projectSettingsChanged', (settings) => {
      // Suppport SSR
      if (typeof document === 'undefined') return;

      if (settings.bodyScroll) {
        document.body.classList.add('body-scroll');
      } else {
        document.body.classList.remove('body-scroll');
      }
    });

    this.styles = new Styles({
      graphModel: xgeniaRuntime.graphModel,
      getNodeScope: () => xgeniaRuntime.context.rootComponent && xgeniaRuntime.context.rootComponent.nodeScope,
      nodeRegister: xgeniaRuntime.context.nodeRegister
    });

    //make the styles available to all nodes via `this.context.styles`
    xgeniaRuntime.context.styles = this.styles;

    this.state.waitingForExport = !this.runningDeployed;

    if (this.runningDeployed) {
      this.props.xgeniaRuntime.setData(this.props.projectData);

      //start pre-fetching the rest of the bundles after a while, if there arent too many of them
      const componentIndex = this.props.projectData.componentIndex || {};
      const allBundles = Object.keys(componentIndex);

      if (allBundles.length < 30) {
        setTimeout(() => {
          this.props.xgeniaRuntime.prefetchBundles(allBundles, 3);
        }, 10000);
      }
    } else {
      xgeniaRuntime.graphModel.on('editorImportComplete', () => {
        this.setState({ waitingForExport: false });
      });
      this.connectToEditor();
    }

    this.focusedXgeniaNodes = [];

    // --->>> ADDED: Set up editor API response handler if available <<<---
    if (typeof window !== 'undefined' && window.XgeniaEditorAPI && typeof window.XgeniaEditorAPI.setResponseHandler === 'function') {
      console.log('[Viewer] Setting up editor API response handler.');
      window.XgeniaEditorAPI.setResponseHandler((args) => {
        console.log('[Viewer] Received API response:', args);
        // TODO: Add logic to handle responses if needed (e.g., update state based on response)
        // Example: Find pending request by args.token and resolve/reject a promise
      });
    } else {
      // This might happen in deployed mode or if preload fails
      console.warn('[Viewer] XgeniaEditorAPI.setResponseHandler not available.');
    }
  }

  connectToEditor() {
    const { xgeniaRuntime } = this.props;

    // Remove hash if it is in location href
    var href =
      (XGENIA.host || location.protocol + '//' + location.host) +
      location.pathname +
      (location.search ? location.search : '');

    const address = href.replace('http', 'ws');
    xgeniaRuntime.connectToEditor(address);

    this.highlightedNodes = new Map();
    this.isUpdatingHighlights = false;

    // --->>> MODIFIED: Use APIs exposed by preload.js <<<---
    if (typeof window !== 'undefined' && window.XgeniaEditorHighlightAPI && window.XgeniaEditorInspectorAPI) {
      this._internalHighlighter = new Highlighter(xgeniaRuntime); // Keep internal instance

      // Use preload API to select/highlight nodes
      xgeniaRuntime.editorConnection.on('hoverStart', (id) => {
        this._internalHighlighter.highlightNodesWithId(id); // Update internal state/visuals
        // Note: Preload API doesn't have a direct hover equivalent, selection might be used instead
        // window.XgeniaEditorHighlightAPI.selectNode(id); // Uncomment if selection is desired on hover
      });
      xgeniaRuntime.editorConnection.on('hoverEnd', (id) => {
        this._internalHighlighter.disableHighlight();
        // window.XgeniaEditorHighlightAPI.selectNode(null); // Uncomment to deselect on hover end
      });

      // Create inspector logic, but use preload API to enable/disable
      this._internalInspector = new Inspector({
        onDisableHighlight: () => this._internalHighlighter.disableHighlight(),
        onHighlight: (id) => this._internalHighlighter.highlightNodesWithId(id),
        onInspect: (ids, positionInfo) => {
          // Use the API exposed by preload.js to send inspect request to editor
          if (window.XgeniaEditorAPI && typeof window.XgeniaEditorAPI.inspectNodes === 'function') {
            console.log(`[Viewer] 📤 Sending inspectNodes request for: ${ids}`, positionInfo);
            const requestData = {
              nodeIds: ids,
              ...(positionInfo || {}) // Include clickX, clickY, elementRect, nodeLabel if provided
            };
            console.log(`[Viewer] 📤 Request data:`, requestData);
            window.XgeniaEditorAPI.inspectNodes(requestData);
          } else {
            console.warn('[Viewer] ❌ Cannot send inspectNodes request, XgeniaEditorAPI.inspectNodes not found.');
          }
        }
      });

      // Expose the real inspector and highlight functions to the window
      // Override the default handlers created by the preload script
      window.setInspectorEnabled = (enabled) => {
        console.log('[Viewer] Inspector enabled:', enabled);
        if (enabled) {
          this._internalInspector.enable();
        } else {
          this._internalInspector.disable();
        }
      };

      window.highlightNode = (nodeId) => {
        console.log('[Viewer] Highlighting node:', nodeId);
        if (nodeId) {
          this._internalHighlighter.highlightNodesWithId(nodeId);
        } else {
          this._internalHighlighter.disableHighlight();
        }
      };

      console.log('[Viewer] Highlighter and Inspector logic initialized, exposed real functions to window.');

    } else {
      console.warn('[Viewer] XgeniaEditorHighlightAPI or XgeniaEditorInspectorAPI not available.');
    }

    xgeniaRuntime.editorConnection.on('debuggingEnabledChanged', (enabled) => {
      xgeniaRuntime.setDebugInspectorsEnabled(enabled);
    });

    this.graphWarnings = new GraphWarnings(xgeniaRuntime.graphModel, xgeniaRuntime.editorConnection);
  }

  setNodeFocused(node, focused) {
    if (focused && this.focusedXgeniaNodes.indexOf(node) === -1) {
      //blur nodes that don't contain this new node
      this.focusedXgeniaNodes
        .filter((focusedNode) => !focusedNode.contains(node))
        .forEach((blurredNode) => {
          blurredNode._blur();
        });

      node._focus();
      this.focusedXgeniaNodes.push(node);
    } else if (!focused) {
      const index = this.focusedXgeniaNodes.indexOf(node);
      if (index !== -1) {
        return;
      }

      node._blur();

      //also blur nodes that contain this node
      this.focusedXgeniaNodes
        .filter((focusedNode) => focusedNode.contains(node))
        .forEach((blurredNode) => {
          blurredNode._blur();
        });

      this.focusedXgeniaNodes.splice(index, 1);
    }
  }

  onClickCapture(e) {
    const focusedXgeniaNodes = [];

    //walk up the dom tree and collect all xgenia nodes
    let elem = e.target;
    while (elem) {
      if (elem.xgeniaNode && elem.xgeniaNode._focus) focusedXgeniaNodes.push(elem.xgeniaNode);
      elem = elem.parentNode;
    }

    //blur nodes that weren't part of this click
    this.focusedXgeniaNodes.filter((node) => focusedXgeniaNodes.indexOf(node) === -1).forEach((node) => node._blur());

    //focus all new focused nodes
    focusedXgeniaNodes.filter((node) => this.focusedXgeniaNodes.indexOf(node) === -1).forEach((node) => node._focus());

    this.focusedXgeniaNodes = focusedXgeniaNodes;
  }

  render() {
    const rootComponent = this.props.xgeniaRuntime.rootComponent;
    if (this.state.waitingForExport) return null;

    if (!rootComponent) {
      if (this.runningDeployed) {
        return null;
      } else {
        return NoHomeError();
      }
    }

    // Ensure styles are applied properly
    const bodyScroll = this.props.xgeniaRuntime.getProjectSettings().bodyScroll;

    if (bodyScroll) {
      const style = {
        margin: 0,
        padding: 0,
        minHeight: '100vh',
        alignSelf: 'stretch',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#ffffff' // Explicitly set background color
      };
      return (
        <div style={style} onClickCapture={(e) => this.onClickCapture(e)}>
          {/* Wrap main content and popups in ErrorBoundary */}
          <ErrorBoundary>
            <div style={{ ...style, isolation: 'isolate' }}>{rootComponent.render()}</div>
            {this.state.popups.length ? (
              <div style={{ ...style, isolation: 'isolate' }}>{this.state.popups.map((p, index) => <React.Fragment key={index}>{p.render()}</React.Fragment>)}</div>
            ) : null}
          </ErrorBoundary>
        </div>
      );
    } else {
      return (
        <div
          style={{
            margin: 0,
            padding: 0,
            overflow: 'hidden',
            width: '100%',
            height: '100%',
            backgroundColor: '#ffffff' // Explicitly set background color
          }}
          onClickCapture={(e) => this.onClickCapture(e)}
        >
          {/* Wrap main content and popups in ErrorBoundary */}
          <ErrorBoundary>
            {rootComponent.render()}
            {this.state.popups.map((p, index) => <React.Fragment key={index}>{p.render()}</React.Fragment>)}
          </ErrorBoundary>
        </div>
      );
    }
  }
}
