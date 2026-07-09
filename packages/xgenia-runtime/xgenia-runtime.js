'use strict';

const NodeContext = require('./src/nodecontext');
const EditorConnection = require('./src/editorconnection');
const generateNodeLibrary = require('./src/nodelibraryexport');
const ProjectSettings = require('./src/projectsettings');
const GraphModel = require('./src/models/graphmodel');
const NodeDefinition = require('./src/nodedefinition');
const Node = require('./src/node');
const EditorModelEventsHandler = require('./src/editormodeleventshandler');
const Services = require('./src/services/services');
const EdgeTriggeredInput = require('./src/edgetriggeredinput');

const EventEmitter = require('./src/events');
const asyncPool = require('./src/async-pool');
const ExternalModuleLoader = require('./src/external-module-loader');

function registerNodes(xgeniaRuntime) {
  // eslint-disable-next-line
  [
    require('./src/nodes/componentinputs'),
    require('./src/nodes/componentoutputs'),

    require('./src/nodes/std-library/runtasks'),

    // Data
    require('./src/nodes/std-library/data/restnode'),
    // Data
    require('./src/nodes/std-library/data/restnode'),

    // Aggregator (Compile feature)
    require('./src/nodes/std-library/data/aggregatornode'),

    // Slot Games moved to private module (@xgenia/pro-nodes)

    // Custom code
    require('./src/nodes/std-library/expression'),
    require('./src/nodes/std-library/simplejavascript'),

    // Records
    require('./src/nodes/std-library/data/dbcollectionnode2'),
    require('./src/nodes/std-library/data/dbmodelnode2'),
    require('./src/nodes/std-library/data/setdbmodelpropertiesnode'),
    require('./src/nodes/std-library/data/deletedbmodelpropertiesnode'),
    require('./src/nodes/std-library/data/newdbmodelpropertiesnode'),
    require('./src/nodes/std-library/data/dbmodelnode-addrelation'),
    require('./src/nodes/std-library/data/dbmodelnode-removerelation'),
    require('./src/nodes/std-library/data/filterdbmodelsnode'),

    // Object
    require('./src/nodes/std-library/data/modelnode2'),
    require('./src/nodes/std-library/data/setmodelpropertiesnode'),
    require('./src/nodes/std-library/data/newmodelnode'),

    // Cloud
    require('./src/nodes/std-library/data/cloudfilenode'),
    require('./src/nodes/std-library/data/dbconfig'),
    require('./src/nodes/std-library/data/getplayeridbyname'),
    require('./src/nodes/std-library/data/listgamesessions'),
    require('./src/nodes/std-library/data/savegamesession'),
    require('./src/nodes/std-library/data/loadgamesession'),
    require('./src/nodes/std-library/data/depositbalance'),
    require('./src/nodes/std-library/data/withdrawbalance'),
    require('./src/nodes/std-library/convertInputsIntoRecord'),
    require('./src/nodes/std-library/convertRecordIntoOutputs'),
    require('./src/nodes/std-library/convertToString'),

    // Variables
    require('./src/nodes/std-library/variables/number'),
    require('./src/nodes/std-library/variables/string'),
    require('./src/nodes/std-library/variables/boolean'),

    // Math nodes moved to private module (@xgenia/pro-nodes/maths)
    // - editor/viewer/deploy register them via the external module loader
    // - the cloud runtime registers them directly (see xgenia-viewer-cloud)

    // Utils
    require('./src/nodes/std-library/condition'),
    require('./src/nodes/std-library/if'),
    require('./src/nodes/std-library/and'),
    require('./src/nodes/std-library/or'),
    require('./src/nodes/std-library/booleantostring'),
    require('./src/nodes/std-library/datetostring'),
    require('./src/nodes/std-library/loop'),
    require('./src/nodes/std-library/inverter'),
    require('./src/nodes/std-library/signalpassthrough'),
    require('./src/nodes/std-library/booleanToSignal'),
    require('./src/nodes/std-library/stringmapper'),
    require('./src/nodes/std-library/substring'),
    require('./src/nodes/std-library/stringformat'),
    require('./src/nodes/std-library/counter'),
    require('./src/nodes/std-library/uniqueid'),
    require('./src/nodes/std-library/writeToJson'),
    require('./src/nodes/std-library/importFromJsonFile'),
    require('./src/nodes/std-library/convertDictKeysToPorts'),
    require('./src/nodes/std-library/stateManager'),
    require('./src/nodes/std-library/arrayStateManager'),

    // // Animation
    // require('./src/nodes/std-library/animation'),

    // User
    require('./src/nodes/std-library/user/setuserproperties'),
    require('./src/nodes/std-library/user/user'),

    require('./src/nodes/std-library/mcp/mcp-tool-node')
  ].forEach((node) => xgeniaRuntime.registerNode(node));
}

function xgeniaRuntime(args) {
  args = args || {};
  args.platform = args.platform || {};
  xgeniaRuntime.instance = this;

  // Single source of truth for runtime discovery. Without this, AI tools
  // (read-viewer-port-value, discoverAndReadViewerPorts) have to guess where the
  // runtime lives — see the BUG 72 comment in that file. Setting it here means
  // every viewer entry (react, cloud, deploy) gets it for free.
  if (typeof window !== 'undefined') {
    window.XGENIA = window.XGENIA || {};
    window.XGENIA._runtime = this;
    window.XgeniaRuntime = xgeniaRuntime;
  }

  this.type = args.type || 'browser';
  this.xgeniaModules = [];
  this.eventEmitter = new EventEmitter();
  this.updateScheduled = false;
  this.rootComponent = null;
  this._currentLoadedData = null;
  this.isWaitingForExport = true;
  this.graphModel = new GraphModel();
  this.errorHandlers = [];
  this.frameNumber = 0;
  this.dontCreateRootComponent = !!args.dontCreateRootComponent;
  this.componentFilter = args.componentFilter;

  this.runningInEditor = args.runDeployed ? false : true;

  this.platform = {
    requestUpdate: args.platform.requestUpdate,
    getCurrentTime: args.platform.getCurrentTime,
    webSocketOptions: args.platform.webSocketOptions,
    objectToString: args.platform.objectToString
  };

  if (!args.platform.requestUpdate) {
    throw new Error('platform.requestUpdate must be set');
  }

  if (!args.platform.getCurrentTime) {
    throw new Error('platform.getCurrentTime must be set');
  }

  //Create an editor connection even if we're running deployed.
  //If won't connect and act as a "noop" in deployed mode,
  // and reduce the need for lots of if(editorConnection)
  this.editorConnection = new EditorConnection({
    platform: args.platform,
    runtimeType: this.type
  });

  this.context = new NodeContext({
    runningInEditor: args.runDeployed ? false : true,
    editorConnection: this.editorConnection,
    platform: this.platform,
    graphModel: this.graphModel
  });

  this.context.eventEmitter.on('scheduleUpdate', this.scheduleUpdate.bind(this));

  if (!args.runDeployed) {
    this._setupEditorCommunication(args);
  }

  this.registerGraphModelListeners();

  registerNodes(this);

  // Initialize external module loader to check for proprietary nodes
  ExternalModuleLoader.initialize();

  // Register any already loaded external modules
  ExternalModuleLoader.getRegisteredModules().forEach((module) => {
    this.registerModule(module);
  });

  // Listen for future module registrations
  ExternalModuleLoader.onModuleRegistered((module) => {
    this.registerModule(module);
  });
}

xgeniaRuntime.prototype.prefetchBundles = async function (bundleNames, numParallelFetches) {
  await asyncPool(numParallelFetches, bundleNames, async (name) => {
    await this.context.fetchComponentBundle(name);
  });
};

xgeniaRuntime.prototype._setupEditorCommunication = function (args) {
  function objectEquals(x, y) {
    if (x === null || x === undefined || y === null || y === undefined) {
      return x === y;
    }
    if (x === y) {
      return true;
    }
    if (Array.isArray(x) && x.length !== y.length) {
      return false;
    }

    // if they are strictly equal, they both need to be object at least
    if (!(x instanceof Object)) {
      return false;
    }
    if (!(y instanceof Object)) {
      return false;
    }

    // recursive object equality check
    var p = Object.keys(x);
    return (
      Object.keys(y).every(function (i) {
        return p.indexOf(i) !== -1;
      }) &&
      p.every(function (i) {
        return objectEquals(x[i], y[i]);
      })
    );
  }

  this.editorConnection.on('exportDataFull', async (exportData) => {
    if (this.graphModel.isEmpty() === false) {
      this.reload();
      return;
    }

    this.isWaitingForExport = false;
    if (objectEquals(this._currentLoadedData, exportData) === false) {
      if (this.componentFilter) {
        exportData.components = exportData.components.filter((c) => this.componentFilter(c));
      }

      await this.setData(exportData);

      //get the rest of the components
      //important to get all the dynamic ports evaluated
      if (exportData.componentIndex && this.type !== 'cloud') {
        const allBundles = Object.keys(exportData.componentIndex);
        await this.prefetchBundles(allBundles, 2);
      } else if (this.type === 'cloud') {
        console.log('[XgeniaRuntime] Cloud runtime - skipping bundle prefetch');
      }

      console.log('[XgeniaRuntime] Emitting editorImportComplete');
      this.graphModel.emit('editorImportComplete');
    }
  });

  this.editorConnection.on('reload', this.reload.bind(this));
  this.editorConnection.on('modelUpdate', this.onModelUpdateReceived.bind(this));
  this.editorConnection.on('metadataUpdate', this.onMetaDataUpdateReceived.bind(this));

  // 🔧 AI Signal Simulation - trigger signals on runtime nodes
  this.editorConnection.on('triggerSignal', (args) => {
    const { nodeId, portName, data } = args;
    console.log('[XgeniaRuntime] Received triggerSignal:', nodeId, portName, data);

    // Use the correct method to find nodes - via rootComponent's nodeScope
    let node = null;
    if (this.rootComponent && this.rootComponent.nodeScope) {
      const nodes = this.rootComponent.nodeScope.getNodesWithIdRecursive(nodeId);
      node = nodes && nodes.length > 0 ? nodes[0] : null;
    }

    if (node) {
      console.log('[XgeniaRuntime] Found node:', node.name || node.id);
      // Try various trigger methods
      if (typeof node.sendSignalOnOutput === 'function') {
        node.sendSignalOnOutput(portName);
        console.log('[XgeniaRuntime] Signal triggered via sendSignalOnOutput');
      } else if (typeof node.triggerOutput === 'function') {
        node.triggerOutput(portName, data);
        console.log('[XgeniaRuntime] Signal triggered via triggerOutput');
      } else if (node.outputs && node.outputs[portName] && typeof node.outputs[portName].trigger === 'function') {
        node.outputs[portName].trigger(data);
        console.log('[XgeniaRuntime] Signal triggered via output.trigger');
      } else if (typeof node.emit === 'function') {
        node.emit(portName, data);
        console.log('[XgeniaRuntime] Signal triggered via emit');
      } else {
        console.warn('[XgeniaRuntime] No trigger method found for node:', nodeId, 'port:', portName);
        console.log('[XgeniaRuntime] Available methods:', Object.keys(node).filter(k => typeof node[k] === 'function'));
      }
    } else {
      console.warn('[XgeniaRuntime] Node not found for signal trigger:', nodeId);
    }
  });

  this.editorConnection.on('connected', () => {
    this.sendNodeLibrary();
  });
};

xgeniaRuntime.prototype.setDebugInspectorsEnabled = function (enabled) {
  this.context.setDebugInspectorsEnabled(enabled);
};

xgeniaRuntime.prototype._registerNodeFromDefinition = function (nodeDef, moduleName) {
  const isDebugMode = false; // Set to true for detailed node registration logging

  if (isDebugMode)
    console.log(
      `[xgeniaRuntime] _registerNodeFromDefinition processing nodeDef:`,
      nodeDef,
      `from module: ${moduleName}`
    );
  try {
    let nodeToRegister = nodeDef;
    // Ensure it's an object and potentially wrap it
    if (typeof nodeToRegister !== 'object' || nodeToRegister === null) {
      console.warn('[xgeniaRuntime] Skipping invalid node definition in _registerNodeFromDefinition:', nodeToRegister);
      return; // Skip this iteration
    }

    // Get the core node object
    const nodeObject = nodeToRegister.node || nodeToRegister;
    nodeObject.module = moduleName || 'Unknown Module'; // Use passed module name
    if (isDebugMode)
      console.log(
        `[xgeniaRuntime] nodeObject prepared for NodeDefinition.defineNode:`,
        JSON.parse(JSON.stringify(nodeObject))
      );

    // Wrap the processed nodeObject for registerNode
    const wrappedDefinition = {
      node: nodeObject,
      setup: nodeToRegister.setup // Carry over setup from the original nodeDef object
    };

    if (isDebugMode)
      console.log(
        `[xgeniaRuntime] Calling this.registerNode with wrappedDefinition:`,
        JSON.parse(JSON.stringify(wrappedDefinition))
      );
    this.registerNode(wrappedDefinition); // Call the main registerNode
  } catch (e) {
    console.error(
      `[xgeniaRuntime] !!! Error processing node ${nodeDef?.name || 'unknown'} in _registerNodeFromDefinition:`,
      e
    );
  }
};

xgeniaRuntime.prototype.registerModule = function (moduleDefinition) {
  const isDebugMode = false; // Set to true for detailed module registration logging

  if (moduleDefinition && moduleDefinition.name) {
    if (isDebugMode) console.log(`[xgeniaRuntime] Registering module: ${moduleDefinition.name}`);
    this.xgeniaModules.push(moduleDefinition);

    // == Eagerly register nodes from this module ==
    console.log(`[xgeniaRuntime] Eagerly processing nodes for module: ${moduleDefinition.name}`);

    // Access nodes property (could be a getter)
    let nodes = null;
    try {
      nodes = moduleDefinition.nodes;
      console.log(`[xgeniaRuntime] Module "${moduleDefinition.name}" nodes property type:`, typeof nodes, 'isArray:', Array.isArray(nodes), 'length:', nodes ? (Array.isArray(nodes) ? nodes.length : 'N/A') : 'null/undefined');
    } catch (e) {
      console.error(`[xgeniaRuntime] Error accessing nodes property:`, e);
    }

    if (nodes && Array.isArray(nodes)) {
      console.log(`[xgeniaRuntime] Registering ${nodes.length} nodes from module "${moduleDefinition.name}"`);
      for (let i = 0; i < nodes.length; i++) {
        const nodeDef = nodes[i];
        console.log(`[xgeniaRuntime] Registering node ${i + 1}/${nodes.length}: ${nodeDef?.name || 'unnamed'}`);
        // Use the internal helper function to register the node
        this._registerNodeFromDefinition(nodeDef, moduleDefinition.name);
      }
      if (isDebugMode)
        console.log(`[xgeniaRuntime] Finished eager node registration for module: ${moduleDefinition.name}`);
    } else {
      console.warn(
        `[xgeniaRuntime] Module ${moduleDefinition.name} has invalid or missing 'nodes' array during eager registration.`,
        'Nodes value:', nodes,
        'Type:', typeof nodes,
        'IsArray:', Array.isArray(nodes)
      );
    }

    // == Call module setup function after nodes are registered ==
    if (typeof moduleDefinition.setup === 'function') {
      if (isDebugMode)
        console.log(`[xgeniaRuntime] Calling setup for module during registration: ${moduleDefinition.name}`);
      // Ensure setup gets the correct context and graphModel if needed
      // Assuming 'this.context' and 'this.graphModel' are available here
      try {
        moduleDefinition.setup(this.context, this.graphModel);
      } catch (e) {
        console.error(
          `[xgeniaRuntime] Error calling setup function for module ${moduleDefinition.name} during registration:`,
          e
        );
      }
    }
    // ===============================================
  } else {
    console.warn('[xgeniaRuntime] registerModule called with invalid definition. Not pushed.');
  }
};

xgeniaRuntime.prototype.registerGraphModelListeners = function () {
  var self = this;

  this.graphModel.on(
    'componentAdded',
    function (component) {
      self.context.registerComponentModel(component);
    },
    this
  );

  this.graphModel.on(
    'componentRemoved',
    function (component) {
      self.context.deregisterComponentModel(component);
    },
    this
  );
};

xgeniaRuntime.prototype.reload = function () {
  location.reload();
};

xgeniaRuntime.prototype.registerNode = function (nodeDefinition) {
  // Expects wrapped { node: ..., setup: ... } for modules now
  const isDebugMode = false; // Set to true for detailed node registration logging

  if (isDebugMode) console.log(`[xgeniaRuntime] registerNode called for:`, nodeDefinition);
  let definitionToRegister;
  let setupFn = nodeDefinition.setup; // Get setup from the wrapper
  let nodeObject;
  let nodeName = 'unknown';

  // Case 1: Handle built-ins (passed as function)
  if (typeof nodeDefinition === 'function') {
    // ... (Keep existing logic for function type) ...
    definitionToRegister = nodeDefinition;
    nodeName = definitionToRegister.node?.name || definitionToRegister.name || 'unknown function';
    setupFn = setupFn || definitionToRegister.setup || definitionToRegister.node?.setup;
  }
  // Case 2: Handle modules (passed as wrapped object)
  else if (nodeDefinition && typeof nodeDefinition === 'object' && nodeDefinition.node) {
    // Check for .node property explicitly
    nodeObject = nodeDefinition.node; // Get the inner node object
    nodeName = nodeObject.name || 'unknown object';
    // setupFn is already extracted from the wrapper

    if (!nodeObject.name) {
      console.warn(`[xgeniaRuntime] Node object missing name in registerNode:`, nodeObject);
    }

    // Process the inner node object through defineNode.
    try {
      if (isDebugMode) console.log(`[xgeniaRuntime] Calling NodeDefinition.defineNode for: ${nodeName}`, nodeObject);
      definitionToRegister = NodeDefinition.defineNode(nodeObject);
      if (isDebugMode)
        console.log(`[xgeniaRuntime] NodeDefinition.defineNode successful for: ${nodeName}`, definitionToRegister);
      // If defineNode added metadata/setup, prefer that for setupFn?
      // Original code didn't seem to do this, let's stick to wrapper setupFn for now.
      // setupFn = definitionToRegister.setup || setupFn;
    } catch (e) {
      console.error(`[xgeniaRuntime] !!! Error calling NodeDefinition.defineNode for ${nodeName}:`, e);
      console.warn(`[xgeniaRuntime] Cannot register node ${nodeName} due to defineNode error.`);
      return; // Don't fallback for module definitions if defineNode fails
      // definitionToRegister = nodeObject; // Original didn't seem to fallback here
    }
  }
  // Case 3: Handle direct registration (e.g., from registerNodes) - should be function already?
  else if (typeof nodeDefinition === 'object' && nodeDefinition !== null && !nodeDefinition.node) {
    if (isDebugMode)
      console.warn(
        '[xgeniaRuntime] registerNode called with plain object but no .node property. Registering directly, but might be unexpected.',
        nodeDefinition
      );
    // Attempt to define and register directly
    try {
      nodeObject = nodeDefinition;
      nodeName = nodeObject.name || 'unknown object';
      definitionToRegister = NodeDefinition.defineNode(nodeObject);
      setupFn = setupFn || nodeObject.setup;
    } catch (e) {
      console.error('[xgeniaRuntime] Error trying to defineNode for plain object:', e);
      return;
    }
  }
  // Case 4: Invalid input
  else {
    console.error('[xgeniaRuntime] registerNode called with invalid definition type:', nodeDefinition);
    return;
  }

  // Register the result (should be a function/constructor wrapper)
  if (typeof definitionToRegister !== 'function') {
    console.error(`[xgeniaRuntime] definitionToRegister is not a function for ${nodeName}:`, definitionToRegister);
    return; // Cannot register if not a function
  }
  if (isDebugMode) console.log(`[xgeniaRuntime] Registering final definition with nodeRegister for: ${nodeName}`);
  this.context.nodeRegister.register(definitionToRegister);

  // Handle dynamic ports using metadata from the registered definition
  const metadata = definitionToRegister?.metadata; // Use metadata from defineNode result
  if (metadata && metadata.setupNumberedInputDynamicPorts) {
    if (isDebugMode) console.log(`[xgeniaRuntime] Setting up dynamic ports for ${nodeName}`);
    metadata.setupNumberedInputDynamicPorts(this.context, this.graphModel);
  }

  // Call the setup function extracted earlier (likely from the wrapper for modules)
  // Note: Setup functions are called during registration, so they should not rely on 'this' being a node instance
  // If a setup function needs node instance context, it should be handled in the node's initialize method instead
  if (setupFn) {
    if (isDebugMode) console.log(`[xgeniaRuntime] Calling setup function for ${nodeName}`);
    try {
      setupFn(this.context, this.graphModel);
    } catch (e) {
      console.warn(`[xgeniaRuntime] Setup function failed for ${nodeName} (this is OK if setup needs node instance context):`, e.message);
      // Don't fail registration if setup fails - some nodes may handle setup in initialize() instead
    }
  }
};

xgeniaRuntime.prototype._setRootComponent = async function (rootComponentName) {
  console.log('[xgeniaRuntime] _setRootComponent called with:', rootComponentName);

  if (this.rootComponent && this.rootComponent.name === rootComponentName) {
    console.log('[xgeniaRuntime] Root component already set to:', rootComponentName);
    return;
  }

  if (this.rootComponent) {
    console.log('[xgeniaRuntime] Removing existing root component:', this.rootComponent.name);
    this.rootComponent.model && this.rootComponent.model.removeListenersWithRef(this);
    this.rootComponent = undefined;
  }

  if (rootComponentName) {
    console.log('[xgeniaRuntime] Creating root component:', rootComponentName);
    this.rootComponent = await this.context.createComponentInstanceNode(rootComponentName, 'rootComponent');
    console.log('[xgeniaRuntime] Root component created successfully:', !!this.rootComponent);

    this.rootComponent.componentModel.on('rootAdded', () => this.eventEmitter.emit('rootComponentUpdated'), this);
    this.rootComponent.componentModel.on('rootRemoved', () => this.eventEmitter.emit('rootComponentUpdated'), this);

    console.log('[xgeniaRuntime] Setting root component in context');
    this.context.setRootComponent(this.rootComponent);
    console.log('[xgeniaRuntime] Root component set in context successfully');
  }

  console.log('[xgeniaRuntime] Emitting rootComponentUpdated event');
  this.eventEmitter.emit('rootComponentUpdated');
};

xgeniaRuntime.prototype.setData = async function (graphData) {
  // Added for SSR Support
  // In SSR, we re-load the graphData and when we render the componet it will
  // invoke this method again, which will cause a duplicate node exception.
  // To avoid this, we flag the runtime to not load again.
  if (this._disableLoad) return;

  // Ensure graphData is an object
  graphData = graphData || {};

  this._currentLoadedData = graphData;
  await this.graphModel.importEditorData(graphData);

  // Run setup on all modules
  for (const module of this.xgeniaModules) {
    typeof module.setup === 'function' && module.setup.apply(module);
  }

  if (this.dontCreateRootComponent !== true) {
    await this._setRootComponent(this.graphModel.rootComponent);

    //listen to delta updates on the root component
    this.graphModel.on('rootComponentNameUpdated', (name) => {
      this._setRootComponent(name);
    });

    //check if the root component was deleted
    this.graphModel.on('componentRemoved', (componentModel) => {
      if (this.rootComponent && this.rootComponent.name === componentModel.name) {
        this._setRootComponent(null);
      }
    });

    //check if the root component was added when it previously didn't exist (e.g. when user deletes it and then hits undo)
    this.graphModel.on('componentAdded', (componentModel) => {
      setTimeout(() => {
        if (!this.rootComponent && this.graphModel.rootComponent === componentModel.name) {
          const isDebugMode = false; // Set to true for detailed component logging
          if (isDebugMode) console.log(componentModel.name);
          this._setRootComponent(componentModel.name);
        }
      }, 1);
    });
  }

  this.scheduleUpdate();
};

xgeniaRuntime.prototype.scheduleUpdate = function () {
  if (this.updateScheduled) {
    return;
  }

  this.updateScheduled = true;
  this.platform.requestUpdate(xgeniaRuntime.prototype._doUpdate.bind(this));
};

xgeniaRuntime.prototype._doUpdate = function () {
  this.updateScheduled = false;

  this.context.currentFrameTime = this.platform.getCurrentTime();

  this.context.eventEmitter.emit('frameStart');

  this.context.update();

  this.context.eventEmitter.emit('frameEnd');

  this.frameNumber++;
};

xgeniaRuntime.prototype.setProjectSettings = function (settings) {
  this.projectSettings = settings;
};

xgeniaRuntime.prototype.getNodeLibrary = function () {
  const isDebugMode = false; // Set to true for detailed node library logging

  if (isDebugMode) console.log('[xgeniaRuntime] getNodeLibrary called.');

  // Add log here to check the length before processing
  // console.log(`[xgeniaRuntime DEBUG] Checking this.xgeniaModules.length before processing: ${this.xgeniaModules ? this.xgeniaModules.length : 'undefined'}`);

  // Process modules ONLY IF they haven't been processed yet for this instance
  // We add a flag to prevent re-processing on subsequent calls within the same runtime instance.
  if (!this._modulesProcessedForNodeLib) {
    if (isDebugMode)
      console.log('[xgeniaRuntime] Marking modules as processed for node library (nodes/setup now handled eagerly).');
    this._modulesProcessedForNodeLib = true; // Mark as processed
  } else {
    if (isDebugMode) console.log('[xgeniaRuntime] Modules already processed for node library generation.');
  }

  var projectSettings = ProjectSettings.generateProjectSettings(this.graphModel.getSettings(), this.xgeniaModules);

  if (this.projectSettings) {
    this.projectSettings.ports && (projectSettings.ports = projectSettings.ports.concat(this.projectSettings.ports));
    this.projectSettings.dynamicports &&
      (projectSettings.dynamicports = projectSettings.ports.concat(this.projectSettings.dynamicports)); // Typo fixed: should be dynamicports
  }

  var nodeLibrary = generateNodeLibrary(this.context.nodeRegister);
  nodeLibrary.projectsettings = projectSettings;
  // Use JSON.stringify with a replacer to handle potential circular structures if needed
  // For now, stick to simple stringify, but be aware
  return JSON.stringify(nodeLibrary, null, 3);
};

xgeniaRuntime.prototype.sendNodeLibrary = function () {
  const isDebugMode = false; // Set to true for detailed node library logging

  if (isDebugMode) console.log('[xgeniaRuntime] sendNodeLibrary called.');
  const nodeLibrary = this.getNodeLibrary(); // This now includes module processing
  if (this.lastSentNodeLibrary !== nodeLibrary) {
    if (isDebugMode) console.log('[xgeniaRuntime] Node library changed, sending update to editor.');
    this.lastSentNodeLibrary = nodeLibrary;
    this.editorConnection.sendNodeLibrary(nodeLibrary);
  } else {
    if (isDebugMode) console.log('[xgeniaRuntime] Node library unchanged, not sending update.');
  }
};

xgeniaRuntime.prototype.connectToEditor = function (address) {
  this.editorConnection.connect(address);
};

xgeniaRuntime.prototype.onMetaDataUpdateReceived = function (event) {
  if (!this.graphModel.isEmpty()) {
    EditorMetaDataEventsHandler.handleEvent(this.context, this.graphModel, event);
  }
};

xgeniaRuntime.prototype.onModelUpdateReceived = async function (event) {
  if (this.isWaitingForExport) {
    return;
  }

  if (event.type === 'projectInstanceChanged') {
    this.reload();
  }
  //wait for data to load before applying model changes
  else if (this.graphModel.isEmpty() === false) {
    await EditorModelEventsHandler.handleEvent(this.context, this.graphModel, event);
  }
};

xgeniaRuntime.prototype.addErrorHandler = function (callback) {
  this.errorHandlers.push(callback);
};

xgeniaRuntime.prototype.reportError = function (message) {
  this.errorHandlers.forEach(function (eh) {
    eh(message);
  });
};

xgeniaRuntime.prototype.getProjectSettings = function () {
  return this.graphModel.getSettings();
};

xgeniaRuntime.prototype.getMetaData = function (key) {
  return this.graphModel.getMetaData(key);
};

xgeniaRuntime.Services = Services;
xgeniaRuntime.Node = Node;
xgeniaRuntime.NodeDefinition = NodeDefinition;
xgeniaRuntime.EdgeTriggeredInput = EdgeTriggeredInput;

module.exports = xgeniaRuntime;
