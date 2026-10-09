const OutputProperty = require('./outputproperty');

// How many CONSECUTIVE frames a node may trip maxUpdateIterations before it is halted.
//
// The cap below bounds the spin per frame, not the number of frames. A node that trips it
// used to be rescheduled every frame, indefinitely — which is fine for a glitch that settles,
// and catastrophic for a genuine loop: with a couple of heavy script nodes in the cycle, 100
// spins is a multi-second frame, and back-to-back multi-second frames are a renderer core at
// 100% and an editor that stops answering. Observed live, with a maths component whose
// meter accumulators fed back through variables. Three frames is long enough to be sure it
// is not settling and short enough that the editor comes back within seconds.
const CYCLIC_FRAMES_BEFORE_HALT = 3;

// How many values one input port may hold queued before the node is halted.
//
// queueInput had no bound. In a pulled update cycle every spin appends to downstream queues
// faster than they drain, and each drained entry runs a handler that appends more elsewhere,
// so one outer iteration's cost grows with queue length and the frame never ends. Read off a
// live freeze with the debugger: a Progressive Meter at iteration 0 draining 247,618 queued
// 'add' values, a Set Variable with 4,092 queued 'do' signals, MeterPass's queue growing
// 122 -> 453 in four seconds. maxUpdateIterations never became reachable. No legitimate graph
// queues a thousand values on one port inside a single frame; the first-update coalescing
// above shows the design expects one or two.
const MAX_QUEUED_VALUES_PER_PORT = 1000;

/**
 * Base class for all Nodes
 * @constructor
 */
function Node(context, id) {
  this.id = id;
  this.context = context;
  this._dirty = false;

  this._inputs = {};
  this._inputValues = {};
  this._outputs = {};

  this._inputConnections = {};
  this._outputList = [];
  this._isUpdating = false;
  // Set by NodeContext when this node is part of a dependency livelock; while true the node
  // is never re-queued or re-run. Lifted by any structural change or a parameter edit.
  this._livelocked = false;
  this._inputValuesQueue = {};
  // Input names in the order their queues became non-empty. `update` drains queues in THIS
  // order. It used to iterate Object.keys(_inputValuesQueue), whose order is the order each
  // port was FIRST EVER queued in the node's lifetime (keys are never deleted) — so two
  // signals arriving in one update were processed by port history, not by arrival.
  // See test/signal-arrival-order.test.js for the reels that never stopped because of it.
  this._inputArrivalOrder = [];
  this._afterInputsHaveUpdatedCallbacks = [];

  this._internal = {};
  this._signalsSentThisUpdate = {};

  this._deleted = false;
  this._deleteListeners = [];
  this._isFirstUpdate = true;

  this._valuesFromConnections = {};
  this.updateOnDirtyFlagging = true;
}

Node.prototype.getInputValue = function (name) {
  return this._inputValues[name];
};

Node.prototype.registerInput = function (name, input) {
  if (this.hasInput(name)) {
    throw new Error('Input property ' + name + ' already registered');
  }

  this._inputs[name] = input;

  if (input.type && input.type.units) {
    const defaultUnit = input.type.defaultUnit || input.type.units[0];
    this._inputValues[name] = {
      value: input.default,
      type: defaultUnit
    };
  } else if (input.hasOwnProperty('default')) {
    this._inputValues[name] = input.default;
  }
};

Node.prototype.deregisterInput = function (name) {
  if (this.hasInput(name) === false) {
    throw new Error('Input property ' + name + " doesn't exist");
  }
  delete this._inputs[name];
  delete this._inputValues[name];
};

Node.prototype.registerInputs = function (inputs) {
  for (const name in inputs) {
    this.registerInput(name, inputs[name]);
  }
};

Node.prototype.getInput = function (name) {
  if (this.hasInput(name) === false) {
    console.log('Node ' + this.name + ': Invalid input property ' + name);
    return undefined;
  }

  return this._inputs[name];
};

Node.prototype.hasInput = function (name) {
  return name in this._inputs;
};

Node.prototype.registerInputIfNeeded = function () {
  //noop, can be overriden by subclasses
};

Node.prototype.setInputValue = function (name, value) {
  const input = this.getInput(name);
  if (!input) {
    console.log("node doesn't have input", name);
    return;
  }

  //inputs with units always expect objects in the shape of {value, unit, ...}
  //these inputs might sometimes get raw numbers without units, and in those cases
  //XGENIA should just update the value and not the other parameters
  const currentInputValue = this._inputValues[name];

  if (isNaN(value) === false && currentInputValue && currentInputValue.unit) {
    //update the value, and keep the other parameters
    const newValue = Object.assign({}, currentInputValue); //copy it, so we don't modify the original object (e.g. it might come from a variant)
    newValue.value = value;
    value = newValue;
  }

  //Save the current input value. Save it before resolving color styles so delta updates on color styles work correctly
  this._inputValues[name] = value;

  if (input.type === 'color' && this.context && this.context.styles) {
    value = this.context.styles.resolveColor(value);
  } else if (input.type === 'array' && typeof value === 'string') {
    try {
      value = eval(value);
      this.context.editorConnection.clearWarning(this.nodeScope.componentOwner.name, this.id, 'invalid-array-' + name);
    } catch (e) {
      value = [];
      console.log(e);
      if (this.context.editorConnection) {
        this.context.editorConnection.sendWarning(
          this.nodeScope.componentOwner.name,
          this.id,
          'invalid-array-' + name,
          {
            showGlobally: true,
            message: 'Invalid array<br>' + e.toString()
          }
        );
      }
    }
  }

  input.set.call(this, value);
};

Node.prototype.hasOutput = function (name) {
  return name in this._outputs;
};

Node.prototype.registerOutput = function (name, output) {
  if (this.hasOutput(name)) {
    throw new Error('Output property ' + name + ' already registered');
  }

  const newOutput = new OutputProperty({
    owner: this,
    getter: output.get || output.getter,
    name: name,
    onFirstConnectionAdded: output.onFirstConnectionAdded,
    onLastConnectionRemoved: output.onLastConnectionRemoved
  });

  this._outputs[name] = newOutput;
  this._outputList.push(newOutput);
  this._signalsSentThisUpdate[name] = false;
};

Node.prototype.deregisterOutput = function (name) {
  if (this.hasOutput(name) === false) {
    throw new Error('Output property ' + name + " isn't registered");
  }

  const output = this._outputs[name];

  if (output.hasConnections()) {
    throw new Error('Output property ' + name + " has connections and can't be removed");
  }

  delete this._outputs[name];
  var index = this._outputList.indexOf(output);
  this._outputList.splice(index, 1);
};

Node.prototype.registerOutputs = function (outputs) {
  for (var name in outputs) {
    this.registerOutput(name, outputs[name]);
  }
};

Node.prototype.registerOutputIfNeeded = function () {
  //noop, can be overriden by subclasses
};

Node.prototype.getOutput = function (name) {
  if (this.hasOutput(name) === false) {
    throw new Error('Node ' + this.name + " doesn't have a port named " + name);
  }
  return this._outputs[name];
};

Node.prototype.connectInput = function (inputName, sourceNode, sourcePortName) {
  // FIX (2026-03-10): Case-insensitive port name fallback.
  // Editor stores connections with display name casing (e.g. "Do", "Done")
  // but some nodes register ports with lowercase names (e.g. "do", "done").
  if (this.hasInput(inputName) === false) {
    var resolved = inputName;
    // Try lowercase first char (Do → do)
    var lower = inputName.charAt(0).toLowerCase() + inputName.slice(1);
    if (this.hasInput(lower)) {
      resolved = lower;
    } else {
      // Try uppercase first char (do → Do)
      var upper = inputName.charAt(0).toUpperCase() + inputName.slice(1);
      if (this.hasInput(upper)) {
        resolved = upper;
      } else {
        // Full case-insensitive scan of all registered inputs
        var lowerInput = inputName.toLowerCase();
        for (var key in this._inputs) {
          if (key.toLowerCase() === lowerInput) {
            resolved = key;
            break;
          }
        }
      }
    }
    if (resolved !== inputName && this.hasInput(resolved)) {
      console.debug('[Node.connectInput] Resolved port "' + inputName + '" → "' + resolved + '" on ' + this.name);
      inputName = resolved;
    }
  }
  if (this.hasInput(inputName) === false) {
    throw new Error(
      "Invalid connection, input doesn't exist. Trying to connect from " +
      sourceNode.name +
      ' output ' +
      sourcePortName +
      ' to ' +
      this.name +
      ' input ' +
      inputName
    );
  }

  var sourcePort;
  try {
    sourcePort = sourceNode.getOutput(sourcePortName);
  } catch (e) {
    // (2026-09-09) Mirror the case-insensitive fallback the INPUT side has had since
    // 2026-03-10. A wire saved as `done` against an output really named `Done` used to
    // die here as a console.warn and a silently dropped connection — the graph looked
    // correct and nothing ever fired ("wired but nothing happens"). Resolve by
    // first-character case, then a whole-name case-insensitive match; an exact match
    // above always wins, so a node that really has both `Do` and `do` is untouched.
    var resolvedOutput = null;
    if (sourceNode._outputs && typeof sourcePortName === 'string' && sourcePortName.length > 0) {
      var lowerFirst = sourcePortName.charAt(0).toLowerCase() + sourcePortName.slice(1);
      var upperFirst = sourcePortName.charAt(0).toUpperCase() + sourcePortName.slice(1);
      if (lowerFirst !== sourcePortName && sourceNode.hasOutput(lowerFirst)) resolvedOutput = lowerFirst;
      else if (upperFirst !== sourcePortName && sourceNode.hasOutput(upperFirst)) resolvedOutput = upperFirst;
      else {
        var lowerOutput = sourcePortName.toLowerCase();
        for (var outKey in sourceNode._outputs) {
          if (outKey.toLowerCase() === lowerOutput) {
            resolvedOutput = outKey;
            break;
          }
        }
      }
    }
    if (resolvedOutput !== null) {
      console.debug('[Node.connectInput] Resolved output "' + sourcePortName + '" → "' + resolvedOutput + '" on ' + sourceNode.name);
      sourcePortName = resolvedOutput;
      sourcePort = sourceNode.getOutput(sourcePortName);
    } else {
      // Source node may not have the output registered yet (e.g. fallback nodes)
      console.warn('[Node.connectInput] Source node "' + sourceNode.name + '" has no output "' + sourcePortName + '": ' + e.message);
      return;
    }
  }
  if (!sourcePort || typeof sourcePort.registerConnection !== 'function') {
    // Fallback nodes may return null or a plain value instead of an OutputProperty
    console.warn('[Node.connectInput] Cannot register connection: sourcePort "' + sourcePortName + '" on "' + sourceNode.name + '" is not a valid OutputProperty');
    return;
  }
  sourcePort.registerConnection(this, inputName);

  if (!this._inputConnections[inputName]) {
    this._inputConnections[inputName] = [];
  }

  this._inputConnections[inputName].push(sourcePort);

  if (sourceNode._signalsSentThisUpdate[sourcePortName]) {
    this._setValueFromConnection(inputName, true);
    this._setValueFromConnection(inputName, false);
  } else {
    var outputValue = sourcePort.value;
    if (outputValue !== undefined) {
      this._setValueFromConnection(inputName, outputValue);

      if (this.context) {
        // Send value to editor for connection debugging.
        // Conceptually the value has already been sent,
        // but the editor needs to be notified after a connection is created
        this.context.connectionSentValue(sourcePort, sourcePort.value);
      }
    }
  }

  this.flagDirty();
};

Node.prototype.removeInputConnection = function (inputName, sourceNodeId, sourcePortName) {
  if (!this._inputConnections[inputName]) {
    throw new Error("Node removeInputConnection: Input doesn't exist");
  }

  const inputsToPort = this._inputConnections[inputName];

  for (let i = 0; i < inputsToPort.length; i++) {
    const sourcePort = inputsToPort[i];
    if (sourcePort.owner.id === sourceNodeId && sourcePort.name === sourcePortName) {
      inputsToPort.splice(i, 1);

      //remove the output from the source node
      let output;
      try {
        output = sourcePort.owner.getOutput(sourcePortName);
      } catch (e) {
        console.warn('[Node.removeInputConnection] getOutput failed for "' + sourcePortName + '": ' + e.message);
        break;
      }
      if (output && typeof output.deregisterConnection === 'function') {
        output.deregisterConnection(this, inputName);
      }
      break;
    }
  }

  if (inputsToPort.length === 0) {
    //no inputs left, remove the bookkeeping that traces values sent to this node as inputs
    delete this._valuesFromConnections[inputName];
  }
};

Node.prototype.isInputConnected = function (inputName) {
  if (!this._inputConnections.hasOwnProperty(inputName)) {
    return false;
  }

  //We have connections, but they might be from non-connected component inputs.
  // If they are from a component input then check the input on the component instance.
  return this._inputConnections[inputName].some((c) => {
    //if this is not a component input, then we have a proper connection
    if (c.owner.name !== 'Component Inputs') return true;

    //the name of the output from the component input, is the same as the component instance input
    const component = c.owner.nodeScope.componentOwner;
    return component.isInputConnected(c.name);
  });
};

Node.prototype.update = function () {
  if (this._isUpdating || this._dirty === false || this._livelocked) {
    return;
  }

  if (this._updatedAtIteration !== this.context.updateIteration) {
    this._updatedAtIteration = this.context.updateIteration;
    this._updateIteration = 0;
    if (this._cyclicLoop) this._cyclicLoop = false;
    this._budgetTripped = false;
  }

  // The frame budget is the bound the iteration cap cannot give: the cap counts outer
  // iterations, but a single iteration draining a runaway queue can take minutes. Tripping
  // here reuses the existing _cyclicLoop exits in both loops, so the frame ends, the browser
  // gets control back, and the node is rescheduled — and it counts toward the same
  // consecutive-frame streak as an iteration-cap trip, so a heavy one-off (a big project
  // loading) is tolerated while a loop that stays over budget is halted after three frames.
  const overBudget = () =>
    typeof this.context.updateBudgetExceeded === 'function' && this.context.updateBudgetExceeded();

  this._isUpdating = true;
  const maxUpdateIterations = 100;

  try {
    while (this._dirty && !this._cyclicLoop) {
      if (overBudget()) {
        // Yield, do not stop: stay dirty so the reschedule below actually resumes this node
        // next frame. Without it the break can land after `_dirty = false`, the node returns
        // at once next frame, and the loop dies silently with values stranded in its queue.
        this._cyclicLoop = true;
        this._budgetTripped = true;
        this._dirty = true;
        break;
      }
      this._updateDependencies();

      //all inputs are now updated, flag as not dirty
      this._dirty = false;

      let hasMoreInputs = true;

      while (hasMoreInputs && !this._cyclicLoop) {
        if (overBudget()) {
          this._cyclicLoop = true;
          this._budgetTripped = true;
          this._dirty = true; // see the outer check: yield and resume, not stop
          break;
        }
        hasMoreInputs = false;

        // Drain one value per pending port, in ARRIVAL order. Take the list, then rebuild it
        // from whatever is still (or newly) pending, so a port with more values keeps its
        // place and anything queued by a setter during this pass lands behind it.
        const inputNames = this._inputArrivalOrder;
        this._inputArrivalOrder = [];
        const stillPending = [];
        for (let i = 0; i < inputNames.length; i++) {
          const inputName = inputNames[i];
          const queue = this._inputValuesQueue[inputName];
          if (queue && queue.length > 0) {
            this.setInputValue(inputName, queue.shift());
            if (queue.length > 0) {
              stillPending.push(inputName);
            }
          }
        }
        // Ports with values left keep their relative order; ports first queued during this
        // pass (by a setter or a dependency update) go behind them.
        const queuedDuringPass = this._inputArrivalOrder.filter((n) => stillPending.indexOf(n) === -1);
        this._inputArrivalOrder = stillPending.concat(queuedDuringPass);
        if (this._inputArrivalOrder.length > 0) {
          hasMoreInputs = true;
        }

        const afterInputCallbacks = this._afterInputsHaveUpdatedCallbacks;
        this._afterInputsHaveUpdatedCallbacks = [];
        for (let i = 0; i < afterInputCallbacks.length; i++) {
          afterInputCallbacks[i].call(this);
        }
      }
      this._updateIteration++;

      if (this._updateIteration >= maxUpdateIterations) {
        this._cyclicLoop = true; // Set cyclic loop flag in the Node, not OutputProperty
      }
    }
  } catch (e) {
    this._isUpdating = false;
    throw e;
  }

  if (this._cyclicLoop) {
    // A tripped node's update() is re-entered many times in the same frame — once for every
    // dirty entry queued while it was spinning — and each re-entry exits the while above at
    // once and lands here. So this block must act ONCE per frame: otherwise the streak below
    // resets itself on every re-entry (a streak that can never reach 2), and the reschedule
    // is registered hundreds of times, so the next frame starts with hundreds of queued
    // updates for the same node. That second effect predates the streak and is its own
    // amplifier: a cyclic loop got heavier every frame it survived.
    const iteration = this.context.updateIteration;
    if (this._cyclicHandledAtIteration !== iteration) {
      this._cyclicHandledAtIteration = iteration;

      // Consecutive-frame bookkeeping: a trip in the frame right after the last trip extends
      // the streak; anything else starts it over. updateIteration advances once per frame.
      this._cyclicFrames = this._lastCyclicIteration === iteration - 1 ? (this._cyclicFrames || 0) + 1 : 1;
      this._lastCyclicIteration = iteration;

      if (this._cyclicFrames >= CYCLIC_FRAMES_BEFORE_HALT && typeof this.context.quarantineNode === 'function') {
        // Not settling. Halt it and say so as an error, rather than spinning another frame.
        this.context.quarantineNode(this, this._updateIteration, this._budgetTripped ? 'budget' : 'cyclic');
      } else {
        //flag the node as dirty again to let it contiune next frame so we don't just stop it
        //This will allow the browser a chance to render and run other code
        this.context.scheduleNextFrame(() => {
          this.context.nodeIsDirty(this);
        });
      }
    }

    // A budget trip is not evidence of a cycle — a large graph can simply be slow once — so it
    // does not earn the 'Cyclic loop detected' warning; the streak decides what it is.
    if (
      !this._budgetTripped &&
      this.context.editorConnection &&
      !this._cyclicWarningSent &&
      this.context.isWarningTypeEnabled('cyclicLoops')
    ) {
      this.context.editorConnection.sendWarning(this.nodeScope.componentOwner.name, this.id, 'cyclic-loop', {
        showGlobally: true,
        message: 'Cyclic loop detected'
      });
      this._cyclicWarningSent = true;
      console.log('cycle detected', {
        id: this.id,
        name: this.name,
        component: this.nodeScope.componentOwner.name
      });
    }
  }

  this._isFirstUpdate = false;
  this._isUpdating = false;
};

Node.prototype._updateDependencies = function () {
  for (var inputName in this._inputConnections) {
    var connectedPorts = this._inputConnections[inputName];
    for (var i = 0; i < connectedPorts.length; ++i) {
      var owner = connectedPorts[i].owner;
      if (owner && !owner._deleted && typeof owner.update === 'function') {
        owner.update();
      }
    }
  }
};

Node.prototype.flagDirty = function () {
  // Quarantined by the livelock guard: stay quiet until something changes. See
  // NodeContext._checkForLivelock for why re-running here would just churn again.
  if (this._livelocked) {
    return;
  }
  if (this._dirty) {
    return;
  }

  this._dirty = true;

  //a hack to not update nodes as a component is being created.
  //Nodes should update once all connections are in place, so inputs that rely on connections, e.g. "Run" on a Function node, have the correct context before running.
  //This flag is being updated externally by the NodeScope and _performDirtyUpdate will be called when the component setup is done
  if (this.updateOnDirtyFlagging) {
    this._performDirtyUpdate();
  }
};

Node.prototype._performDirtyUpdate = function () {
  this.context && this.context.nodeIsDirty(this);

  for (var i = 0; i < this._outputList.length; ++i) {
    this._outputList[i].flagDependeesDirty();
  }
};

Node.prototype.sendValue = function (name, value) {
  if (this.hasOutput(name) === false) {
    console.log('Error: Node', this.name, "doesn't have a output named", name);
    return;
  }

  if (value === undefined) {
    return;
  }

  const output = this.getOutput(name);
  output.sendValue(value);

  if (this.context) {
    this.context.connectionSentValue(output, value);
  }
};

Node.prototype.flagOutputDirty = function (name) {
  const output = this.getOutput(name);
  this.sendValue(name, output.value);
};

Node.prototype.flagAllOutputsDirty = function () {
  for (const output of this._outputList) {
    this.sendValue(output.name, output.value);
  }
};

Node.prototype.sendSignalOnOutput = function (outputName) {
  if (this.hasOutput(outputName) === false) {
    console.log('Error: Node', this.name, "doesn't have a output named", outputName);
    return;
  }

  const output = this.getOutput(outputName);
  output.sendValue(true);
  output.sendValue(false);

  this._signalsSentThisUpdate[outputName] = true;
  this.scheduleAfterInputsHaveUpdated(function () {
    this._signalsSentThisUpdate[outputName] = false;
  });

  if (this.context) {
    this.context.connectionSentSignal(output);
  }
};

Node.prototype._setValueFromConnection = function (inputName, value) {
  this._valuesFromConnections[inputName] = value;
  this.queueInput(inputName, value);
};

Node.prototype._hasInputBeenSetFromAConnection = function (inputName) {
  return this._valuesFromConnections.hasOwnProperty(inputName);
};

Node.prototype.queueInput = function (inputName, value) {
  // A halted node accepts nothing: its queues were emptied when it was quarantined, and
  // refilling them would only rebuild the backlog that got it halted. A parameter edit lifts
  // the quarantine BEFORE it queues (see _onNodeModelParameterUpdated), so edits still land.
  if (this._livelocked) {
    return;
  }
  if (!this._inputValuesQueue[inputName]) {
    this._inputValuesQueue[inputName] = [];
  }

  //when values are queued during the very first update, make the last value overwrite previous ones
  //so a chain with multiple nodes with values that connect to each other all
  //consolidate to a single value, instead of piling up in the queue
  if (this._isFirstUpdate) {
    //signals need two values, so make sure we don't suppress the 'false' that comes directly
    //after a 'true'
    const queueValue = this._inputValuesQueue[inputName][0];
    const isSignal = queueValue === true; // && value === true;
    if (!isSignal) {
      //default units are set as an object {value, unit}
      //subsequent inputs can be unitless. and will will then overwrite those
      //and the node will get a value without ever getting a unit.
      //To make sure that doesn't happen, look at the value being overwritten
      //and use the unit from that before overwriting
      if (queueValue instanceof Object && queueValue.unit && value instanceof Object === false) {
        value = {
          value,
          unit: queueValue.unit
        };
      }

      this._inputValuesQueue[inputName].length = 0;
    }
  }

  // Record arrival the moment a queue goes from empty to non-empty. A port already pending
  // keeps its place; a port whose queue drained and is queued again goes to the back.
  // (First-update coalescing above can empty a queue that is still listed, so test the list,
  // not the length.)
  if (this._inputArrivalOrder.indexOf(inputName) === -1) {
    this._inputArrivalOrder.push(inputName);
  }
  this._inputValuesQueue[inputName].push(value);

  if (
    this._inputValuesQueue[inputName].length > MAX_QUEUED_VALUES_PER_PORT &&
    this.context &&
    typeof this.context.quarantineNode === 'function'
  ) {
    // Being fed far faster than it can run: halt it here, before the drain loop has to
    // process a backlog that grows while it drains. quarantineNode empties the queues.
    this.context.quarantineNode(this, this._inputValuesQueue[inputName].length, 'queue-overflow', inputName);
    return;
  }

  this.flagDirty();
};

Node.prototype.scheduleAfterInputsHaveUpdated = function (callback) {
  this._afterInputsHaveUpdatedCallbacks.push(callback);
  this.flagDirty();
};

Node.prototype.setNodeModel = function (nodeModel) {
  this.model = nodeModel;
  nodeModel.on('parameterUpdated', this._onNodeModelParameterUpdated, this);
  nodeModel.on('variantUpdated', this._onNodeModelVariantUpdated, this);

  nodeModel.on(
    'inputPortRemoved',
    (port) => {
      if (this.hasInput(port.name)) {
        this.deregisterInput(port.name);
      }
    },
    this
  );

  nodeModel.on(
    'outputPortRemoved',
    (port) => {
      if (this.hasOutput(port.name)) {
        this.deregisterOutput(port.name);
      }
    },
    this
  );
};

Node.prototype.addDeleteListener = function (listener) {
  this._deleteListeners.push(listener);
};

Node.prototype._onNodeDeleted = function () {
  if (this.model) {
    this.model.removeListenersWithRef(this);
    this.model = undefined;
  }

  this._deleted = true;

  for (const deleteListener of this._deleteListeners) {
    deleteListener.call(this);
  }
};

Node.prototype._onNodeModelParameterUpdated = function (event) {
  // A parameter edit on a quarantined node is the user acting on the livelock warning, and
  // queueInput below ends in flagDirty, which the quarantine would swallow — so lift it
  // FIRST or the fix could never take effect.
  if (this._livelocked && this.context && typeof this.context.clearLivelockQuarantine === 'function') {
    this.context.clearLivelockQuarantine(this);
  }
  this.registerInputIfNeeded(event.name);

  if (event.value !== undefined) {
    if (event.state) {
      //this parameter is only used in a certain visual state
      //make sure we are in that state before setting it

      if (!this._getVisualStates) {
        console.log('Node has nos visual states, but got a parameter for state', event.state);
        return;
      }

      const states = this._getVisualStates();
      if (states.indexOf(event.state) !== -1) {
        this.queueInput(event.name, event.value);
      }
    } else {
      this.queueInput(event.name, event.value);
    }
  } else {
    //parameter is undefined, that means it has been removed and we should reset to default
    let defaultValue;

    const variant = this.variant;

    if (event.state) {
      //local value has been reset, check the variant first
      if (
        variant &&
        variant.stateParameters.hasOwnProperty(event.state) &&
        variant.stateParameters[event.state].hasOwnProperty(event.name)
      ) {
        defaultValue = variant.stateParameters[event.state][event.name];
      }
      //and if variant has no value in that state, check for local values in the neutral state
      else if (this.model.parameters.hasOwnProperty(event.name)) {
        defaultValue = this.model.parameters[event.name];
      }
      //and then look in the variant neutral values
      else if (variant && variant.parameters.hasOwnProperty(event.name)) {
        defaultValue = variant.parameters[event.name];
      }
    } else if (variant && variant.parameters.hasOwnProperty(event.name)) {
      defaultValue = variant.parameters[event.name];
    }

    if (defaultValue === undefined) {
      //get the default value for the port
      defaultValue = this.context.getDefaultValueForInput(this.model.type, event.name);

      //when a paramter that's used by a text style is reset, XGENIA will modify the original dom node, outside of React
      //React will then re-render, and should apply the values from the text style, but won't see any delta in the virtual dom,
      //even though there is a diff to the real dom.
      //to fix that, we just force React to re-render the entire node
      this._resetReactVirtualDOM && this._resetReactVirtualDOM();
    }

    this.queueInput(event.name, defaultValue);
  }
};

Node.prototype._onNodeModelVariantUpdated = function (variant) {
  this.setVariant(variant);
};

module.exports = Node;
