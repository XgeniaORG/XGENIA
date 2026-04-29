/**
 * Node Type Adapter registry
 *
 * This file handles the registration and management of adapters for different node types.
 * Each adapter can add special behavior to node types.
 */

import { NodeLibrary } from '@xgenia-models/nodelibrary';
import { AggregateRecordsAdapter } from '@xgenia-models/NodeTypeAdapters/AggregateRecordsAdapter';
import { CloudFunctionAdapter } from '@xgenia-models/NodeTypeAdapters/CloudFunctionAdapter';
import { ControlsAdapter } from '@xgenia-models/NodeTypeAdapters/ControlsAdapter';
import { FilterRecordsAdapter } from '@xgenia-models/NodeTypeAdapters/FilterRecordsAdapter';
import { PageInputsAdapter } from '@xgenia-models/NodeTypeAdapters/PageInputsAdapter';
import { QueryRecordsAdapter } from '@xgenia-models/NodeTypeAdapters/QueryRecordsAdapter';
import { RouterAdapter } from '@xgenia-models/NodeTypeAdapters/RouterAdapter';
import { ProjectModel } from '@xgenia-models/projectmodel';

import { EventDispatcher } from '../../../../shared/utils/EventDispatcher';
import { registerCommonActionPorts, registerDynamicPorts } from './PortRegistrationHelper';
import { RouterNavigateAdapter } from './RouterNavigateAdapter';

/**
 * Bridge: EventDispatcher emits "Model.parametersChanged" when any model (e.g. a node) calls
 * notifyListeners('parametersChanged'). We invoke the adapter handler directly so the adapter
 * runs when the user changes e.g. Target Page on RouterNavigate. We do NOT use
 * ProjectModel.notifyListeners here, because that would make the Model base emit to EventDispatcher
 * with model=ProjectModel.instance, and listeners (e.g. ViewerConnection) that assume model is a
 * node (event.model.type.name) would throw and can trigger a full project restart.
 */
let _parametersChangedBridgeDone = false;
function _bridgeParametersChangedToProjectModel(getAdapter: (nodeType: string) => any) {
  if (!ProjectModel.instance || _parametersChangedBridgeDone) return;
  _parametersChangedBridgeDone = true;
  EventDispatcher.instance.on(
    'Model.parametersChanged',
    (event: { model: any; args?: any }) => {
      const model = event?.model;
      if (!model || typeof model.typename !== 'string') return;
      const adapter = getAdapter(model.typename);
      if (!adapter?.events) return;
      const handler = adapter.events['parametersChanged.' + model.typename];
      if (typeof handler === 'function') handler({ model, args: event.args });
    },
    { _bridge: 'parametersChanged' }
  );
}


// Store adapters by node type
const _adapters = {
  Router: () => RouterAdapter,
  RouterNavigate: () => RouterNavigateAdapter,
  PageInputs: () => PageInputsAdapter,
  DbCollection2: () => QueryRecordsAdapter,
  FilterDBModels: () => FilterRecordsAdapter,
  CloudFunction2: () => CloudFunctionAdapter,
  AggregateRecords: () => AggregateRecordsAdapter,
  'net.xgenia.controls.button': () =>
    class ButtonAdapter extends ControlsAdapter {
      constructor() {
        super('net.xgenia.controls.button');
      }
    },
  'net.xgenia.controls.textinput': () =>
    class TextInputAdapter extends ControlsAdapter {
      constructor() {
        super('net.xgenia.controls.textinput');
      }
    },
  Dropdown: () =>
    class DropdownAdapter extends ControlsAdapter {
      constructor() {
        super('Dropdown');
      }
    }
};

// Listener tracking for cleanup
const _listenerMap = new Map();

/**
 * Initialize all adapters by instantiating them and registering their events
 */
function initializeAllAdapters() {
  Object.keys(_adapters).forEach((nodeType) => {
    const adapterFactory = _adapters[nodeType];
    if (typeof adapterFactory === 'function') {
      _registerNewAdapter(adapterFactory, nodeType);
    }
  });
}

/**
 * Adds an event listener to the specified model
 * @param model The model to listen to events on
 * @param event The event to listen for
 * @param adapter The adapter that will handle the event
 * @param fn The function to call on the adapter
 */
function _addListener(model, event, adapter, fn) {
  if (!model || !event || !adapter || !fn) {
    console.warn('Invalid listener configuration', { model, event, adapter, fn });
    return;
  }

  // Create handler function
  const handler = function (args) {
    if (adapter && typeof adapter[fn] === 'function') {
      adapter[fn](args);
    } else {
      console.warn(`Handler ${fn} not found on adapter for event ${event}`);
    }
  };

  // Register with the model
  if (model && typeof model.on === 'function') {
    model.on(event, handler);

    // Store for potential cleanup
    if (!_listenerMap.has(model)) {
      _listenerMap.set(model, []);
    }
    _listenerMap.get(model).push({ event, handler });
  } else {
    console.warn(`Model does not support event listening`, model);
  }
}

/**
 * Registers a new adapter for a specific node type
 * @param adapterClass The adapter class (constructor function)
 * @param nodeType The node type to register the adapter for
 */
function _registerNewAdapter(adapterClass, nodeType) {
  try {
    // Handle factory functions that return adapter classes
    let AdapterConstructor = adapterClass;
    if (typeof adapterClass === 'function') {
      const result = adapterClass();
      // Handle both ES modules with default export and direct constructors
      AdapterConstructor = result && result.default ? result.default : result;
    }

    if (typeof AdapterConstructor !== 'function') {
      console.warn(`Failed to register adapter for ${nodeType} - adapter is not a constructor:`, AdapterConstructor);
      return;
    }

    const adapter = new AdapterConstructor();
    _adapters[nodeType] = adapter;

    // Register event listeners if the adapter defines them
    if (adapter.events) {
      if (Array.isArray(adapter.events)) {
        adapter.events.forEach(function (event) {
          if (event && event.model && event.event && event.fn) {
            _addListener(event.model, event.event, adapter, event.fn);
          }
        });
      } else if (typeof adapter.events === 'object') {
        Object.keys(adapter.events).forEach(function (eventName) {
          const handler = adapter.events[eventName];
          if (typeof handler === 'function') {
            // For legacy format, register the bound function directly
            if (ProjectModel.instance && typeof ProjectModel.instance.on === 'function') {
              ProjectModel.instance.on(eventName, handler);

              // Store for potential cleanup
              if (!_listenerMap.has(ProjectModel.instance)) {
                _listenerMap.set(ProjectModel.instance, []);
              }
              _listenerMap.get(ProjectModel.instance).push({ event: eventName, handler });
            }
          }
        });
      }
    }

    // After registering the adapter, ensure ports are registered for this node type
    if (
      nodeType.includes('net.xgenia.controls') ||
      nodeType.includes('Button') ||
      nodeType.includes('Input') ||
      nodeType.includes('Navigate')
    ) {
      registerCommonActionPorts(nodeType);
    }
  } catch (error: any) {
    console.error(`Error registering adapter for ${nodeType}:`, error);
  }
}

/**
 * Gets the adapter for a specific node type
 * @param nodeType The node type to get the adapter for
 * @returns The adapter for the specified node type
 */
function getNodeTypeAdapter(nodeType) {
  const adapter = _adapters[nodeType];

  // If it's a factory function, instantiate it lazily
  if (typeof adapter === 'function') {
    _registerNewAdapter(adapter, nodeType);
    return _adapters[nodeType];
  }

  // If it's already an instance, return it (null silently for types with no adapter)
  return adapter || null;
}

/**
 * Registers a node type adapter
 * @param nodeType The node type to register the adapter for
 * @param adapter The adapter to register
 */
function registerNodeTypeAdapter(nodeType, adapter) {
  _registerNewAdapter(adapter, nodeType);
}

/**
 * Registers multiple adapters
 * @param adapterInfoList Array of {nodeType, adapter} objects
 */
function registerNodeTypeAdapters(adapterInfoList) {
  if (!Array.isArray(adapterInfoList)) {
    console.warn('registerNodeTypeAdapters expected an array but got', typeof adapterInfoList);
    return;
  }

  adapterInfoList.forEach(function (adapterInfo) {
    if (adapterInfo && adapterInfo.nodeType && adapterInfo.adapter) {
      _registerNewAdapter(adapterInfo.adapter, adapterInfo.nodeType);
    } else {
      console.warn('Invalid adapter info', adapterInfo);
    }
  });
}

// Export functions using ESM syntax
export { getNodeTypeAdapter, registerNodeTypeAdapter, registerNodeTypeAdapters, initializeAllAdapters };

// Initialize all adapters when the module is loaded
if (ProjectModel.instance) {
  initializeAllAdapters();
  _bridgeParametersChangedToProjectModel(getNodeTypeAdapter);
} else {
  const checkProjectModel = () => {
    if (ProjectModel.instance) {
      initializeAllAdapters();
      _bridgeParametersChangedToProjectModel(getNodeTypeAdapter);
    } else {
      setTimeout(checkProjectModel, 100);
    }
  };
  checkProjectModel();
}

NodeLibrary.instance.on('libraryUpdated', () => {
  onProjectAndNodeLibraryLoaded();
});

//Trigger the "projectLoaded" event when a project is loaded AND the node library is ready
//keep track of when the event has fired so it doesn't get triggered multiple times
let projectLoaded = false;

EventDispatcher.instance.on(
  'ProjectModel.instanceHasChanged',
  () => {
    projectLoaded = false;
    onProjectAndNodeLibraryLoaded();
  },
  null
);

function onProjectAndNodeLibraryLoaded() {
  if (!projectLoaded && NodeLibrary.instance.isLoaded() && ProjectModel.instance) {
    projectLoaded = true;

    // 🚨 IMPORTANT: Only call handlers for 'projectLoaded' event!
    // Other handlers (componentRenamed, nodeAdded, etc.) require event data
    // and should NOT be called during initialization.
    _listenerMap.forEach((listeners) => {
      listeners.forEach(({ event, handler }) => {
        // Only call projectLoaded handlers - they don't require arguments
        if (event === 'projectLoaded') {
          handler();
        }
        // All other events require proper event data and should only be
        // triggered by actual events (component rename, node add, etc.)
      });
    });
  }
}

// Add a new function to register ports for all known node types
function registerCommonPortsForControls() {
  // Control components that need action ports
  const controlNodeTypes = [
    'net.xgenia.controls.button',
    'net.xgenia.controls.textinput',
    'Dropdown',
    'RouterNavigate'
  ];

  // Register ports for each type
  controlNodeTypes.forEach((nodeType) => {
    registerCommonActionPorts(nodeType);
  });
}

// Call this from your initialization
registerCommonPortsForControls();

// Add global test function for debugging
if (typeof window !== 'undefined') {
  (window as any).testRouterNavigateAdapter = function (nodeId: string) {
    const adapter = getNodeTypeAdapter('RouterNavigate');
    if (adapter && adapter.testUpdatePortsForNode) {
      adapter.testUpdatePortsForNode(nodeId);
    } else {
      console.error('RouterNavigateAdapter not found or test method not available');
    }
  };
}
