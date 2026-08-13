/**
* LoaderNode - A visual node that preloads all project assets and displays a loading screen
* 
* Features:
* - Automatically scans project for all assets (images, audio, video, fonts, etc.)
* - Displays a branded loading screen with progress bar
* - Blocks app rendering until loading completes
* - Configurable retry logic for failed assets
* - Works in both editor preview and deployed environments
*/

// Import as named export to match how it's exported
import { LoaderScreen as LoaderComponent } from '../../components/visual/LoaderScreen';
import { createNodeFromReactComponent } from '../../react-component-node';

// Global state to track loading across the app
let globalLoadingState = {
  hasStarted: false,
  isComplete: false,
  progress: 0,
  collectedAssets: [],
  stats: null
};

// Event emitter for loading state changes
const loadingStateListeners = new Set();

function notifyStateChange() {
  loadingStateListeners.forEach(listener => {
    try {
      listener({ ...globalLoadingState });
    } catch (e) {
      console.error('[LoaderNode] Listener error:', e);
    }
  });
}

/**
* LoaderNode Definition
*/
const LoaderNode = {
  name: 'xgenia.Loader',
  displayNodeName: 'App Loader',
  displayName: 'App Loader',
  docs: 'https://docsapp.xgenia.com/nodes/utilities/loader',
  category: 'Utilities',
  color: 'visual',

  allowChildren: true,
  useVariants: false,
  xgeniaNodeAsProp: true,

  connectionPanel: {
    groupPriority: [
      'General',
      'Appearance',
      'Loading',
      'Asset Types',
      'Control',
      'Status',
      'Events'
    ]
  },

  initialize() {
    this._internal = {
      isLoading: false,
      isComplete: false,
      progress: 0,
      hasStartedLoading: false,
      collectedAssets: [],
      stats: null,
      loadingText: 'Loading assets...',
      showPercentage: true,
      maxRetries: 3,
      maxConcurrent: 6,
      autoStart: true,
      includeImages: true,
      includeAudio: true,
      includeVideo: true,
      includeFonts: true,
      includeScripts: true,
      autoHide: true,
      stateListener: null
    };

    this.props.loadingText = this._internal.loadingText;
    this.props.showPercentage = this._internal.showPercentage;
    this.props.isVisible = true;
    this.props.progress = 0;
    this.props.autoHide = true;
  },

  getReactComponent() {
    return LoaderComponent;
  },

  defaultCss: {
    position: 'relative',
    width: '100%',
    height: '100%'
  },

  inputs: {
    loadingText: {
      displayName: 'Loading Text',
      group: 'Appearance',
      type: 'string',
      default: 'Loading assets...',
      index: 10,
      set(value) {
        this._internal.loadingText = value || 'Loading assets...';
        this.props.loadingText = this._internal.loadingText;
        this.props.isVisible = true;
        this.forceUpdate();
      }
    },

    showPercentage: {
      displayName: 'Show Percentage',
      group: 'Appearance',
      type: 'boolean',
      default: true,
      index: 11,
      set(value) {
        this._internal.showPercentage = value;
        this.props.showPercentage = value;
        this.forceUpdate();
      }
    },

    maxRetries: {
      displayName: 'Max Retries',
      group: 'Loading',
      type: 'number',
      default: 3,
      index: 20,
      set(value) {
        this._internal.maxRetries = Math.max(1, Math.min(10, value || 3));
      }
    },

    maxConcurrent: {
      displayName: 'Concurrent Loads',
      group: 'Loading',
      type: 'number',
      default: 6,
      index: 21,
      set(value) {
        this._internal.maxConcurrent = Math.max(1, Math.min(20, value || 6));
      }
    },

    autoStart: {
      displayName: 'Auto Start',
      group: 'Loading',
      type: 'boolean',
      default: true,
      index: 22,
      set(value) {
        this._internal.autoStart = value;
      }
    },

    startLoading: {
      displayName: 'Start Loading',
      group: 'Control',
      type: 'signal',
      index: 30,
      valueChangedToTrue() {
        this._startLoading();
      }
    },

    includeImages: {
      displayName: 'Include Images',
      group: 'Asset Types',
      type: 'boolean',
      default: true,
      index: 40,
      set(value) {
        this._internal.includeImages = value;
      }
    },

    includeAudio: {
      displayName: 'Include Audio',
      group: 'Asset Types',
      type: 'boolean',
      default: true,
      index: 41,
      set(value) {
        this._internal.includeAudio = value;
      }
    },

    includeVideo: {
      displayName: 'Include Video',
      group: 'Asset Types',
      type: 'boolean',
      default: true,
      index: 42,
      set(value) {
        this._internal.includeVideo = value;
      }
    },

    includeFonts: {
      displayName: 'Include Fonts',
      group: 'Asset Types',
      type: 'boolean',
      default: true,
      index: 43,
      set(value) {
        this._internal.includeFonts = value;
      }
    },

    includeScripts: {
      displayName: 'Include Scripts',
      group: 'Asset Types',
      type: 'boolean',
      default: true,
      index: 44,
      set(value) {
        this._internal.includeScripts = value;
      }
    },

    autoHide: {
      displayName: 'Auto Hide at 100%',
      group: 'Appearance',
      type: 'boolean',
      default: true,
      index: 12,
      set(value) {
        this._internal.autoHide = value;
        this.props.autoHide = value;
        this.forceUpdate();
      }
    },

    showLoader: {
      displayName: 'Show Loader',
      group: 'Control',
      type: 'signal',
      index: 31,
      valueChangedToTrue() {
        this.props.isVisible = true;
        this.forceUpdate();
      }
    },

    hideLoader: {
      displayName: 'Hide Loader',
      group: 'Control',
      type: 'signal',
      index: 32,
      valueChangedToTrue() {
        this.props.isVisible = false;
        this.forceUpdate();
      }
    }
  },

  outputs: {
    progress: {
      displayName: 'Progress',
      group: 'Status',
      type: 'number',
      getter() {
        return this._internal.progress;
      }
    },

    isLoading: {
      displayName: 'Is Loading',
      group: 'Status',
      type: 'boolean',
      getter() {
        return this._internal.isLoading;
      }
    },

    isComplete: {
      displayName: 'Is Complete',
      group: 'Status',
      type: 'boolean',
      getter() {
        return this._internal.isComplete;
      }
    },

    assetCount: {
      displayName: 'Total Assets',
      group: 'Status',
      type: 'number',
      getter() {
        return this._internal.collectedAssets?.length || 0;
      }
    },

    loadedCount: {
      displayName: 'Loaded Count',
      group: 'Status',
      type: 'number',
      getter() {
        return this._internal.stats?.loadedAssets || 0;
      }
    },

    failedCount: {
      displayName: 'Failed Count',
      group: 'Status',
      type: 'number',
      getter() {
        return this._internal.stats?.failedAssets || 0;
      }
    },

    onLoadStart: {
      displayName: 'On Load Start',
      group: 'Events',
      type: 'signal'
    },

    onProgress: {
      displayName: 'On Progress',
      group: 'Events',
      type: 'signal'
    },

    onLoadComplete: {
      displayName: 'On Load Complete',
      group: 'Events',
      type: 'signal'
    },

    onFadeOutComplete: {
      displayName: 'On Fade Out Complete',
      group: 'Events',
      type: 'signal'
    },

    onAssetFailed: {
      displayName: 'On Asset Failed',
      group: 'Events',
      type: 'signal'
    }
  },

  methods: {
    _startLoading() {
      if (this._internal.hasStartedLoading || globalLoadingState.isComplete) {
        console.log('[LoaderNode] Already started or complete, skipping');
        return;
      }

      this._internal.hasStartedLoading = true;
      this._internal.isLoading = true;
      globalLoadingState.hasStarted = true;

      // Update progress to show collecting phase
      this._internal.progress = 0.05; // 5% to show activity
      this.props.progress = 0.05;
      this.props.isVisible = true;

      this.flagOutputDirty('isLoading');
      this.flagOutputDirty('progress');
      this.sendSignalOnOutput('onLoadStart');
      this.forceUpdate();

      console.log('[LoaderNode] Starting asset loading...');

      // Get project data from context or runtime
      let projectData = null;
      let baseUrl = '';

      // Determine if we're in deployed mode
      const isDeployed = typeof window !== 'undefined' && window.XGENIA?.deployed === true;
      console.log('[LoaderNode] Mode:', isDeployed ? 'DEPLOYED' : 'EDITOR');

      // Try to get from node context first
      if (this.context?.graphModel) {
        projectData = this.context.graphModel._data ||
          this.context.graphModel.projectData ||
          this.context.graphModel.getData?.();
      }

      // Try nodeScope context
      if (!projectData && this.nodeScope?.context?.graphModel) {
        projectData = this.nodeScope.context.graphModel._data ||
          this.nodeScope.context.graphModel.projectData;
      }

      // Try global runtime (multiple access patterns)
      if (!projectData && typeof window !== 'undefined') {
        // Try window.XGENIA._runtime
        const runtime = window.XGENIA?._runtime ||
          window.XGENIA?.runtime ||
          window._xgeniaRuntime;
        if (runtime) {
          projectData = runtime._currentLoadedData ||
            runtime.graphModel?._data ||
            runtime.graphModel?.projectData;
        }

        // Try window.XgeniaRuntime (singleton pattern)
        if (!projectData && window.XgeniaRuntime?.instance) {
          projectData = window.XgeniaRuntime.instance._currentLoadedData ||
            window.XgeniaRuntime.instance.graphModel?._data;
        }

        // DEPLOYED MODE: Try window.projectData directly
        // This is set in index.js before the runtime loads
        if (!projectData && window.projectData) {
          console.log('[LoaderNode] Using window.projectData (deployed mode)');
          projectData = window.projectData;
        }
      }

      // Get base URL
      if (typeof window !== 'undefined') {
        // In deployed mode, use XGENIA.Env.BaseUrl or current origin
        baseUrl = window.XGENIA?.Env?.BaseUrl || '';

        // If no BaseUrl set, derive from current location
        if (!baseUrl && window.location) {
          // For deployed apps, assets are relative to the HTML file
          const pathParts = window.location.pathname.split('/');
          pathParts.pop(); // Remove the HTML file name
          baseUrl = window.location.origin + pathParts.join('/');
        }
      }

      console.log('[LoaderNode] Project data found:', !!projectData, 'Base URL:', baseUrl);

      // Log what we found for debugging
      if (projectData) {
        console.log('[LoaderNode] Project data keys:', Object.keys(projectData));
        console.log('[LoaderNode] Components:',
          Array.isArray(projectData.components)
            ? projectData.components.length + ' components (array)'
            : (projectData.components ? Object.keys(projectData.components).length + ' components (object)' : 'none')
        );
      }

      if (!projectData) {
        console.warn('[LoaderNode] No project data available, completing immediately');
        // Complete with a slight delay to allow the UI to show
        const self = this;
        setTimeout(function () {
          self._completeLoading({
            totalAssets: 0,
            loadedAssets: 0,
            failedAssets: 0,
            totalTime: 0,
            failedUrls: []
          });
        }, 500);
        return;
      }

      try {
        // Dynamically import utilities
        const { collectProjectAssets } = require('../../utils/AssetCollector');
        const { loadAssets, loadPixiAssets } = require('../../utils/ComprehensiveAssetLoader');

        const assets = collectProjectAssets(projectData, { baseUrl });
        this._internal.collectedAssets = assets;
        globalLoadingState.collectedAssets = assets;

        this.flagOutputDirty('assetCount');

        if (assets.length === 0) {
          console.log('[LoaderNode] No assets to load, completing after brief display');
          // Show loader briefly before completing
          const self = this;
          setTimeout(function () {
            self._completeLoading({
              totalAssets: 0,
              loadedAssets: 0,
              failedAssets: 0,
              totalTime: 0,
              failedUrls: []
            });
          }, 800);
          return;
        }

        console.log(`[LoaderNode] Collected ${assets.length} assets to load`);

        const self = this;

        // Start loading with progress tracking
        loadAssets(assets, {
          maxConcurrent: this._internal.maxConcurrent,
          maxRetries: this._internal.maxRetries,
          onProgress: function (progress) {
            self._updateProgress(progress);
          },
          onAssetFailed: function (asset, error) {
            console.warn(`[LoaderNode] Asset failed: ${asset.url}`, error);
            self.sendSignalOnOutput('onAssetFailed');
          },
          onComplete: function (stats) {
            self._completeLoading(stats);
          }
        }).then(function () {
          // Also preload to PIXI cache if PIXI is available
          return loadPixiAssets(assets).catch(function (err) {
            console.warn('[LoaderNode] PIXI preload warning:', err);
          });
        }).catch(function (error) {
          console.error('[LoaderNode] Loading error:', error);
          self._completeLoading({
            totalAssets: assets.length,
            loadedAssets: 0,
            failedAssets: assets.length,
            totalTime: 0,
            failedUrls: assets.map(function (a) { return a.url; })
          });
        });

      } catch (error) {
        console.error('[LoaderNode] Error collecting assets:', error);
        this._completeLoading({
          totalAssets: 0,
          loadedAssets: 0,
          failedAssets: 0,
          totalTime: 0,
          failedUrls: []
        });
      }
    },

    _updateProgress(progress) {
      this._internal.progress = progress.percentage / 100;
      globalLoadingState.progress = this._internal.progress;

      // Update props for React component
      this.props.progress = this._internal.progress;
      this.props.isVisible = true;

      this.flagOutputDirty('progress');
      this.sendSignalOnOutput('onProgress');

      // Notify listeners and update
      notifyStateChange();
      this.forceUpdate();
    },

    _completeLoading(stats) {
      this._internal.isLoading = false;
      this._internal.isComplete = true;
      this._internal.progress = 1;
      this._internal.stats = stats;

      globalLoadingState.isComplete = true;
      globalLoadingState.progress = 1;
      globalLoadingState.stats = stats;

      // Update props for React component
      this.props.progress = 1;

      if (this._internal.autoHide) {
        this.props.isVisible = false;
      }

      this.flagOutputDirty('isLoading');
      this.flagOutputDirty('isComplete');
      this.flagOutputDirty('progress');
      this.flagOutputDirty('loadedCount');
      this.flagOutputDirty('failedCount');

      this.sendSignalOnOutput('onLoadComplete');

      console.log(`[LoaderNode] Loading complete: ${stats.loadedAssets}/${stats.totalAssets} assets in ${stats.totalTime}ms`);

      // Notify listeners and update
      notifyStateChange();
      this.forceUpdate();
    },

    _handleFadeOutComplete() {
      this.sendSignalOnOutput('onFadeOutComplete');
    },

    didMount() {
      const self = this;

      // Subscribe to global state changes
      this._internal.stateListener = function (state) {
        if (state.isComplete && self._internal.autoHide) {
          self.props.isVisible = false;
        }
        self.props.progress = state.progress;
        self.forceUpdate();
      };
      loadingStateListeners.add(this._internal.stateListener);

      // Set up fade out callback
      this.props.onFadeOutComplete = function () {
        self._handleFadeOutComplete();
      };

      // Auto-start if enabled - wait a bit for runtime to be ready
      if (this._internal.autoStart && !this._internal.hasStartedLoading) {
        // Try multiple times with increasing delays
        const tryStart = function (attempt) {
          if (self._internal.hasStartedLoading) return;

          // Check if runtime data is available
          const runtime = typeof window !== 'undefined'
            ? (window.XGENIA?._runtime || window.XGENIA?.runtime)
            : null;

          // Check multiple sources for data availability
          const hasData = runtime?._currentLoadedData ||
            self.context?.graphModel?._data ||
            self.nodeScope?.context?.graphModel?._data ||
            (typeof window !== 'undefined' && window.projectData); // Deployed mode

          if (hasData || attempt >= 5) {
            console.log('[LoaderNode] Starting loading, attempt:', attempt, 'hasData:', !!hasData,
              'deployed:', typeof window !== 'undefined' && window.XGENIA?.deployed === true);
            self._startLoading();
          } else {
            // Wait and try again
            console.log('[LoaderNode] Data not ready, retrying in', 100 * (attempt + 1), 'ms');
            setTimeout(function () {
              tryStart(attempt + 1);
            }, 100 * (attempt + 1));
          }
        };

        setTimeout(function () {
          tryStart(0);
        }, 50);
      }
    },

    _onNodeDeleted() {
      // Cleanup listener
      if (this._internal.stateListener) {
        loadingStateListeners.delete(this._internal.stateListener);
      }
    }
  },

  dynamicports: [
    {
      condition: 'autoStart = false',
      inputs: ['startLoading']
    }
  ]
};

// Manually bind methods to avoid issues
if (LoaderNode.methods) {
  for (const methodName in LoaderNode.methods) {
    if (typeof LoaderNode.methods[methodName] === 'function') {
      const originalMethod = LoaderNode.methods[methodName];
      LoaderNode.methods[methodName] = function (...args) {
        return originalMethod.apply(this, args);
      };
    }
  }
}

// Manually bind input methods
if (LoaderNode.inputs) {
  for (const inputName in LoaderNode.inputs) {
    if (LoaderNode.inputs[inputName] && typeof LoaderNode.inputs[inputName].set === 'function') {
      const originalSet = LoaderNode.inputs[inputName].set;
      LoaderNode.inputs[inputName].set = function (...args) {
        return originalSet.apply(this, args);
      };
    }
    if (LoaderNode.inputs[inputName] && typeof LoaderNode.inputs[inputName].valueChangedToTrue === 'function') {
      const originalValueChangedToTrue = LoaderNode.inputs[inputName].valueChangedToTrue;
      LoaderNode.inputs[inputName].valueChangedToTrue = function (...args) {
        return originalValueChangedToTrue.apply(this, args);
      };
    }
  }
}

export default createNodeFromReactComponent(LoaderNode);
