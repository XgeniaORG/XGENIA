'use strict';

const Model = require('../../../shared/model');
const { EventDispatcher } = require('../../../shared/utils/EventDispatcher');
const JSONStorage = require('../../../shared/utils/jsonstorage');
const { ProjectModel } = require('../models/projectmodel');
const { isEditorCovered } = require('../views/panels/editorCovered');

// --------------------------------------------------------------------
// DebugInspector
// --------------------------------------------------------------------
function DebugInspector() {
  this.connectionsToPulseState = {};
  this.pulseVisibleAt = 0;
  this.pulseVisibleWas = true;

  //Object.keys version of connectionsToPulseState.
  //It's needed every frame when animating so keeping it cached saves some GC cycles
  this.connectionsToPulseIDs = [];
  this.inspectorValues = {};
  this.enabled = true;

  EventDispatcher.instance.on(['viewer-refreshed', 'viewer-closed'], () => this.reset());
}

// (2026-09-17, run 13) A running game pulses its connections continuously, and every pulse
// notification made the node graph repaint EVERY node and wire. rAF runs at the display rate
// (121/s on a ProMotion Mac), so a 100 ms game tick loop cost the editor process 76-88% CPU and
// swung its memory between 0.3 and 1.2 GB (peaks near 2.9 GB); with the pulse repaint
// suppressed the same game ran at 34% CPU and 0.2-0.4 GB. The pulse animation is time-based
// (offset/opacity come from performance.now()), so fewer repaints a second look the same.
//
// (2026-11-09) That throttle fixed the CPU but not the flashing. A repaint of the node graph is a
// paint of the window, and every paint hands macOS a CoreAnimation transaction for every layer in
// it, so 30 notifications a second is 30 whole-window presents a second for as long as a game runs
// — which is what the blinking rides on (same cause as the panel flashing, 2026-11-03). Measured in
// the running editor while a test game played: 30 commits a second with nothing painting anywhere
// but the graph, against 0.2 a second with the game stopped.
//
// So two things changed. The interval went to 100 ms, which still reads as flowing (the dash moves
// 5 px a step) at a third of the transactions. And the loop does not run at all while the graph is
// not on screen: there is nothing to animate behind a full-window panel, on another tab of the
// panel stack, or in a hidden window.
const PULSE_REPAINT_INTERVAL_MS = 100;

/** How long a look at the graph's own geometry is trusted: the check runs on every pulse. */
const PULSE_VISIBILITY_CACHE_MS = 250;

/**
 * Turns the wire animation off outright: `localStorage.xgeniaNoWirePulse = '1'`, then reload. The flow
 * on the wires is the only thing lost, and a running game then costs the window no presents at all.
 * Same shape as `xgeniaDebugWebview` in CanvasView.ts.
 */
function wirePulseTurnedOff() {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('xgeniaNoWirePulse') === '1';
  } catch (e) {
    return false;
  }
}

function generateIdFromConnection(con) {
  return con.fromId + con.fromProperty + con.toId + con.toProperty;
}

/**
 * Whether animating the wires can be seen at all: the window is showing, no full-window plugin panel
 * is over the editor, and the graph canvas has a box on screen. Cached briefly, because a running game
 * asks this as often as it pulses and the answer costs a layout read.
 */
DebugInspector.prototype.isPulseVisible = function () {
  const now = window.performance.now();
  if (now - this.pulseVisibleAt < PULSE_VISIBILITY_CACHE_MS) return this.pulseVisibleWas;
  this.pulseVisibleAt = now;
  this.pulseVisibleWas = (() => {
    if (typeof document === 'undefined') return false;
    if (wirePulseTurnedOff()) return false;
    if (document.visibilityState === 'hidden') return false;
    if (isEditorCovered()) return false;
    const canvas = document.getElementById('nodegraphcanvas');
    if (!canvas) return false;
    // getClientRects() is empty for anything display:none, itself or above it.
    if (canvas.getClientRects().length === 0) return false;
    const rect = canvas.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  })();
  return this.pulseVisibleWas;
};

DebugInspector.prototype.onAnimationFrame = function () {
  // Nothing to look at: drop the animation rather than keep presenting the window for it. The next
  // pulse from a running game starts it again as soon as the graph is back on screen.
  if (!this.isPulseVisible()) {
    this.playPulseAnimation = false;
    this.connectionsToPulseState = {};
    this.connectionsToPulseIDs = [];
    EventDispatcher.instance.notifyListeners('DebugInspectorConnectionPulseChanged');
    return;
  }

  const now = window.performance.now();
  var connectionsRemoved = false;

  this.connectionsToPulseIDs.forEach((id) => {
    const con = this.connectionsToPulseState[id];
    const life = now - con.created;
    con.offset = life / 20;
    con.opacity = Math.min(1, life / 50);

    if (con.removed) {
      const timeRemoved = now - con.removed;
      con.opacity = 1 - timeRemoved / 500;
      if (con.opacity <= 0) {
        connectionsRemoved = true;
        delete this.connectionsToPulseState[id];
      }
    }
  });

  if (connectionsRemoved) {
    this.connectionsToPulseIDs = Object.keys(this.connectionsToPulseState);
  }

  if (this.connectionsToPulseIDs.length === 0) {
    this.playPulseAnimation = false;
  }

  // Always notify on the frame that ends the animation, so the last fade-out is painted.
  if (!this.playPulseAnimation || now - (this.lastPulseNotifyAt || 0) >= PULSE_REPAINT_INTERVAL_MS) {
    this.lastPulseNotifyAt = now;
    EventDispatcher.instance.notifyListeners('DebugInspectorConnectionPulseChanged');
  }

  if (this.playPulseAnimation) {
    window.requestAnimationFrame(this.onAnimationFrame.bind(this));
  }
};

DebugInspector.prototype.startPulseAnimations = function () {
  if (this.playPulseAnimation) {
    return;
  }

  if (!this.isPulseVisible()) {
    return;
  }

  this.playPulseAnimation = true;
  window.requestAnimationFrame(this.onAnimationFrame.bind(this));
};

DebugInspector.prototype.setConnectionsToPulse = function (connections) {
  var self = this;

  var now = window.performance.now();
  var pulsingConnectionIds = {};

  connections.forEach(function (id) {
    pulsingConnectionIds[id] = true;

    if (self.connectionsToPulseState.hasOwnProperty(id) === false) {
      self.connectionsToPulseState[id] = {
        created: now,
        offset: 0,
        opacity: 0,
        removed: false
      };
    } else {
      self.connectionsToPulseState[id].removed = false;
    }
  });

  this.connectionsToPulseIDs = Object.keys(this.connectionsToPulseState);

  this.connectionsToPulseIDs.forEach(function (id) {
    if (pulsingConnectionIds.hasOwnProperty(id) === false && self.connectionsToPulseState[id].removed === false) {
      self.connectionsToPulseState[id].removed = now;
    }
  });

  this.startPulseAnimations();
};

DebugInspector.prototype.reset = function () {
  this.inspectorValues = {};
  this.connectionsToPulseState = {};
  this.connectionsToPulseIDs = [];
  this.playPulseAnimation = false;

  EventDispatcher.instance.notifyListeners('DebugInspectorReset');
};

DebugInspector.prototype.isConnectionPulsing = function (connection) {
  var id = generateIdFromConnection(connection);
  return this.connectionsToPulseState.hasOwnProperty(id);
};

DebugInspector.prototype.getPulseAnimationState = function (connection) {
  var id = generateIdFromConnection(connection);
  return this.connectionsToPulseState[id];
};

DebugInspector.prototype.isEnabled = function () {
  return this.enabled;
};

DebugInspector.prototype.setEnabled = function (enabled) {
  this.enabled = enabled;
  EventDispatcher.instance.notifyListeners('DebugInspectorEnabledChanged');
};

DebugInspector.prototype.setInspectorValues = function (inspectorValues) {
  inspectorValues.forEach((inspectorValue) => {
    this._setInspectorValue(inspectorValue);
  });
};

DebugInspector.prototype._setInspectorValue = function ({ id, value }) {
  this.inspectorValues[id] = value;
  EventDispatcher.instance.notifyListeners('DebugInspectorDataChanged.' + id, { value });
};

DebugInspector.prototype.getConnectionId = function (connection) {
  return connection.fromId + connection.fromProperty;
};

DebugInspector.prototype.valueForNode = function (nodeId) {
  if (this.inspectorValues.hasOwnProperty(nodeId)) {
    return this.inspectorValues[nodeId];
  }
};

DebugInspector.prototype.valueForConnection = function (connection) {
  const id = this.getConnectionId(connection);
  if (this.inspectorValues.hasOwnProperty(id)) {
    return { type: 'value', value: this.inspectorValues[id] };
  }

  //check if this is a signal, and in that case indicate that it hasn't been sent
  const node = ProjectModel.instance.findNodeWithId(connection.fromId);
  if (node === undefined) return;

  const port = node.getPort(connection.fromProperty);
  if (port && port.type === 'signal') {
    return { type: 'value', value: '[Signal] Not triggered' };
  }

  return undefined; //no value found
};

DebugInspector.instance = new DebugInspector();

// --------------------------------------------------------------------
// DebugInspector.InspectorsModel
// --------------------------------------------------------------------
DebugInspector.InspectorsModel = function (args) {
  Model.call(this);

  for (var i in args) this[i] = args[i];

  if (this.inspectors) {
    //update old inspectors that didn't have a type
    this.inspectors.filter((inspector) => !inspector.type).forEach((inspector) => inspector.type === 'connection');
  } else {
    this.inspectors = [];
  }
};

DebugInspector.InspectorsModel.prototype = Object.create(Model.prototype);

DebugInspector.InspectorsModel.prototype.addInspectorForConnection = function (args) {
  var connection = args.connection;

  var inspector = {
    connectionKey: generateIdFromConnection(connection),
    type: 'connection',
    pinned: false,
    position: args.position,
    connection: {
      fromId: connection.fromId,
      fromProperty: connection.fromProperty,
      toId: connection.toId,
      toProperty: connection.toProperty
    }
  };

  this.inspectors.push(inspector);
  this.notifyListeners('inspectorAdded', { model: inspector });
  DebugInspector.InspectorsModel.save();
  return inspector;
};

DebugInspector.InspectorsModel.prototype.addInspectorForNode = function (args) {
  var node = args.node;

  var inspector = { type: 'node', nodeId: node.id, pinned: false, position: args.position };

  this.inspectors.push(inspector);
  this.notifyListeners('inspectorAdded', { model: inspector });
  DebugInspector.InspectorsModel.save();
  return inspector;
};

DebugInspector.InspectorsModel.prototype.removeInspector = function (inspector) {
  var idx = this.inspectors.indexOf(inspector);
  if (idx !== -1) {
    this.inspectors.splice(idx, 1);
    this.notifyListeners('inspectorRemoved', { model: inspector });
    DebugInspector.InspectorsModel.save();
  }
};

DebugInspector.InspectorsModel.prototype.pinInspector = function (inspector) {
  inspector.pinned = true;
  DebugInspector.InspectorsModel.save();
};

DebugInspector.InspectorsModel.prototype.getInspectors = function () {
  return this.inspectors;
};

DebugInspector.InspectorsModel.prototype.toJSON = function () {
  var json = {
    inspectors: this.inspectors
  };
  return json;
};

DebugInspector.InspectorsModel.fromJSON = function (json) {
  return new DebugInspector.InspectorsModel(json);
};

var inspectorsModels = {};
DebugInspector.InspectorsModel.instanceForProject = function (project) {
  if (!inspectorsModels[project.id]) {
    inspectorsModels[project.id] = new DebugInspector.InspectorsModel({});
  }

  return inspectorsModels[project.id];
};

DebugInspector.InspectorsModel.fetch = function () {
  JSONStorage.get('connection-debugger-inspectors', function (local) {
    var models = local['connection-debugger-inspectors'];
    for (var i in models) {
      inspectorsModels[i] = DebugInspector.InspectorsModel.fromJSON(models[i]);
    }
  });
};
DebugInspector.InspectorsModel.fetch();

DebugInspector.InspectorsModel.save = function () {
  var models = {};
  for (var i in inspectorsModels) models[i] = inspectorsModels[i].toJSON();

  JSONStorage.set('debugInspector', { 'debug-inspector-inspectors': models });
};

module.exports = DebugInspector;
