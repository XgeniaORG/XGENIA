'use strict';

var EventEmitter = require('./events');
var NodeRegister = require('./noderegister');
var TimerScheduler = require('./timerscheduler');
const Variants = require('./variants');

// ---------------------------------------------------------------------------------------
// Dependency-livelock guard (see updateDirtyNodes / _checkForLivelock).
//
// Node.update already catches a node that re-dirties ITSELF within one update — a direct
// wire cycle A -> B -> A, where _updateDependencies pulls A back in synchronously, spins
// the per-node counter to maxUpdateIterations and raises 'cyclic-loop'.
//
// It cannot see a loop that closes OUT OF BAND. A Set Variable and a Variable sharing a
// name are joined by that name, not by a wire, so nothing pulls across it: the Variable's
// 'change' callback flags its output, that queues the consumer, and the consumer runs in
// the NEXT round. Every node runs once per round, ten rounds per frame, and the per-node
// counter resets each frame, so it never reaches the cap. updateDirtyNodes then silently
// truncates at ten rounds and the next frame does it all again. Every node "completes
// successfully" while a renderer core sits at 100% and the editor stops answering. That
// was observed live with eight such loops in one maths component.
//
// So this guard watches the shape the per-node guard cannot: a frame that never converges
// (still dirty after MAX_ROUNDS_PER_FRAME), in which the same nodes ran more than once,
// for LIVELOCK_FRAMES frames in a row. Those nodes are quarantined — no longer re-run —
// which halts the loop, and each gets an error-level, globally shown warning so the top
// bar says exactly which nodes are churning. Any structural or parameter change lifts the
// quarantine so a real fix gets a fresh chance; a non-fix re-warns within three frames.
//
// Relation to the RUNAWAY SIGNAL LOOP guard (connectionSentSignal, key
// 'runaway-signal-loop'): that one measures emission RATE on one output and deliberately
// reports without halting, because a rate threshold is a judgement — a legitimate emitter
// could sit near it. This one halts, and only on proof that the frame cannot finish: the
// iteration cap or the frame budget tripped three frames running, or a thousand values
// queued on one port. Report on suspicion, halt on proof. A single loop may earn both
// warnings; they describe the same fault from two sides.
// ---------------------------------------------------------------------------------------
const MAX_ROUNDS_PER_FRAME = 10;
const LIVELOCK_FRAMES = 3;
const LIVELOCK_WARNING_KEY = 'dependency-livelock';
// Mirrors node.js CYCLIC_FRAMES_BEFORE_HALT for the message text; the livelock test pins them equal.
const CYCLIC_FRAMES_BEFORE_HALT_HINT = 3;
// Wall-clock budget for one frame's synchronous update work. The iteration cap bounds spins,
// not time; one spin draining a runaway queue can take minutes. Past this, Node.update exits
// its loops (via _cyclicLoop) and updateDirtyNodes stops starting rounds, so the browser gets
// control back within about this long no matter what shape the loop is. Overridable per
// context (frameBudgetMs) — tests use a few milliseconds.
const FRAME_BUDGET_MS = 2000;

function NodeContext(args) {
  args = args || {};
  args.runningInEditor = args.hasOwnProperty('runningInEditor') ? args.runningInEditor : false;

  this._dirtyNodes = [];
  this.callbacksAfterUpdate = [];

  // Livelock guard state. _churn maps node -> number of CONSECUTIVE non-converging frames in
  // which it ran more than once; _livelockedNodes is the current quarantine.
  this._saturatedFrames = 0;
  this._churn = new Map();
  this._livelockedNodes = new Set();

  this.graphModel = args.graphModel;

  this.platform = args.platform;

  this.eventEmitter = new EventEmitter();
  this.eventEmitter.setMaxListeners(1000000);

  this.eventSenderEmitter = new EventEmitter(); //used by event senders and receivers
  this.eventSenderEmitter.setMaxListeners(1000000);

  this.globalValues = {};
  this.globalsEventEmitter = new EventEmitter();
  this.globalsEventEmitter.setMaxListeners(1000000);

  this.runningInEditor = args.runningInEditor;
  this.currentFrameTime = 0;
  this.frameNumber = 0;
  this.updateIteration = 0;

  this.nodeRegister = new NodeRegister(this);
  this.timerScheduler = new TimerScheduler(this.scheduleUpdate.bind(this));

  this.componentModels = {};
  this.debugInspectorsEnabled = false;
  this.connectionsToPulse = {};
  this.connectionsToPulseChanged = false;

  this.debugInspectors = {};

  this.connectionPulsingCallbackScheduled = false;

  this.editorConnection = args.editorConnection;

  this.rootComponent = undefined;

  this._outputHistory = {};
  this._signalHistory = {};

  // ── Ordered event timeline (Path B ground-truth for the AI) ──────────────
  // _outputHistory above is a SNAPSHOT (latest value per output.id). It cannot
  // answer "what fired, in what order, with what values?" — the question the AI
  // needs to verify a game actually works. _eventTimeline is the ORDERED record:
  // a bounded ring of every signal-fire and data-write in true execution order,
  // each stamped with a monotonic sequence number. Always-on, cheap, and wrapped
  // so it can never throw into the running graph. See connectionSentValue /
  // connectionSentSignal below for the record sites, and resetEventTimeline /
  // getEventTimeline for the read API the observe_timeline tool calls.
  this._eventTimeline = [];
  this._eventSeq = 0;
  this._eventTimelineMax = 4000; // bounded ring; oldest events drop past this
  this._eventTimelineDropped = 0; // count of events evicted by the ring cap
  this._eventTimelineEnabled = true;

  this.warningTypes = {}; //default is to send all warning types

  this.bundleFetchesInFlight = new Map();

  // Initialize MCP service for runtime nodes
  this.initializeMCPService();

  this.variants = new Variants({
    graphModel: this.graphModel,
    getNodeScope: () => (this.rootComponent ? this.rootComponent.nodeScope : null)
  });

  if (this.editorConnection) {
    this.editorConnection.on('debugInspectorsUpdated', (inspectors) => {
      this.onDebugInspectorsUpdated(inspectors);
    });

    this.editorConnection.on('getConnectionValue', ({ clientId, connectionId }) => {
      if (this.editorConnection.clientId !== clientId) return;
      const connection = this._outputHistory[connectionId];
      this.editorConnection.sendConnectionValue(connectionId, connection ? connection.value : undefined);
    });
  }
}

NodeContext.prototype.setRootComponent = function (rootComponent) {
  this.rootComponent = rootComponent;
};

NodeContext.prototype.getCurrentTime = function () {
  return this.platform.getCurrentTime();
};

NodeContext.prototype.onDebugInspectorsUpdated = function (inspectors) {
  if (!this.debugInspectorsEnabled) return;

  inspectors = inspectors.map((inspector) => {
    if (inspector.type === 'connection') {
      const connection = inspector.connection;
      inspector.id = connection.fromId + connection.fromProperty;
    } else if (inspector.type === 'node') {
      inspector.id = inspector.nodeId;
    }
    return inspector;
  });

  this.debugInspectors = {};
  inspectors.forEach((inspector) => (this.debugInspectors[inspector.id] = inspector));

  this.sendDebugInspectorValues();
};

NodeContext.prototype.updateDirtyNodes = function () {
  var i, len;

  var loop = true,
    iterations = 0;

  this.updateIteration++;

  this.isUpdating = true;
  this._frameStartedAt = Date.now();

  // How many rounds each node was dirty in THIS frame. A converging graph touches each
  // node about once; a node that keeps coming back is either fan-in settling or churn, and
  // _checkForLivelock tells those apart by whether the frame converged at all.
  var roundsDirty = new Map();

  while (loop && iterations < MAX_ROUNDS_PER_FRAME) {
    var dirtyNodes = this._dirtyNodes;
    this._dirtyNodes = [];
    for (i = 0, len = dirtyNodes.length; i < len; ++i) {
      var dirtyNode = dirtyNodes[i];
      roundsDirty.set(dirtyNode, (roundsDirty.get(dirtyNode) || 0) + 1);
      try {
        if (!dirtyNode._deleted) {
          dirtyNode.update();
        }
      } catch (e) {
        console.error(e, e.stack);
      }
    }

    //make a new reference and reset array in case new callbacks are scheduled
    //by the current callbacks
    var callbacks = this.callbacksAfterUpdate;
    this.callbacksAfterUpdate = [];
    for (i = 0, len = callbacks.length; i < len; i++) {
      try {
        callbacks[i]();
      } catch (e) {
        console.error(e);
      }
    }

    loop = this.callbacksAfterUpdate.length > 0 || this._dirtyNodes.length > 0;
    iterations++;

    // Over budget: leave the rest for the next frame rather than starting another round.
    // `loop` stays true, so _checkForLivelock sees a frame that did not converge.
    if (loop && this.updateBudgetExceeded()) break;
  }

  this.isUpdating = false;

  this._checkForLivelock(loop, roundsDirty);
};

/** Has this frame's synchronous update work run past its wall-clock budget? */
NodeContext.prototype.updateBudgetExceeded = function () {
  if (!this._frameStartedAt) return false;
  var budget = typeof this.frameBudgetMs === 'number' ? this.frameBudgetMs : FRAME_BUDGET_MS;
  return Date.now() - this._frameStartedAt > budget;
};

/**
 * Decide whether the frame that just ran is part of a livelock, and quarantine if so.
 *
 * `didNotConverge` is true when work was still pending after MAX_ROUNDS_PER_FRAME rounds.
 * One such frame is normal for a large graph. LIVELOCK_FRAMES in a row, with the SAME
 * nodes running more than once in each, is not — nothing legitimate needs to re-run the
 * same node several times per frame, frame after frame, without ever settling.
 */
NodeContext.prototype._checkForLivelock = function (didNotConverge, roundsDirty) {
  if (!didNotConverge) {
    this._saturatedFrames = 0;
    if (this._churn.size) this._churn.clear();
    return;
  }

  this._saturatedFrames++;

  // Carry a streak only for nodes that churned in this frame too; anyone who settled
  // drops out, so a streak of N means N consecutive churning frames.
  var next = new Map();
  var prev = this._churn;
  roundsDirty.forEach(function (count, node) {
    if (count >= 2 && !node._deleted && !node._livelocked) {
      next.set(node, (prev.get(node) || 0) + 1);
    }
  });
  this._churn = next;

  if (this._saturatedFrames < LIVELOCK_FRAMES) return;

  var culprits = [];
  this._churn.forEach(function (streak, node) {
    if (streak >= LIVELOCK_FRAMES) culprits.push(node);
  });

  if (culprits.length === 0) {
    // Frames are not converging but no node is repeating — a genuinely huge one-off update,
    // or churn spread thinner than this can attribute. Say so once rather than guess.
    if (this._saturatedFrames === LIVELOCK_FRAMES) {
      console.warn(
        '[xgenia] update did not converge for ' + LIVELOCK_FRAMES + ' consecutive frames, but no single node is repeating. ' +
        'The graph may just be very large; if the editor is sluggish, look for an update loop.'
      );
    }
    return;
  }

  culprits.forEach((node) => this.quarantineNode(node, roundsDirty.get(node) || 0, 'churn'));

  // They must not be run again next frame just because they were already queued.
  this._dirtyNodes = this._dirtyNodes.filter(function (n) {
    return !n._livelocked;
  });

  this._saturatedFrames = 0;
  this._churn.clear();
};

/**
 * Stop a node from re-running and tell the editor why, as an error in the global bar.
 *
 * Two callers, two shapes of the same disease:
 *   'cyclic' — Node.update tripped maxUpdateIterations CYCLIC_FRAMES_BEFORE_HALT frames in a
 *              row: a loop that _updateDependencies pulls synchronously into one node's update
 *              (the shape seen in every captured freeze stack).
 *   'churn'  — _checkForLivelock saw the node re-run several times per frame for
 *              LIVELOCK_FRAMES non-converging frames: a loop deferred across rounds that the
 *              per-node counter can never reach.
 *
 * Halting the node IS the protection: its outputs freeze, whatever it fed stops being
 * re-dirtied, and the loop is broken at that link. The warning names the node so a person can
 * find the read-modify-write; the audit tooling names the exact cycle.
 */
NodeContext.prototype.quarantineNode = function (node, measure, reason, portName) {
  if (!node || node._livelocked) return;
  node._livelocked = true;
  node._dirty = false;
  this._livelockedNodes.add(node);

  // Free the backlog. A flooded node was holding hundreds of thousands of queued values; a
  // halted node must not keep them (memory) or drain them if it is later lifted (the loop).
  var queues = node._inputValuesQueue || {};
  Object.keys(queues).forEach(function (k) {
    if (queues[k]) queues[k].length = 0;
  });
  node._inputArrivalOrder = [];
  node._afterInputsHaveUpdatedCallbacks = [];

  var componentName = componentNameOf(node);
  var label = nodeLabelOf(node);
  var budget = typeof this.frameBudgetMs === 'number' ? this.frameBudgetMs : FRAME_BUDGET_MS;
  var how;
  if (reason === 'cyclic') {
    how = 'hit the update-iteration cap (' + measure + ' spins) for ' + CYCLIC_FRAMES_BEFORE_HALT_HINT + ' consecutive frames';
  } else if (reason === 'budget') {
    how = 'kept the update loop busy past the ' + budget + 'ms frame budget for ' + CYCLIC_FRAMES_BEFORE_HALT_HINT + ' consecutive frames';
  } else if (reason === 'queue-overflow') {
    how = 'had ' + measure + ' values queued on input "' + portName + '" within one frame — it is being fed far faster than it can run';
  } else {
    how = 're-ran ' + measure + ' times per frame for ' + LIVELOCK_FRAMES + ' consecutive frames without the graph settling';
  }

  console.error(
    '[xgenia] dependency livelock: node "' + label + '" in ' + componentName + ' ' + how + '. ' +
    'Execution of this node is halted to keep the editor responsive. Look for a read-modify-write that feeds back ' +
    'into it — usually a Variable / Set Variable pair sharing a name, or a data-wire loop.'
  );

  if (
    this.editorConnection &&
    typeof this.editorConnection.sendWarning === 'function' &&
    this.isWarningTypeEnabled('dependencyLivelock')
  ) {
    try {
      this.editorConnection.sendWarning(componentName, node.id, LIVELOCK_WARNING_KEY, {
        level: 'error',
        showGlobally: true,
        message:
          'Update loop: "' + label + '" ' + how + ', so it has been halted to keep the editor responsive. ' +
          'Look for a read-modify-write that feeds back into this node: usually a Variable and Set Variable sharing a name, ' +
          'or a loop of data wires. Changing a connection or a parameter on this node lets it run again.'
      });
    } catch (e) {
      // The report must never be what breaks the frame.
    }
  }
};

/**
 * Lift the quarantine — for one node, or for all of them.
 *
 * Called on any structural change (connection added/removed, node removed) and on a
 * parameter edit to a quarantined node: each is the user acting on the warning, so the
 * node gets a fresh chance.
 *
 * Lifting does NOT replay the backlog. Quarantine emptied the node's queues and a halted node
 * drops input, so a lifted node is simply idle until something triggers it again. That is
 * deliberate: the backlog IS the pathology (hundreds of thousands of queued values in the
 * observed case), and replaying it would re-freeze the editor instantly even if the user had
 * just fixed the loop. When the loop is next exercised and is still broken, it re-quarantines
 * within three frames and the warning comes straight back, which is the right outcome.
 */
NodeContext.prototype.clearLivelockQuarantine = function (onlyNode) {
  var nodes = onlyNode ? [onlyNode] : Array.from(this._livelockedNodes);
  if (nodes.length === 0) return;

  nodes.forEach((node) => {
    if (!node._livelocked) return;
    node._livelocked = false;
    node._cyclicFrames = 0;
    node._lastCyclicIteration = undefined;
    this._livelockedNodes.delete(node);

    if (this.editorConnection && typeof this.editorConnection.clearWarning === 'function') {
      try {
        this.editorConnection.clearWarning(componentNameOf(node), node.id, LIVELOCK_WARNING_KEY);
      } catch (e) {
        /* reporting must not break the edit */
      }
    }

    if (!node._deleted) node.flagDirty();
  });

  this._saturatedFrames = 0;
  this._churn.clear();
};

/**
 * The name a person sees on the canvas. `node.name` is the TYPE ('JavaScriptFunction',
 * 'Set Variable'), which is what the first live warning said — pointing at nothing anyone
 * could find among thirty script nodes. The user's label lives on the model's parameters.
 */
function nodeLabelOf(node) {
  var params = (node && node.model && node.model.parameters) || {};
  return params.label || params.nodeLabel || (node && node.name) || (node && node.id);
}

function componentNameOf(node) {
  var owner = node && node.nodeScope && node.nodeScope.componentOwner;
  return (owner && owner.name) || 'unknown';
}

NodeContext.prototype.update = function () {
  this.frameNumber++;

  this.updateDirtyNodes();

  if (this.timerScheduler.hasPendingTimers()) {
    this.scheduleUpdate();
    this.timerScheduler.runTimers(this.currentFrameTime);
  }

  if (this.debugInspectorsEnabled) {
    this.sendDebugInspectorValues();
  }
};

NodeContext.prototype.reset = function () {
  //removes listeners like device orientation, websockets and more
  this.eventEmitter.emit('applicationDataReloaded');

  var eventEmitter = this.eventEmitter;
  ['frameStart', 'frameEnd'].forEach(function (name) {
    eventEmitter.removeAllListeners(name);
  });

  this.globalValues = {};
  this._dirtyNodes.length = 0;
  this.callbacksAfterUpdate.length = 0;
  this._livelockedNodes.clear();
  this._churn.clear();
  this._saturatedFrames = 0;
  this._frameStartedAt = 0;

  this.timerScheduler.runningTimers = [];
  this.timerScheduler.newTimers = [];
  this.rootComponent = undefined;

  this.clearDebugInspectors();
};

NodeContext.prototype.nodeIsDirty = function (node) {
  // A quarantined node is never re-queued, whatever path asked for it — this is the one
  // choke point every scheduling route passes through (flagDirty, the cyclic-loop
  // rescheduler, direct callers).
  if (node && node._livelocked) return;
  this._dirtyNodes.push(node);
  this.scheduleUpdate();
};

NodeContext.prototype.scheduleUpdate = function () {
  this.eventEmitter.emit('scheduleUpdate');
};

NodeContext.prototype.scheduleAfterUpdate = function (func) {
  this.callbacksAfterUpdate.push(func);
  this.scheduleUpdate();
};

NodeContext.prototype.scheduleNextFrame = function (func) {
  this.eventEmitter.once('frameStart', func);
  this.scheduleUpdate();
};

NodeContext.prototype.setGlobalValue = function (name, value) {
  this.globalValues[name] = value;
  this.globalsEventEmitter.emit(name);
};

NodeContext.prototype.getGlobalValue = function (name) {
  return this.globalValues[name];
};

NodeContext.prototype.registerComponentModel = function (componentModel) {
  if (this.componentModels.hasOwnProperty(componentModel.name)) {
    throw new Error('Duplicate component name ' + componentModel.name);
  }
  this.componentModels[componentModel.name] = componentModel;

  var self = this;
  componentModel.on(
    'renamed',
    function (event) {
      delete self.componentModels[event.oldName];
      self.componentModels[event.newName] = componentModel;
    },
    this
  );
};

NodeContext.prototype.deregisterComponentModel = function (componentModel) {
  if (this.componentModels.hasOwnProperty(componentModel.name)) {
    this.componentModels[componentModel.name].removeListenersWithRef(this);
    delete this.componentModels[componentModel.name];
  }
};

NodeContext.prototype.fetchComponentBundle = async function (name) {
  const fetchBundle = async (name) => {
    // Historically bundles were served from "xgenia_bundles/<id>.json".
    // Stake exports must be fully flat (no folders), so bundles are written at root as "<id>.json".
    // Try legacy path first for backwards compatibility, then fallback to root.
    // Prefer root-level bundles first (Stake exports are fully flat).
    // Fall back to legacy folder structure for older deploys.
    const bundleUrls = [`${name}.json`, `xgenia_bundles/${name}.json`];

    let data = null;
    let lastStatus = null;
    let lastUrl = null;

    for (const bundleUrl of bundleUrls) {
      lastUrl = bundleUrl;
      const response = await fetch(bundleUrl);
      lastStatus = response.status;

      if (response.ok) {
        data = await response.json();
        break;
      }

      if (response.status !== 404) {
        throw new Error(`Failed to fetch bundle ${name} from ${bundleUrl} (status ${response.status})`);
      }
    }

    if (!data) {
      throw new Error(`Component not found ${name} (last tried ${lastUrl}, status ${lastStatus})`);
    }

    for (const component of data) {
      if (this.graphModel.hasComponentWithName(component.name) === false) {
        await this.graphModel.importComponentFromEditorData(component);
      }
    }
  };

  if (this.bundleFetchesInFlight.has(name)) {
    await this.bundleFetchesInFlight.get(name);
  } else {
    const promise = fetchBundle(name);
    this.bundleFetchesInFlight.set(name, promise);
    await promise;
    // The promise is kept in bundleFetchesInFlight to mark which bundles have been downloaded.
    // This way, future requests will just await the resolved promise and resolve immediately.
  }
};

NodeContext.prototype.getComponentModel = async function (name) {
  if (!name) {
    throw new Error('Component instance must have a name');
  }

  if (this.componentModels.hasOwnProperty(name) === false) {
    const bundleName = this.graphModel.getBundleContainingComponent(name);
    if (!bundleName) {
      throw new Error("Can't find component model for " + name);
    }

    //start fetching dependencies in the background
    for (const bundleDep of this.graphModel.getBundleDependencies(bundleName)) {
      this.fetchComponentBundle(bundleDep);
    }

    //and wait for the bundle that has the component we need
    await this.fetchComponentBundle(bundleName);
  }

  return this.componentModels[name];
};

NodeContext.prototype.hasComponentModelWithName = function (name) {
  return this.componentModels.hasOwnProperty(name);
};

NodeContext.prototype.createComponentInstanceNode = async function (componentName, id, nodeScope, extraProps) {
  const ComponentInstanceNode = require('./nodes/componentinstance');

  // Ensure extraProps is not undefined
  extraProps = extraProps || {};

  // Define properties that should NOT be copied to avoid circularity or redundancy
  const excludedProps = [
    'context',
    'nodeRegister',
    'nodeScope',
    'id',
    'name',
    '_dirtyNodes',
    'parentNodeScope',
    'componentModel',
    '_internal',
    'inputs',
    'outputs',
    '_inputs',
    '_outputs',
    '_inputValues',
    '_outputList',
    '_inputConnections',
    'parent'
  ];

  const safeExtraProps = {
    type: componentName,
    props: {},
    children: [],
    style: {},
    className: '',
    id: id
  };

  // Carefully copy properties from extraProps to safeExtraProps
  for (const prop in extraProps) {
    if (excludedProps.includes(prop)) {
      continue;
    }

    if (prop === 'target') {
      // Special handling for target to ensure it's never undefined
      safeExtraProps.target = Object.assign(
        {
          id: id,
          name: componentName,
          type: componentName,
          props: {},
          style: {},
          className: '',
          children: []
        },
        extraProps.target || {}
      );
    } else if (prop === 'source') {
      // Special handling for source to ensure it's never undefined
      const sourceValue = extraProps.source;
      if (sourceValue && typeof sourceValue === 'object') {
        safeExtraProps.source = {
          id: sourceValue.id || id,
          name: sourceValue.name || componentName,
          type: sourceValue.type || componentName
        };
      }
    } else if (prop === '_forEachModel') {
      // Special handling for _forEachModel to preserve Model instances
      safeExtraProps[prop] = extraProps[prop]; // Keep the original Model instance
    } else if (prop === '_forEachNode') {
      // Special handling for _forEachNode to preserve the reference
      safeExtraProps[prop] = extraProps[prop]; // Keep the original reference
    } else {
      // Copy other properties directly
      safeExtraProps[prop] = extraProps[prop];
    }
  }

  try {
    var node = new ComponentInstanceNode(this, id, nodeScope);
    node.name = componentName;

    for (const prop in safeExtraProps) {
      node[prop] = safeExtraProps[prop];
    }

    const componentModel = await this.getComponentModel(componentName); // Potential failure point 1
    await node.setComponentModel(componentModel); // Potential failure point 2

    return node;
  } catch (error) {
    console.error(`[createComponentInstanceNode] Error creating instance for ${componentName} (${id}):`, error.message);
    console.error('[createComponentInstanceNode] Error stack:', error.stack);

    // Create a minimal fallback node as a last resort
    return {
      id: id,
      name: componentName,
      nodeScope: nodeScope,
      context: this,
      _fallbackReason: 'Error in createComponentInstanceNode: ' + error.message,
      inputs: {},
      outputs: {},
      _dirty: false,
      _deleted: false,
      registerInputIfNeeded: function () {},
      registerOutputIfNeeded: function () {},
      connectInput: function () {},
      hasInput: function () {
        return false;
      },
      queueInput: function () {},
      _onNodeDeleted: function () {},
      removeInputConnection: function () {},
      setNodeModel: function () {},
      setVariant: function () {},
      forceUpdate: function () {},
      update: function () {},
      flagDirty: function () {},
      addChild: function () {},
      removeChild: function () {},
      getChildren: function () {
        return [];
      },
      parent: null,
      children: [],
      target: {
        id: id,
        name: componentName,
        type: componentName,
        props: {},
        style: {},
        className: '',
        children: []
      },
      source: {
        id: id,
        name: componentName,
        type: componentName
      }
    };
  }
};

NodeContext.prototype._formatConnectionValue = function (value) {
  if (typeof value === 'object' && value && value.constructor && value.constructor.name === 'Node') {
    value = '<Node> ' + value.name;
  } else if (typeof value === 'object' && typeof window !== 'undefined' && value instanceof HTMLElement) {
    value = `DOM Node <${value.tagName}>`;
  } else if (typeof value === 'string' && !value.startsWith('[Signal]')) {
    return '"' + value + '"';
  } else if (Number.isNaN(value)) {
    return 'NaN';
  }

  return value;
};

// Format a runtime value for the timeline: keep it small, JSON-safe, and never
// throw. Primitives pass through (strings truncated); objects become a compact
// label or a bounded shallow stringify. Mirrors the spirit of
// _formatConnectionValue but is tuned for read-back by the AI tool.
NodeContext.prototype._formatTimelineValue = function (value) {
  try {
    if (value === null) return null;
    const t = typeof value;
    if (t === 'undefined') return undefined;
    if (t === 'boolean') return value;
    if (t === 'number') return Number.isFinite(value) ? value : String(value); // NaN/Infinity → string
    if (t === 'string') return value.length > 200 ? value.slice(0, 200) + '…(' + value.length + ' chars)' : value;
    if (t === 'function') return '<function>';
    if (t === 'object') {
      if (value.constructor && value.constructor.name === 'Node') return '<Node ' + (value.name || value.id || '?') + '>';
      if (typeof window !== 'undefined' && value instanceof HTMLElement) return '<DOM ' + value.tagName + '>';
      if (Array.isArray(value)) {
        try {
          const s = JSON.stringify(value);
          if (s && s.length <= 200) return JSON.parse(s);
        } catch (e) {}
        return '<array len=' + value.length + '>';
      }
      try {
        const s = JSON.stringify(value);
        if (s && s.length <= 200) return JSON.parse(s);
        return '<object ' + (s ? s.length + 'b' : 'unserializable') + '>';
      } catch (e) {
        return '<object>';
      }
    }
    return String(value);
  } catch (e) {
    return '<unserializable>';
  }
};

// Record one ordered timeline event. Called at the TOP of connectionSentValue /
// connectionSentSignal — BEFORE the debug-inspector gate — so the timeline
// captures every fire regardless of whether a debug connection is live. Cheap
// (a few reads + one push) and fully wrapped: a failure here must never disturb
// the running graph.
NodeContext.prototype._recordTimelineEvent = function (output, kind, value, via) {
  if (this._eventTimelineEnabled === false) return;
  try {
    const owner = output && output.owner;
    const targets = [];
    if (output && output.connections && output.connections.forEach) {
      output.connections.forEach((c) => {
        if (c && c.node) targets.push({ nodeId: c.node.id, nodeName: c.node.name, port: c.inputPortName });
      });
    }
    const evt = {
      seq: this._eventSeq++,
      t: this.getCurrentTime(),
      frame: this.frameNumber,
      kind: kind, // 'signal' | 'value'
      nodeId: owner ? owner.id : undefined,
      nodeName: owner ? owner.name : undefined,
      nodeType: owner ? (owner.model && owner.model.type) || owner.type : undefined,
      port: output ? output.name : undefined,
      targetCount: targets.length,
      targets: targets
    };
    if (kind !== 'signal') {
      evt.value = this._formatTimelineValue(value);
    }
    if (via) {
      evt.via = via;
    }
    this._eventTimeline.push(evt);

    // Bounded ring: drop oldest in one amortized splice when we exceed the cap.
    const max = this._eventTimelineMax || 4000;
    if (this._eventTimeline.length > max) {
      const dropCount = this._eventTimeline.length - max;
      this._eventTimeline.splice(0, dropCount);
      this._eventTimelineDropped += dropCount;
    }
  } catch (e) {
    // Swallow: the timeline must never break a running game.
  }
};

// Clear the timeline (the observe_timeline tool calls this before driving an
// interaction so the read captures only that interaction's events). Returns the
// sequence number the next event will get, so a caller can also do a sinceSeq read.
NodeContext.prototype.resetEventTimeline = function () {
  this._eventTimeline = [];
  this._eventTimelineDropped = 0;
  return this._eventSeq;
};

// Read the timeline. opts: { sinceSeq, limit, nodeId, kind }. Returns a plain,
// JSON-safe object (events are already JSON-safe via _formatTimelineValue).
NodeContext.prototype.getEventTimeline = function (opts) {
  opts = opts || {};
  let events = this._eventTimeline || [];
  if (typeof opts.sinceSeq === 'number') {
    events = events.filter((e) => e.seq >= opts.sinceSeq);
  }
  if (opts.nodeId) {
    events = events.filter((e) => e.nodeId === opts.nodeId || (e.targets && e.targets.some((tg) => tg.nodeId === opts.nodeId)));
  }
  if (opts.kind === 'signal' || opts.kind === 'value') {
    events = events.filter((e) => e.kind === opts.kind);
  }
  const total = events.length;
  if (typeof opts.limit === 'number' && opts.limit >= 0 && events.length > opts.limit) {
    events = events.slice(events.length - opts.limit); // keep the most recent `limit`
  }
  return {
    enabled: this._eventTimelineEnabled !== false,
    nextSeq: this._eventSeq,
    droppedFromRing: this._eventTimelineDropped || 0,
    bufferSize: (this._eventTimeline || []).length,
    bufferCap: this._eventTimelineMax || 4000,
    returnedCount: events.length,
    matchedCount: total,
    events: events
  };
};

// Component Inputs and component instances forward a signal across a
// component boundary as TWO plain boolean writes (true, then false) via
// Node.prototype.sendValue — see componentinstance.js
// registerComponentInputPort/setOutputFromComponentOutput and
// componentinputs.js registerOutputIfNeeded. Without this, connectionSentValue
// (below) records both edges as 'value' events and the signal disappears from
// every kind:'signal' timeline read.
//
// ('Component Outputs' never reaches here as an owner at all: componentoutputs.js
// registers only an INPUT (registerInputIfNeeded), never an output, so this
// function and connectionSentValue are never called with that node as
// output.owner — there is deliberately no case for it below.)
//
// The declared port type does NOT reliably live on the Component-Inputs
// node's own model: the editor's exporter only emits node-level `ports` for
// types with exportDynamicPorts (packages/xgenia-editor/src/editor/src/utils/
// exporter/util.ts:16-35 exportPorts; Component Inputs/Outputs are not among
// them), so on real preview data output.owner.model.outputPorts is `{}` and
// the old `owner.model.outputPorts[name]` lookup always missed. The type
// instead has to come from the OWNING component instance's own NodeModel —
// GraphModel._addComponentPorts (models/graphmodel.js:295-311) copies the
// ComponentModel's declared inputPorts/outputPorts onto that instance's
// model — reached the exact way componentinputs.js's own
// registerOutputIfNeeded getter reaches the instance: via
// `owner.nodeScope.componentOwner` (componentinputs.js:31-40, using
// `this.nodeScope.componentOwner._internal.inputValues[name]`; every Node's
// `.nodeScope` is the scope it was created in — nodedefinition.js:415 —
// whose `.componentOwner` is the owning ComponentInstanceNode, nodescope.js:8).
//
// For a component INSTANCE's own output (setOutputFromComponentOutput's
// flagOutputDirty call on the instance itself), `output.owner.model` already
// IS that same populated instance model, so the direct
// `model.outputPorts[name]` lookup is correct and unchanged.
NodeContext.prototype._isBoundarySignalPort = function (output) {
  try {
    const owner = output && output.owner;
    if (!owner) return false;
    const model = owner.model;
    const ownerType = (model && model.type) || owner.type;
    if (typeof ownerType !== 'string' || ownerType.length === 0) return false;
    // A component instance's model.type is the component's path, e.g.
    // '/Components/GremlinGold/Logic' — that's how setOutputFromComponentOutput's
    // flagOutputDirty call (on the instance itself) is told apart from an
    // ordinary node type name.
    const isComponentInstance = ownerType.charAt(0) === '/';
    const isComponentInputs = ownerType === 'Component Inputs';
    if (!isComponentInputs && !isComponentInstance) return false;

    let portDef;
    if (isComponentInputs) {
      const componentOwner = owner.nodeScope && owner.nodeScope.componentOwner;
      const instanceModel = componentOwner && componentOwner.model;
      portDef = instanceModel && instanceModel.inputPorts && instanceModel.inputPorts[output.name];
    } else {
      portDef = model && model.outputPorts && model.outputPorts[output.name];
    }
    if (!portDef) return false;
    const portType = typeof portDef.type === 'object' && portDef.type ? portDef.type.name : portDef.type;
    return portType === 'signal';
  } catch (e) {
    return false;
  }
};

NodeContext.prototype.connectionSentValue = function (output, value) {
  // Ordered ground-truth record (Path B). Skip the synthetic '[Signal] …' value
  // that connectionSentSignal routes through here — that fire is already recorded
  // as a 'signal' event, so recording it again as a 'value' would double-count.
  if (!(typeof value === 'string' && value.indexOf('[Signal]') === 0)) {
    if (typeof value === 'boolean' && this._isBoundarySignalPort(output)) {
      if (value === true) {
        this._recordTimelineEvent(output, 'signal', undefined, 'component-boundary');
      }
      // the falling edge of a boundary-forwarded pulse is not a separate event
    } else {
      this._recordTimelineEvent(output, 'value', value);
    }
  }

  if (!this.editorConnection || !this.editorConnection.isConnected() || !this.debugInspectorsEnabled) {
    return;
  }

  const timestamp = this.getCurrentTime();

  this._outputHistory[output.id] = {
    value,
    timestamp
  };

  if (this.connectionsToPulse.hasOwnProperty(output.id)) {
    this.connectionsToPulse[output.id].timestamp = timestamp;
    return;
  }

  const connections = [];

  output.connections.forEach((connection) => {
    connections.push(output.owner.id + output.name + connection.node.id + connection.inputPortName);
  });

  this.connectionsToPulse[output.id] = {
    timestamp,
    connections: connections
  };

  this.connectionsToPulseChanged = true;

  if (this.connectionPulsingCallbackScheduled === false) {
    this.connectionPulsingCallbackScheduled = true;
    setTimeout(this.clearOldConnectionPulsing.bind(this), 100);
  }
};

NodeContext.prototype.connectionSentSignal = function (output) {
  // Ordered ground-truth record (Path B): a signal fire, recorded before the
  // debug gate so it's captured whether or not a debug connection is live.
  this._recordTimelineEvent(output, 'signal');

  const id = output.id;
  if (!this._signalHistory.hasOwnProperty(id)) {
    this._signalHistory[id] = {
      count: 0
    };
  }

  this._signalHistory[id].count++;

  this.connectionSentValue(output, '[Signal] Trigger count ' + this._signalHistory[id].count);
};

NodeContext.prototype.clearDebugInspectors = function () {
  this.debugInspectors = {};
  this.connectionsToPulse = {};

  this.editorConnection.sendPulsingConnections(this.connectionsToPulse);
};

NodeContext.prototype.clearOldConnectionPulsing = function () {
  this.connectionPulsingCallbackScheduled = false;

  var now = this.getCurrentTime();
  var self = this;

  var connectionIds = Object.keys(this.connectionsToPulse);
  connectionIds.forEach(function (id) {
    var con = self.connectionsToPulse[id];
    if (now - con.timestamp > 100) {
      self.connectionsToPulseChanged = true;
      delete self.connectionsToPulse[id];
    }
  });

  if (this.connectionsToPulseChanged) {
    this.connectionsToPulseChanged = false;
    this.editorConnection.sendPulsingConnections(this.connectionsToPulse);
  }

  if (Object.keys(this.connectionsToPulse).length > 0) {
    this.connectionPulsingCallbackScheduled = true;
    setTimeout(this.clearOldConnectionPulsing.bind(this), 500);
  }
};

NodeContext.prototype._getDebugInspectorValueForNode = function (id) {
  if (!this.rootComponent) return;
  const nodes = this.rootComponent.nodeScope.getNodesWithIdRecursive(id);
  const node = nodes[nodes.length - 1];

  if (node && node.getInspectInfo) {
    const info = node.getInspectInfo();
    if (info !== undefined) {
      return { type: 'node', id, value: info };
    }
  }
};

NodeContext.prototype.sendDebugInspectorValues = function () {
  const valuesToSend = [];

  for (const id in this.debugInspectors) {
    const inspector = this.debugInspectors[id];

    if (inspector.type === 'connection' && this._outputHistory.hasOwnProperty(id)) {
      const value = this._outputHistory[id].value;

      valuesToSend.push({
        type: 'connection',
        id,
        value: this._formatConnectionValue(value)
      });
    } else if (inspector.type === 'node') {
      const inspectorValue = this._getDebugInspectorValueForNode(id);
      inspectorValue && valuesToSend.push(inspectorValue);
    }
  }

  if (valuesToSend.length > 0) {
    this.editorConnection.sendDebugInspectorValues(valuesToSend);
  }

  if (this.connectionsToPulseChanged) {
    this.connectionsToPulseChanged = false;
    this.editorConnection.sendPulsingConnections(this.connectionsToPulse);
  }
};

NodeContext.prototype.setDebugInspectorsEnabled = function (enabled) {
  this.debugInspectorsEnabled = enabled;
  this.editorConnection.debugInspectorsEnabled = enabled;
  if (enabled) {
    this.sendDebugInspectorValues();
  }
};

NodeContext.prototype.sendGlobalEventFromEventSender = function (channelName, inputValues) {
  this.eventSenderEmitter.emit(channelName, inputValues);
};

NodeContext.prototype.setPopupCallbacks = function ({ onShow, onClose }) {
  this.onShowPopup = onShow;
  this.onClosePopup = onClose;
};

/**
 * @param {string} popupComponent
 * @param {Record<string, unknown>} params
 * @param {{
 *  senderNode?: unknown;
 *  onClosePopup?: (action?: string, results: object) => void;
 * }} args
 * @returns
 */
NodeContext.prototype.showPopup = async function (popupComponent, params, args) {
  if (!this.onShowPopup) return;

  const nodeScope = this.rootComponent.nodeScope;

  const popupNode = await nodeScope.createNode(popupComponent);
  for (const inputKey in params) {
    popupNode.setInputValue(inputKey, params[inputKey]);
  }

  popupNode.popupParent = args?.senderNode || null;

  // Create container group
  const group = nodeScope.createPrimitiveNode('Group');
  group.setInputValue('flexDirection', 'node');
  group.setInputValue('cssClassName', 'xgenia-popup');

  const bodyScroll = this.graphModel.getSettings().bodyScroll;

  //if the body can scroll the position of the popup needs to be fixed.
  group.setInputValue('position', bodyScroll ? 'fixed' : 'absolute');

  var closePopupNodes = popupNode.nodeScope.getNodesWithType('NavigationClosePopup');
  if (closePopupNodes && closePopupNodes.length > 0) {
    for (var j = 0; j < closePopupNodes.length; j++) {
      closePopupNodes[j]._setCloseCallback((action, results) => {
        //close next frame so all nodes have a chance to update before being deleted
        this.scheduleNextFrame(() => {
          //avoid double callbacks
          if (!nodeScope.hasNodeWithId(group.id)) return;

          this.onClosePopup(group);
          nodeScope.deleteNode(group);
          args && args.onClosePopup && args.onClosePopup(action, results);
        });
      });
    }
  }

  this.onShowPopup(group);

  requestAnimationFrame(() => {
    //hack to make the react components have the right props
    //TODO: figure out why this requestAnimationFrame is necessary
    group.addChild(popupNode);
  });

  // Return the container so callers can distinguish "the popup actually opened" from the
  // `!this.onShowPopup` early-return above, which also produced `undefined`. NavigationShowPopup
  // uses this to set its `isOpen` output truthfully instead of optimistically. Purely additive —
  // no existing caller reads the return value (showpopup.js `show()`, api/navigation.js).
  return group;
};

NodeContext.prototype.setWarningTypes = function (warningTypes) {
  Object.assign(this.warningTypes, warningTypes);
};

NodeContext.prototype.isWarningTypeEnabled = function (warning) {
  if (!this.warningTypes.hasOwnProperty(warning)) {
    //if a level isn't set, default to true
    return true;
  }

  return this.warningTypes[warning] ? true : false;
};

NodeContext.prototype.getDefaultValueForInput = function (nodeType, inputName) {
  if (this.nodeRegister.hasNode(nodeType) === false) {
    return undefined;
  }

  const nodeMetadata = this.nodeRegister.getNodeMetadata(nodeType);
  const inputMetadata = nodeMetadata.inputs[inputName];

  if (!inputMetadata) {
    return undefined;
  }

  if (inputMetadata.type.defaultUnit) {
    return {
      value: inputMetadata.default,
      unit: inputMetadata.type.defaultUnit
    };
  }

  return inputMetadata.default;
};

// Initialize MCP service for runtime nodes
NodeContext.prototype.initializeMCPService = function () {
  // (2026-08-24) @xgenia/mcp is Electron/Node-only (keytar native dep) and its dist/
  // is not part of the viewer bundle — in a browser this require can NEVER succeed,
  // so the catch below warned "MCP service not available: Cannot find module" on
  // every single viewer boot (debug-export noise that reads like a defect). In the
  // browser, install the inert fallback silently; the renderer path for MCP is the
  // editor preload bridge, not an in-process require.
  // Any window-bearing environment (browser viewer, Electron renderer — where MCP
  // rides the preload bridge instead) gets the fallback without the failed require.
  const inBrowser = typeof window !== 'undefined';
  if (inBrowser) {
    this.mcpService = {
      loadAllMcpServers: () => [],
      getTools: async () => {
        throw new Error('MCP service not available');
      },
      callTool: async () => {
        throw new Error('MCP service not available');
      },
      isServiceReady: () => false
    };
    return;
  }
  try {
    // Try to load the MCP service - handle both development and production
    const { sharedMCPService } = require('@xgenia/mcp');
    this.mcpService = sharedMCPService;
    try { this.mcpService.initialize && this.mcpService.initialize(); } catch (e) {}
    try {
      // Optional: listen for server changes and log; runtime nodes can react if needed
      this.mcpService.onServersChanged && this.mcpService.onServersChanged(() => {
        try { console.log('[NodeContext] MCP servers changed'); } catch (e) {}
      });
    } catch (e) {}
    console.log('[NodeContext] MCP service initialized successfully');
  } catch (error) {
    console.warn('[NodeContext] MCP service not available:', error.message);
    // Create a mock service for graceful degradation
    this.mcpService = {
      loadAllMcpServers: () => [],
      getTools: async () => {
        throw new Error('MCP service not available');
      },
      callTool: async () => {
        throw new Error('MCP service not available');
      },
      isServiceReady: () => false
    };
  }
};

// MCP service accessor for runtime nodes
NodeContext.prototype.getMCPService = function () {
  return this.mcpService;
};

module.exports = NodeContext;
