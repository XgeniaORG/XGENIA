import React, { useEffect, useState } from 'react';
import XgeniaRuntime from '@xgenia/runtime';

import ASyncQueue from '../../async-queue';
import { LoaderScreen } from '../../components/visual/LoaderScreen';
import guid from '../../guid';
import { createNodeFromReactComponent } from '../../react-component-node';
import { XGENIA, Slot } from '../../types';
import { ComponentPageInfo, NavigateArgs, RouterHandler } from './router-handler';

// Define proper types for the node definition
interface RouterNodeContext {
  _internal: {
    asyncQueue: ASyncQueue;
    isMounted: boolean;
    name: string;
    pages?: any;
    urlPath?: string;
    hasScheduledReset: boolean;
    currentUrl?: string;
    currentPage?: ComponentPageInfo;
    currentParams?: Record<string, any>;
    currentPageComponent?: any;
    remainingNavigationPath?: string[];
    // Loading screen properties
    enableLoadingScreen: boolean;
    loadingProgress: number;
    isLoadingComplete: boolean;
    loadingText: string;
    showLoadingPercentage: boolean;
    maxRetries: number;
    maxConcurrent: number;
    hasStartedLoading: boolean;
    loadingLogoUrl: string;
    loadingCompleteDelay: number;
    loadingAutoHide: boolean;
    // Safety breaker for infinite loops
    lastResetTime: number;
    resetRetries: number;
  };
  id?: string;
  onScheduleReset: () => void;
  props: {
    didMount: () => void;
    willUnmount: () => void;
    layout: string;
    // Loading screen props
    enableLoadingScreen: boolean;
    loadingProgress: number;
    isLoadingComplete: boolean;
    loadingText: string;
    showLoadingPercentage: boolean;
    loadingLogoUrl: string;
    loadingCompleteDelay: number;
    loadingAutoHide: boolean;
    loaderVisible: boolean;
    onLoadingFadeOutComplete: () => void;
  };
  nodeScope: {
    createPrimitiveNode: (type: string) => any;
    createNode: (component: string, id: string) => Promise<any>;
    deleteNode: (node: any) => void;
    getNodesWithType: (type: string) => any[];
    componentOwner?: { name: string };
  };
  parent?: any;
  scheduleReset: () => void;
  reset: () => void;
  resetAsync: () => Promise<void>;
  matchPageFromUrl: () => any;
  _updatePageInputs: (nodeScope: any, params: any) => void;
  scrollToTop: () => void;
  createPageContainer: () => any;
  getRelativeURL: (targetPage: ComponentPageInfo, pageParams: NavigateArgs['params']) => any;
  _getLocationPath: () => string;
  _getSearchParams: () => Record<string, string>;
  getNavigationAbsoluteURL: (targetPage: ComponentPageInfo, pageParams: NavigateArgs['params']) => any;
  _getCompleteUrlToPage: (page: ComponentPageInfo, pageParams: NavigateArgs['params']) => string;
  navigateAsync: (args: NavigateArgs) => Promise<void>;
  _navigateInCurrentWindow: (newPage: ComponentPageInfo, args: NavigateArgs) => Promise<void>;
  _updateUrlWithTopPage: () => void;
  _registerRouter: () => void;
  _deregisterRouter: () => void;
  scheduleAfterInputsHaveUpdated: (callback: () => void) => void;
  getDOMElement: () => HTMLElement | null;
  flagOutputDirty: (name: string) => void;
  getChildren: () => any[];
  removeChild: (child: any) => void;
  addChild: (child: any) => void;
  setStyle: (styles: Record<string, any>) => void;
  removeStyle: (styles: string[]) => void;
  hasInput: (name: string) => boolean;
  sendSignalOnOutput: (name: string) => void;
  getVisualParentNode: () => any;
  forceUpdate: () => void;
  context: any;
  // Loading methods
  _startAssetLoading: () => void;
  _handleLoadingComplete: () => void;
  _handleLoadingFadeOutComplete: () => void;
}

interface RouterNodeDefinition {
  name: string;
  displayNodeName: string;
  category: string;
  docs: string;
  useVariants: boolean;
  connectionPanel: {
    groupPriority: string[];
  };
  initialize: (this: RouterNodeContext) => void;
  getInspectInfo: (this: RouterNodeContext) => any;
  defaultCss: Record<string, any>;
  getReactComponent: () => React.ComponentType<any>;
  inputs: Record<string, any>;
  inputCss: Record<string, any>;
  outputs: Record<string, any>;
  methods: Record<string, (this: RouterNodeContext, ...args: any[]) => any>;
}

export interface RouterReactComponentProps extends XGENIA.ReactProps {
  didMount: () => void;
  willUnmount: () => void;
  children: Slot;
  // Loading screen props
  enableLoadingScreen?: boolean;
  loadingProgress?: number;
  isLoadingComplete?: boolean;
  loadingText?: string;
  showLoadingPercentage?: boolean;
  loadingLogoUrl?: string;
  loadingCompleteDelay?: number;
  loadingAutoHide?: boolean;
  loaderVisible?: boolean;
  onLoadingFadeOutComplete?: () => void;
}

function RouterReactComponent(props: RouterReactComponentProps) {
  const {
    didMount,
    willUnmount,
    children,
    style,
    enableLoadingScreen,
    loadingProgress,
    isLoadingComplete,
    loadingText,
    showLoadingPercentage,
    loadingLogoUrl,
    loadingCompleteDelay,
    loadingAutoHide,
    loaderVisible,
    onLoadingFadeOutComplete
  } = props;

  const [showLoader, setShowLoader] = useState(enableLoadingScreen && loaderVisible);

  useEffect(() => {
    didMount();
    return () => {
      willUnmount();
    };
  }, []);

  // Update loader visibility when loading completes or is manually triggered
  useEffect(() => {
    if (enableLoadingScreen && loaderVisible) {
      setShowLoader(true);
    }
  }, [enableLoadingScreen, loaderVisible]);

  const handleFadeOutComplete = () => {
    setShowLoader(false);
    onLoadingFadeOutComplete?.();
  };

  return (
    <div className={props.className} style={style}>
      {/* Show loading screen if enabled and not complete */}
      {enableLoadingScreen && showLoader && (
        <LoaderScreen
          progress={loadingProgress || 0}
          isVisible={loaderVisible}
          loadingText={loadingText}
          showPercentage={showLoadingPercentage}
          customLogoUrl={loadingLogoUrl}
          completeDelay={loadingCompleteDelay || 0}
          autoHide={loadingAutoHide}
          onFadeOutComplete={handleFadeOutComplete}
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
        />
      )}
      {/* Always render children, they're just hidden behind the loader */}
      {children}
    </div>
  );
}

function _trimUrlPart(url: string): string {
  if (url[0] === '/') url = url.substring(1);
  if (url[url.length - 1] === '/') url = url.substring(0, url.length - 1);
  return url;
}

function getBaseUrlLength(url: string): number {
  // If the URL is a full URL, then we only want to get the pathname.
  // Otherwise we just return the url length which should be the pathname.
  if (!url.startsWith('/')) {
    try {
      // Lets say the baseUrl is:
      // "https://collar-zippy-overcome.sandbox.xgenia.app/my-folder"
      // Then we want to remove "/my-folder" from the substring
      return new URL(url).pathname.length;
    } catch {
      /* noop */
    }
  }

  return url.length;
}

const RouterNode: RouterNodeDefinition = {
  name: 'Router',
  displayNodeName: 'Page Router',
  category: 'Visuals',
  docs: 'https://docsapp.xgenia.com/nodes/navigation/page-router',
  useVariants: false,
  connectionPanel: {
    groupPriority: ['General', 'Loading Screen', 'Actions', 'Events', 'Mounted']
  },
  initialize: function (this: RouterNodeContext) {
    this._internal = {
      asyncQueue: new ASyncQueue(),
      isMounted: false,
      name: '',
      hasScheduledReset: false,
      // Loading screen defaults
      enableLoadingScreen: false,
      loadingProgress: 0,
      isLoadingComplete: false,
      loadingText: 'Loading assets...',
      showLoadingPercentage: true,
      maxRetries: 3,
      maxConcurrent: 6,
      hasStartedLoading: false,
      loadingLogoUrl: '', // Custom logo URL, empty = use default text
      loadingCompleteDelay: 0, // Delay in ms after loading completes before fade out
      loadingAutoHide: true, // Automatically hide when progress reaches 100%
      // Safety Breaker for Infinite Loops
      lastResetTime: 0,
      resetRetries: 0
    };

    // Initialize loading screen props
    this.props.enableLoadingScreen = false;
    this.props.loadingProgress = 0;
    this.props.isLoadingComplete = false;
    this.props.loadingText = 'Loading assets...';
    this.props.showLoadingPercentage = true;
    this.props.loadingLogoUrl = '';
    this.props.loadingCompleteDelay = 0;
    this.props.loadingAutoHide = true;
    this.props.loaderVisible = true;
    this.props.onLoadingFadeOutComplete = () => {
      this._handleLoadingFadeOutComplete();
    };

    this.onScheduleReset = () => {
      this.scheduleReset();
    };

    this.props.didMount = () => {
      this._internal.isMounted = true;

      // SSR Support
      if (typeof window !== 'undefined') {
        // Listen to push state events and update stack
        if (window.history && 'pushState' in window.history) {
          //this is event is manually sent on push, so covers both pop and push state
          window.addEventListener('popstate', this.onScheduleReset);
        } else {
          // Only hash support
          window.addEventListener('hashchange', this.onScheduleReset);
        }
      }

      this._registerRouter();

      // Start loading screen if enabled
      if (this._internal.enableLoadingScreen && !this._internal.hasStartedLoading) {
        this._startAssetLoading();
      }
    };

    this.props.willUnmount = () => {
      this._internal.isMounted = false;

      window.removeEventListener('popstate', this.onScheduleReset);
      window.removeEventListener('hashchange', this.onScheduleReset);

      this._deregisterRouter();
    };

    this.props.layout = 'column';
  },
  getInspectInfo(this: RouterNodeContext) {
    return this._internal.currentUrl;
  },
  defaultCss: {
    flex: '1 1',
    alignSelf: 'stretch',
    position: 'relative',
    display: 'flex',
    flexDirection: 'column'
  },
  getReactComponent() {
    return RouterReactComponent;
  },
  inputs: {
    name: {
      type: 'string',
      displayName: 'Name',
      group: 'General',
      set: function (this: RouterNodeContext, value: string) {
        this._deregisterRouter();
        this._internal.name = value;

        if (this._internal.isMounted) {
          this._registerRouter();
        }
      }
    },
    pages: {
      type: { name: 'themped overpages', allowEditOnly: true },
      displayName: 'Pages',
      group: 'Pages',
      set: function (this: RouterNodeContext, value: any) {
        this._internal.pages = value;
        if (this._internal.isMounted) {
          this.scheduleReset();
        }
      }
    },
    urlPath: {
      type: 'string',
      displayName: 'Url path',
      group: 'General',
      set: function (this: RouterNodeContext, value: string) {
        this._internal.urlPath = value;
      }
    },
    clip: {
      displayName: 'Clip Behavior',
      type: {
        name: 'enum',
        enums: [
          { value: 'contentHeight', label: 'Expand to content size' },
          { value: 'scroll', label: 'Scroll' },
          { value: 'clip', label: 'Clip content' }
        ]
      },
      group: 'Layout',
      default: 'contentHeight',
      set(this: RouterNodeContext, value: string) {
        switch (value) {
          case 'scroll':
            this.setStyle({ overflow: 'auto' });
            break;
          case 'clip':
            this.setStyle({ overflow: 'hidden' });
            break;
          default:
            this.removeStyle(['overflow']);
            break;
        }
      }
    },
    reset: {
      type: 'signal',
      displayName: 'Reset',
      group: 'Actions',
      valueChangedToTrue: function (this: RouterNodeContext) {
        this.scheduleReset();
      }
    },
    // Loading Screen inputs
    enableLoadingScreen: {
      type: 'boolean',
      displayName: 'Enable Loading Screen',
      group: 'Loading Screen',
      default: false,
      set: function (this: RouterNodeContext, value: boolean) {
        this._internal.enableLoadingScreen = value;
        this.props.enableLoadingScreen = value;

        // If enabling and already mounted, start loading
        if (value && this._internal.isMounted && !this._internal.hasStartedLoading) {
          this._startAssetLoading();
        }
        this.props.loaderVisible = true;
        this.forceUpdate();
      }
    },
    loadingText: {
      type: 'string',
      displayName: 'Loading Text',
      group: 'Loading Screen',
      default: 'Loading assets...',
      set: function (this: RouterNodeContext, value: string) {
        this._internal.loadingText = value || 'Loading assets...';
        this.props.loadingText = this._internal.loadingText;
        this.forceUpdate();
      }
    },
    showLoadingPercentage: {
      type: 'boolean',
      displayName: 'Show Percentage',
      group: 'Loading Screen',
      default: true,
      set: function (this: RouterNodeContext, value: boolean) {
        this._internal.showLoadingPercentage = value;
        this.props.showLoadingPercentage = value;
        this.forceUpdate();
      }
    },
    loadingMaxRetries: {
      type: 'number',
      displayName: 'Max Retries',
      group: 'Loading Screen',
      default: 3,
      set: function (this: RouterNodeContext, value: number) {
        this._internal.maxRetries = Math.max(1, Math.min(10, value || 3));
      }
    },
    loadingConcurrentLoads: {
      type: 'number',
      displayName: 'Concurrent Loads',
      group: 'Loading Screen',
      default: 6,
      set: function (this: RouterNodeContext, value: number) {
        this._internal.maxConcurrent = Math.max(1, Math.min(20, value || 6));
      }
    },
    loadingLogoUrl: {
      type: 'image',
      displayName: 'Custom Logo',
      group: 'Loading Screen',
      default: '',
      set: function (this: RouterNodeContext, value: string) {
        this._internal.loadingLogoUrl = value || '';
        this.props.loadingLogoUrl = this._internal.loadingLogoUrl;
        this.forceUpdate();
      }
    },
    loadingCompleteDelay: {
      type: 'number',
      displayName: 'Complete Delay (ms)',
      group: 'Loading Screen',
      default: 0,
      set: function (this: RouterNodeContext, value: number) {
        this._internal.loadingCompleteDelay = Math.max(0, value || 0);
        this.props.loadingCompleteDelay = this._internal.loadingCompleteDelay;
      }
    },
    loadingAutoHide: {
      type: 'boolean',
      displayName: 'Auto Hide at 100%',
      group: 'Loading Screen',
      default: true,
      set: function (this: RouterNodeContext, value: boolean) {
        this._internal.loadingAutoHide = value;
        this.props.loadingAutoHide = value;
        this.forceUpdate();
      }
    },
    showLoadingScreen: {
      type: 'signal',
      displayName: 'Show Loader',
      group: 'Actions',
      valueChangedToTrue: function (this: RouterNodeContext) {
        this.props.loaderVisible = true;
        this.forceUpdate();
      }
    },
    hideLoadingScreen: {
      type: 'signal',
      displayName: 'Hide Loader',
      group: 'Actions',
      valueChangedToTrue: function (this: RouterNodeContext) {
        this.props.loaderVisible = false;
        this.forceUpdate();
      }
    }
  },
  inputCss: {
    backgroundColor: {
      type: 'color',
      displayName: 'Background Color',
      group: 'Style',
      default: 'transparent',
      applyDefault: false
    }
  },
  outputs: {
    currentPageTitle: {
      type: 'string',
      group: 'General',
      displayName: 'Current Page Title',
      getter: function (this: RouterNodeContext) {
        return this._internal.currentPage !== undefined ? this._internal.currentPage.title : undefined;
      }
    },
    currentPageComponent: {
      type: 'string',
      group: 'General',
      displayName: 'Current Page Component',
      getter: function (this: RouterNodeContext) {
        return this._internal.currentPage !== undefined ? this._internal.currentPage.component : undefined;
      }
    },
    // Loading Screen outputs
    loadingProgress: {
      type: 'number',
      group: 'Loading Screen',
      displayName: 'Loading Progress',
      getter: function (this: RouterNodeContext) {
        return this._internal.loadingProgress;
      }
    },
    isLoadingComplete: {
      type: 'boolean',
      group: 'Loading Screen',
      displayName: 'Is Loading Complete',
      getter: function (this: RouterNodeContext) {
        return this._internal.isLoadingComplete;
      }
    },
    onLoadingStart: {
      type: 'signal',
      group: 'Loading Screen',
      displayName: 'On Loading Start'
    },
    onLoadingProgress: {
      type: 'signal',
      group: 'Loading Screen',
      displayName: 'On Loading Progress'
    },
    onLoadingComplete: {
      type: 'signal',
      group: 'Loading Screen',
      displayName: 'On Loading Complete'
    },
    onLoadingFadeOutComplete: {
      type: 'signal',
      group: 'Loading Screen',
      displayName: 'On Fade Out Complete'
    }
  },
  methods: {
    _registerRouter(this: RouterNodeContext) {
      RouterHandler.instance.registerRouter(this._internal.name, this);
    },
    _deregisterRouter(this: RouterNodeContext) {
      RouterHandler.instance.deregisterRouter(this._internal.name, this);
    },
    setPageOutputs(this: RouterNodeContext, outputs: any) {
      for (const prop in outputs) {
        (this._internal as any)[prop] = outputs[prop];
        this.flagOutputDirty(prop);
      }
    },
    scheduleReset(this: RouterNodeContext) {
      const internal = this._internal;
      if (!internal.hasScheduledReset) {
        internal.hasScheduledReset = true;
        this.scheduleAfterInputsHaveUpdated(() => {
          internal.hasScheduledReset = false;
          this.reset();
        });
      }
    },
    createPageContainer(this: RouterNodeContext) {
      const group = this.nodeScope.createPrimitiveNode('Group');
      group.setStyle({ flex: '1 0 100%' });
      return group;
    },
    reset(this: RouterNodeContext) {
      this._internal.asyncQueue.enqueue(this.resetAsync.bind(this));
    },
    scrollToTop(this: RouterNodeContext) {
      const dom = this.getDOMElement();
      if (dom) {
        dom.scrollTop = 0;

        if (XgeniaRuntime.instance.getProjectSettings().bodyScroll) {
          //Automatically scroll the page router into view in case it's currently outside the viewport
          //Might want to add an option to disable this
          dom.scrollIntoView();
        }
      }
    },
    async resetAsync(this: RouterNodeContext) {
      // --- Safety Breaker for Infinite Loops ---
      // If the router is resetting too fast (crashes causing reloads), stop it.
      const now = Date.now();
      const timeSinceLastReset = now - (this._internal.lastResetTime || 0);

      this._internal.lastResetTime = now;

      if (timeSinceLastReset < 2000) {
        this._internal.resetRetries = (this._internal.resetRetries || 0) + 1;
      } else {
        this._internal.resetRetries = 0;
      }

      if (this._internal.resetRetries > 5) {
        console.error('⛔️ [Router] Infinite loop detected! Aborting reset to prevent editor freeze.');
        console.error("This is likely caused by a crashing node (e.g., 'Unknown node type') triggering a reload.");

        // Report to the editor's warning system
        if (this.context.editorConnection) {
          const componentName = this.nodeScope?.componentOwner?.name || '/';
          this.context.editorConnection.sendWarning(componentName, this.id, 'router-infinite-loop', {
            level: 'error',
            message:
              'Infinite Loop Detected: Router is repeatedly crashing and restarting. Check console for details about the failing component.',
            showGlobally: true
          });
        }

        // Show a visual error if possible (rudimentary)
        const dom = this.getDOMElement();
        if (dom) {
          dom.style.border = '5px solid red';
          dom.innerHTML = `
            <div style="background: rgba(0,0,0,0.9); color: white; padding: 20px; position: absolute; top: 0; left: 0; right: 0; bottom: 0; z-index: 9999; overflow: auto; font-family: monospace;">
              <h1 style="color: #ff4444; margin-bottom: 20px;">⛔️ Infinite Loop Detected</h1>
              <p>The router stopped reloading because it detected a crash loop.</p>
              <p>Likely cause: <strong>Unknown node type</strong> or <strong>Graphics Error</strong>.</p>
              <p><strong>Action needed:</strong></p>
              <ul>
                <li>Check the console (both Editor and Browser DevTools) for errors</li>
                <li>Look for "Unknown node type" messages</li>
                <li>Fix or remove the problematic node from your project</li>
                <li>Check the warning icon (triangle) in the editor topbar for details</li>
              </ul>
              <button onclick="location.reload()" style="padding: 10px 20px; background: #444; color: white; border: 1px solid #666; cursor: pointer; margin-top: 20px;">Reload Editor</button>
            </div>
           `;
        }
        return;
      }
      // -----------------------------------------
      let component: string;
      let params = {};

      const matchFromUrl = this.matchPageFromUrl();
      if (matchFromUrl) {
        if (!matchFromUrl.page) {
          // Use the start page
          component = this._internal.pages !== undefined ? this._internal.pages.startPage : undefined;
          params = Object.assign({}, matchFromUrl.params, matchFromUrl.query);
        } else {
          // Use the matching page
          component = matchFromUrl.page.component;
          params = Object.assign({}, matchFromUrl.params, matchFromUrl.query);
        }
      } else {
        // TODO: Clean up matchPageFromUrl, in this case it returns undefined.
        //       remainingNavigationPath is undefined, since it have to run
        //       matchPageFromUrl to get the path. So it feels like it needs
        //       some bigger refactoring to make it understandable.
        // `pages` is set from an input (see the setter above) and is undefined until the
        // router has one, which is why the sibling branch guards the very same read. This one
        // did not, and threw `Cannot read properties of undefined (reading 'startPage')` out of
        // resetAsync as an unhandled rejection when a parameter reset re-ran the router before
        // its pages input had been fed. `component === undefined` is already handled below.
        component = this._internal.pages !== undefined ? this._internal.pages.startPage : undefined;
        params = {};
      }

      if (component === undefined) return; // No component specified for page

      const currentPage = RouterHandler.instance.getPageInfoForComponent(component);

      if (this._internal.currentPage === currentPage) {
        //already at the correct page, keep the current page
        //update page inputs if they have changed
        //TODO: fix if a parameter goes from a value to undefined, the old value will still exist in the connection from previous navigation
        if (!shallowObjectsEqual(this._internal.currentParams, params)) {
          this._internal.currentParams = params;
          this._updatePageInputs(this._internal.currentPageComponent.nodeScope, params);
        }
        return;
      }

      this.scrollToTop();

      // Reset the current page for this router
      // First remove all children
      const children = this.getChildren();
      for (const i in children) {
        const c = children[i];
        this.removeChild(c);
        this.nodeScope.deleteNode(c);
      }

      const content = await this.nodeScope.createNode(component, guid());
      this._internal.currentPageComponent = content;

      // Find the root page node
      const pageNodes = content.nodeScope.getNodesWithType('Page');
      if (pageNodes === undefined || pageNodes.length !== 1) {
        return; // Should be only one page root
      }

      this._internal.currentPage = RouterHandler.instance.getPageInfoForComponent(component);
      this._internal.currentParams = params;

      this.flagOutputDirty('currentPageTitle');
      this.flagOutputDirty('currentPageComponent');
      if (typeof XGENIA !== 'undefined' && (XGENIA as any).SEO) {
        (XGENIA as any).SEO.setTitle(this._internal.currentPage!.title);
      }

      this._updatePageInputs(this._internal.currentPageComponent.nodeScope, params);

      const group = this.createPageContainer();
      group.addChild(content);

      this.addChild(group);

      /*this.setPageOutputs({
        currentUrl: pageInfo.path,
        currentTitle: pageInfo.title
      });*/
    },
    _updatePageInputs(this: RouterNodeContext, nodeScope: any, params: any) {
      for (const pageInputNode of nodeScope.getNodesWithType('PageInputs')) {
        pageInputNode._setPageParams(params);
      }
    },
    getRelativeURL(this: RouterNodeContext, targetPage: ComponentPageInfo, pageParams: NavigateArgs['params']) {
      if (!targetPage) return;

      let urlPath = targetPage.path;
      if (urlPath === undefined) return;

      // First add matching parameters to path
      const paramsInPath = urlPath.match(/{([^}]+)}/g);

      const params = Object.assign({}, pageParams);
      if (paramsInPath) {
        for (const param of paramsInPath) {
          const key = param.replace(/[{}]/g, '');
          if (pageParams[key] !== undefined) {
            urlPath = urlPath.replace(param, encodeURIComponent(params[key]));
            delete params[key];
          }
        }
      }

      // Add other paramters as query
      const query: Array<{ name: string; value: string }> = [];
      for (const key in params) {
        query.push({
          name: key,
          value: encodeURIComponent(params[key])
        });
      }

      urlPath = _trimUrlPart(urlPath);

      // Prepend this routers url path if there is one
      if (this._internal.urlPath !== undefined) urlPath = _trimUrlPart(this._internal.urlPath) + '/' + urlPath;

      return {
        path: urlPath,
        query: query
      };
    },
    getNavigationAbsoluteURL(
      this: RouterNodeContext,
      targetPage: ComponentPageInfo,
      pageParams: NavigateArgs['params']
    ) {
      let parent = this.parent;
      let parentUrl = { path: '', query: [] as Array<{ name: string; value: string }> };

      while (parent !== undefined && typeof parent.getNavigationAbsoluteURL !== 'function') {
        parent = parent.getVisualParentNode();
      }

      if (parent) {
        parentUrl = parent.getNavigationAbsoluteURL(parent._internal.currentPage, parent._internal.currentParams);
      }

      const thisUrl = this.getRelativeURL(targetPage, pageParams);
      if (thisUrl) {
        const haveForwardSlash = parentUrl.path.endsWith('/') || thisUrl.path.startsWith('/');
        return {
          path: parentUrl.path + (haveForwardSlash ? '' : '/') + thisUrl.path,
          query: parentUrl.query.concat(thisUrl.query)
        };
      }

      return parentUrl;
    },
    _getLocationPath: function (this: RouterNodeContext): string {
      const navigationPathType = XgeniaRuntime.instance.getProjectSettings()['navigationPathType'];
      if (navigationPathType === undefined || navigationPathType === 'hash') {
        // Use hash as path
        let hash = location.hash;
        if (hash) {
          if (hash[0] === '#') hash = hash.substring(1);
          if (hash[0] === '/') hash = hash.substring(1);
        }
        return decodeURI(hash);
      } else {
        // Use url as path
        let path = location.pathname;
        if (path) {
          if (path[0] === '/') {
            const baseUrl =
              typeof XGENIA !== 'undefined' && (XGENIA as any).Env ? (XGENIA as any).Env['BaseUrl'] : undefined;
            if (baseUrl) {
              const pathnameLength = getBaseUrlLength(baseUrl);
              path = path.substring(pathnameLength);
            } else {
              path = path.substring(1);
            }
          }
        }
        return decodeURI(path);
      }
    },
    _getSearchParams: function (this: RouterNodeContext): Record<string, string> {
      // Regex for replacing addition symbol with a space
      const pl = /\+/g;
      const search = /([^&=]+)=?([^&]*)/g;
      const decode = function (s: string) {
        return decodeURIComponent(s.replace(pl, ' '));
      };
      const query = location.search.substring(1);

      let match: RegExpExecArray | null;

      const urlParams: Record<string, string> = {};
      while ((match = search.exec(query))) urlParams[decode(match[1])] = decode(match[2]);

      return urlParams;
    },
    getNavigationRemainingPath(this: RouterNodeContext) {
      return this._internal.remainingNavigationPath;
    },
    matchPageFromUrl(this: RouterNodeContext) {
      // Attempt to find relative path from closest navigation parent
      let parent = this.parent;
      while (parent !== undefined && typeof parent.getNavigationRemainingPath !== 'function') {
        parent = parent.getVisualParentNode();
      }

      let pathParts: string[] | undefined = undefined;

      // Either use current browser location if we have no parent, or use remaining path
      // from parent
      if (parent === undefined) {
        let urlPath = this._getLocationPath();
        if (urlPath[0] === '/') urlPath = urlPath.substring(1);
        pathParts = urlPath.split('/');
      } else {
        pathParts = parent.getNavigationRemainingPath();
      }
      if (pathParts === undefined) return;

      const urlQuery = this._getSearchParams();

      function _matchPathParts(path: string[], pattern: string[]) {
        const params: Record<string, string> = {};
        for (let i = 0; i < pattern.length; i++) {
          const _p = pattern[i];
          if (_p[0] === '{' && _p[_p.length - 1] === '}') {
            // This is a param, collect it
            if (path[i] !== undefined) {
              params[_p.substring(1, _p.length - 1)] = decodeURIComponent(path[i]);
            }
          } else if (path[i] === undefined || _p !== path[i]) return;
        }
        return {
          params: params,
          remainingPathParts: path.slice().splice(pattern.length) // Make copy
        };
      }

      const pages = RouterHandler.instance.getPagesForRouter(this._internal.name);
      if (pages === undefined || pages.length === 0) return;

      let matchedPage: any,
        bestMatchLength = 9999;
      for (const pageInfo of pages) {
        if (!pageInfo) continue;
        let pagePattern = pageInfo.path;
        if (pagePattern === undefined) continue;
        pagePattern = _trimUrlPart(pagePattern);

        // Prepend this routers url path if there is one
        if (this._internal.urlPath !== undefined)
          pagePattern = _trimUrlPart(this._internal.urlPath) + '/' + pagePattern;

        const pagePatternParts = pagePattern.split('/');
        const match = _matchPathParts(pathParts, pagePatternParts);

        const dist = Math.abs(pagePatternParts.length - pathParts.length);
        if (match && bestMatchLength > dist) {
          // This page is a match
          matchedPage = { match, pageInfo };
          bestMatchLength = dist;
        }
      }

      if (matchedPage) {
        this._internal.remainingNavigationPath = matchedPage.match.remainingPathParts;
        return {
          page: matchedPage.pageInfo,
          params: matchedPage.match.params,
          query: urlQuery
        };
      } else {
        return {
          page: undefined, // no matched page
          params: {},
          query: urlQuery
        };
      }
    },
    _getCompleteUrlToPage(this: RouterNodeContext, page: ComponentPageInfo, pageParams: NavigateArgs['params']) {
      const url = this.getNavigationAbsoluteURL(page, pageParams);

      let urlPath: string | undefined, hashPath: string | undefined;
      const navigationPathType = XgeniaRuntime.instance.getProjectSettings()['navigationPathType'];
      if (navigationPathType === undefined || navigationPathType === 'hash') {
        hashPath = url.path;
      } else {
        urlPath = url.path;
      }

      const query = url.query.map((q) => q.name + '=' + q.value);
      const compiledUrl =
        (urlPath !== undefined ? urlPath : '') +
        (query.length >= 1 ? '?' + query.join('&') : '') +
        (hashPath !== undefined ? '#' + hashPath : '');

      return compiledUrl;
    },
    _updateUrlWithTopPage(this: RouterNodeContext) {
      // Push the state to the browser url
      if (window.history !== undefined) {
        this._internal.remainingNavigationPath = undefined; // Reset remaining nav path

        const url = this._getCompleteUrlToPage(this._internal.currentPage!, this._internal.currentParams!);
        window.history.pushState({}, '', url);
      }
    },
    navigate(this: RouterNodeContext, args: NavigateArgs) {
      this._internal.asyncQueue.enqueue(this.navigateAsync.bind(this, args));
    },
    async navigateAsync(this: RouterNodeContext, args: NavigateArgs) {
      if (args.target === undefined) return;

      const newPage = RouterHandler.instance.getPageInfoForComponent(args.target);
      if (!newPage) return; //TODO: send error to editor, "invalid page component name"

      if (args.openInNewTab) {
        const url = this._getCompleteUrlToPage(newPage, args.params);
        window.open(url, '_blank');
        args.hasNavigated && args.hasNavigated();
      } else {
        await this._navigateInCurrentWindow(newPage, args);
      }
    },
    async _navigateInCurrentWindow(this: RouterNodeContext, newPage: ComponentPageInfo, args: NavigateArgs) {
      this.scrollToTop();

      // Remove all current pages in the stack
      const children = this.getChildren();
      for (const i in children) {
        const c = children[i];
        this.removeChild(c);
        this.nodeScope.deleteNode(c);
      }

      const group = this.createPageContainer();

      // Create the page content
      const content = await this.nodeScope.createNode(args.target, guid());

      this._internal.currentPage = newPage;
      this._internal.currentParams = args.params;

      this.flagOutputDirty('currentPageTitle');
      this.flagOutputDirty('currentPageComponent');
      if (typeof XGENIA !== 'undefined' && (XGENIA as any).SEO) {
        (XGENIA as any).SEO.setTitle(this._internal.currentPage.title);
      }

      const pageInputNodes = content.nodeScope.getNodesWithType('PageInputs');
      if (pageInputNodes !== undefined && pageInputNodes.length > 0) {
        pageInputNodes.forEach((node: any) => {
          node._setPageParams(args.params);
        });
      }

      group.addChild(content);
      this.addChild(group);

      this._updateUrlWithTopPage();

      args.hasNavigated && args.hasNavigated();
      RouterHandler.instance.onNavigated(this._internal.name, newPage);
    },
    registerInputIfNeeded: function (this: RouterNodeContext, name: string) {
      if (this.hasInput(name)) {
        return;
      }
    },
    // Loading Screen methods
    _startAssetLoading: function (this: RouterNodeContext) {
      if (this._internal.hasStartedLoading || this._internal.isLoadingComplete) {
        return;
      }

      this._internal.hasStartedLoading = true;
      this._internal.loadingProgress = 0.05; // Show some initial progress
      this.props.loadingProgress = 0.05;
      this.sendSignalOnOutput('onLoadingStart');
      this.forceUpdate();

      console.log('[Router] Starting asset loading...');

      // Get project data
      let projectData = null;
      let baseUrl = '';

      // Check if deployed mode
      const isDeployed = typeof window !== 'undefined' && (window as any).XGENIA?.deployed === true;

      // Try to get from context
      if (this.context?.graphModel) {
        projectData = (this.context.graphModel as any)._data || (this.context.graphModel as any).projectData;
      }

      // Try global runtime
      if (!projectData && typeof window !== 'undefined') {
        const runtime = (window as any).XGENIA?._runtime || (window as any).XGENIA?.runtime;
        if (runtime) {
          projectData = runtime._currentLoadedData || runtime.graphModel?._data;
        }

        // Deployed mode: check window.projectData
        if (!projectData && (window as any).projectData) {
          projectData = (window as any).projectData;
        }
      }

      // Get base URL
      if (typeof window !== 'undefined') {
        baseUrl = (window as any).XGENIA?.Env?.BaseUrl || '';
        if (!baseUrl && window.location) {
          const pathParts = window.location.pathname.split('/');
          pathParts.pop();
          baseUrl = window.location.origin + pathParts.join('/');
        }
      }

      console.log('[Router] Project data found:', !!projectData, 'Deployed:', isDeployed);

      if (!projectData) {
        console.warn('[Router] No project data, completing loading immediately');
        setTimeout(() => {
          this._handleLoadingComplete();
        }, 500);
        return;
      }

      // Dynamically import the asset utilities to avoid circular dependencies
      const self = this;
      // FIX (2026-03-10): Use dynamic import() instead of require() to fix TS2580 build error.
      // require() is not available in browser-targeted webpack builds without @types/node.
      Promise.all([
        import('../../utils/AssetCollector'),
        import('../../utils/ComprehensiveAssetLoader')
      ]).then(([assetCollectorModule, assetLoaderModule]) => {
        const { collectProjectAssets } = assetCollectorModule;
        const { loadAssets } = assetLoaderModule;

        const assets = collectProjectAssets(projectData, { baseUrl });
        console.log('[Router] Collected', assets.length, 'assets to load');

        if (assets.length === 0) {
          console.log('[Router] No assets to load, completing after brief delay');
          setTimeout(() => {
            self._handleLoadingComplete();
          }, 800);
          return;
        }

        loadAssets(assets, {
          maxConcurrent: self._internal.maxConcurrent,
          maxRetries: self._internal.maxRetries,
          onProgress: function (progress: any) {
            self._internal.loadingProgress = progress.percentage / 100;
            self.props.loadingProgress = self._internal.loadingProgress;
            self.flagOutputDirty('loadingProgress');
            self.sendSignalOnOutput('onLoadingProgress');
            self.forceUpdate();
          },
          onComplete: function () {
            self._handleLoadingComplete();
          }
        }).catch(function (error: any) {
          console.error('[Router] Loading error:', error);
          self._handleLoadingComplete();
        });
      }).catch((error: any) => {
        console.error('[Router] Error loading assets:', error);
        setTimeout(() => {
          self._handleLoadingComplete();
        }, 500);
      });
    },
    _handleLoadingComplete: function (this: RouterNodeContext) {
      console.log('[Router] Loading complete');
      this._internal.loadingProgress = 1;
      this.flagOutputDirty('isLoadingComplete');
      this.sendSignalOnOutput('onLoadingComplete');

      if (this._internal.loadingAutoHide) {
        this.props.loaderVisible = false;
      }
      this.forceUpdate();
    },
    _handleLoadingFadeOutComplete: function (this: RouterNodeContext) {
      console.log('[Router] Loading fade out complete');
      this.sendSignalOnOutput('onLoadingFadeOutComplete');
    }
  }
};

function shallowObjectsEqual(object1: any, object2: any) {
  const keys1 = Object.keys(object1 || {});
  const keys2 = Object.keys(object2 || {});

  if (keys1.length !== keys2.length) {
    return false;
  }

  return keys1.every((key) => object1[key] === object2[key]);
}

export default createNodeFromReactComponent(RouterNode);
