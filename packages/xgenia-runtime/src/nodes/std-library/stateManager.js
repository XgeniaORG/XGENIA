'use strict';

const Model = require('../../model');

const StateManagerNode = {
  name: 'stateManager',
  displayNodeName: 'State Manager',
  docs: 'https://docsapp.xgenia.com/nodes/utilities/logic/statemanager',
  shortDesc: 'Accept dynamic inputs and output their values when update signal is triggered.',
  category: 'Logic',

  initialize: function () {
    this._internal.inputValues = {};
    this._internal.outputValues = {};
    this._internal.aliases = {};
    this._internal.stateObject = null;
  },

  getInspectInfo() {
    const numInputs = this._internal.numInputs || 3;
    const aliasCount = Object.keys(this._internal.aliases || {}).length;
    return `Dynamic inputs: ${numInputs}, Aliases: ${aliasCount}`;
  },

  inputs: {
    update: {
      type: 'signal',
      displayName: 'Update',
      group: 'Control',
      valueChangedToTrue: function () {
        this.performUpdate();
      }
    },
    reset: {
      type: 'signal',
      displayName: 'Reset',
      group: 'Control',
      valueChangedToTrue: function () {
        this.performReset();
      }
    },
    numInputs: {
      type: 'number',
      displayName: 'Number of Inputs',
      group: 'Configuration',
      default: 3,
      set: function (value) {
        const numInputs = Math.max(0, Math.floor(value || 0));
        this._internal.numInputs = numInputs;
      }
    }
  },

  outputs: {
    updated: {
      type: 'signal',
      displayName: 'Updated',
      group: 'Control'
    },
    'Reset Done': {
      type: 'signal',
      displayName: 'Reset Done',
      group: 'Control'
    },
    stateObject: {
      type: 'object',
      displayName: 'State Object',
      group: 'Combined Output',
      getter: function () {
        return this._internal.stateObject;
      }
    },
    objectId: {
      type: 'string',
      displayName: 'Object ID',
      group: 'Combined Output',
      getter: function () {
        return this._internal.stateObject ? this._internal.stateObject.getId() : null;
      }
    }
  },

  prototypeExtensions: {
    registerInputIfNeeded: function (name) {
      if (this.hasInput(name)) return;

      if (name.startsWith('input')) {
        this.registerInput(name, {
          type: '*', // Accept any type
          displayName: name.replace('input', 'Input '),
          group: 'Inputs',
          set: function (value) {
            this._internal.inputValues[name] = value;
          }
        });
      } else if (name.startsWith('alias')) {
        // Handle dynamic alias inputs
        this.registerInput(name, {
          type: 'string',
          displayName: name.replace('alias', 'Alias '),
          group: 'Aliases',
          default: '',
          set: function (value) {
            // Store the alias value in internal state
            this._internal.aliases[name] = value || '';

            // NOTE: We do NOT call this.setParameter() here because
            // setParameter is only available in the editor context (NodeGraphModel),
            // not in the runtime context. The alias is stored internally and
            // the port update is triggered by the parameterUpdated event in the setup function.
          }
        });
      }
    },

    registerOutputIfNeeded: function (name) {
      if (this.hasOutput(name)) return;

      if (name.startsWith('output')) {
        this.registerOutput(name, {
          type: '*', // Output any type
          displayName: name.replace('output', 'Output '),
          group: 'Outputs',
          getter: function () {
            const inputName = name.replace('output', 'input');
            return this._internal.outputValues[inputName];
          }
        });
      }
    },

    generateRandomId: function () {
      return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    },

    performUpdate: function () {
      const internal = this._internal;
      const numInputs = internal.numInputs || 3;

      // Copy current input values to output values (for backward compatibility)
      for (let i = 0; i < numInputs; i++) {
        const inputName = `input${i}`;
        const outputName = `output${i}`;

        const inputValue = internal.inputValues[inputName];
        internal.outputValues[inputName] = inputValue;

        // Flag corresponding output as dirty
        if (this.hasOutput(outputName)) {
          this.flagOutputDirty(outputName);
        }
      }

      // Create the combined state object data
      const stateObjectData = {
        timestamp: new Date().toISOString()
      };

      // Add input values to state object with aliases if defined
      for (let i = 0; i < numInputs; i++) {
        const inputName = `input${i}`;
        const aliasName = `alias${i}`;
        const inputValue = internal.inputValues[inputName];

        // Get the alias value from internal state
        const aliasValue = internal.aliases[aliasName];

        // Use the alias value if it exists and is not empty, otherwise fall back to a default name
        let keyName;
        if (aliasValue && aliasValue.trim() !== '') {
          keyName = aliasValue;
        } else {
          // If no custom alias, use a more descriptive default
          keyName = `input${i}`;
        }

        // Only add to state object if the input has a value (not undefined)
        if (inputValue !== undefined) {
          stateObjectData[keyName] = inputValue;
        }
      }

      // Create a Model object and store it in the registry
      const modelScope = this.nodeScope && this.nodeScope.modelScope ? this.nodeScope.modelScope : Model;
      internal.stateObject = modelScope.create(stateObjectData);

      this.flagOutputDirty('stateObject');
      this.flagOutputDirty('objectId');

      // Send updated signal
      this.sendSignalOnOutput('updated');
    },

    performReset: function () {
      const internal = this._internal;
      const numInputs = internal.numInputs || 3;

      // Clear all dynamic output values (but do not alter aliases / display names)
      for (let i = 0; i < numInputs; i++) {
        const inputName = `input${i}`;
        const outputName = `output${i}`;
        internal.outputValues[inputName] = null;
        if (this.hasOutput(outputName)) {
          this.flagOutputDirty(outputName);
        }
      }

      // Clear combined outputs
      internal.stateObject = null;
      this.flagOutputDirty('stateObject');
      this.flagOutputDirty('objectId');

      // Emit Reset Done signal
      if (this.hasOutput('Reset Done')) this.sendSignalOnOutput('Reset Done');
    }
  }
};

function updatePorts(nodeId, parameters, editorConnection) {
  const numInputs = Math.max(0, Math.floor(parameters.numInputs || 3));
  const ports = [];

  // Include static inputs so they are not removed by dynamic port updates
  ports.push(
    {
      type: 'signal',
      plug: 'input',
      group: 'Control',
      name: 'update',
      displayName: 'Update'
    },
    {
      type: 'signal',
      plug: 'input',
      group: 'Control',
      name: 'reset',
      displayName: 'Reset'
    },
    {
      type: 'number',
      plug: 'input',
      group: 'Configuration',
      name: 'numInputs',
      displayName: 'Number of Inputs'
    }
  );

  // Create dynamic input/output pairs and their corresponding alias inputs
  for (let i = 0; i < numInputs; i++) {
    const inputName = `input${i}`;
    const outputName = `output${i}`;
    const aliasName = `alias${i}`;

    // Get the alias value for this input/output pair
    const aliasValue = parameters[aliasName];
    const displayName = aliasValue || `${i}`;

    // Data input port
    ports.push({
      type: '*', // Accept any type
      plug: 'input',
      group: 'Inputs',
      name: inputName,
      displayName: `Input ${displayName}`
    });

    // Alias input port (text input to rename the corresponding input/output pair)
    ports.push({
      type: 'string',
      plug: 'input',
      group: 'Aliases',
      name: aliasName,
      displayName: `Alias ${i}`,
      default: ''
    });

    // Corresponding data output port
    ports.push({
      type: '*', // Output any type
      plug: 'output',
      group: 'Outputs',
      name: outputName,
      displayName: `Output ${displayName}`
    });
  }

  // Include static outputs so they are not removed by dynamic port updates
  ports.push(
    {
      type: 'signal',
      plug: 'output',
      group: 'Control',
      name: 'updated',
      displayName: 'Updated'
    },
    {
      type: 'signal',
      plug: 'output',
      group: 'Control',
      name: 'Reset Done',
      displayName: 'Reset Done'
    },
    {
      type: 'object',
      plug: 'output',
      group: 'Combined Output',
      name: 'stateObject',
      displayName: 'State Object'
    },
    {
      type: 'string',
      plug: 'output',
      group: 'Combined Output',
      name: 'objectId',
      displayName: 'Object ID'
    }
  );

  // Enable rename detection for input and output ports
  editorConnection.sendDynamicPorts(nodeId, ports, {
    detectRenamed: [
      {
        plug: 'input',
        prefix: 'input'
      },
      {
        plug: 'output',
        prefix: 'output'
      }
    ]
  });
}

module.exports = {
  node: StateManagerNode,
  setup: function (context, graphModel) {
    if (!context.editorConnection || !context.editorConnection.isRunningLocally()) {
      return;
    }

    // Helper function to update ports for both nodeAdded and parameterUpdated events
    // Track pending port updates to debounce rapid changes
    const pendingUpdates = new Map();

    function setupNodeEvents(node) {
      // FIX (2026-03-02): Guard _internal — setupNodeEvents runs on 'nodeAdded'
      // which can fire before initialize() sets up _internal.aliases.
      if (!node._internal) node._internal = {};
      if (!node._internal.aliases) node._internal.aliases = {};
      if (!node._internal.inputValues) node._internal.inputValues = {};
      if (!node._internal.outputValues) node._internal.outputValues = {};

      // Load existing alias values into internal state
      const numInputs = Math.max(0, Math.floor(node.parameters.numInputs || 3));
      for (let i = 0; i < numInputs; i++) {
        const aliasName = `alias${i}`;
        const aliasValue = node.parameters[aliasName];
        if (aliasValue) {
          node._internal.aliases[aliasName] = aliasValue;
        }
      }

      // Initial port update
      updatePorts(node.id, node.parameters, context.editorConnection);

      // Listen for parameter updates with debouncing
      node.on('parameterUpdated', function (event) {
        if (event.name === 'numInputs' || event.name.startsWith('alias')) {
          // Cancel any pending update for this node
          if (pendingUpdates.has(node.id)) {
            clearTimeout(pendingUpdates.get(node.id));
          }

          // Schedule a debounced update (50ms delay)
          const timeoutId = setTimeout(() => {
            pendingUpdates.delete(node.id);
            updatePorts(node.id, node.parameters, context.editorConnection);
          }, 50);

          pendingUpdates.set(node.id, timeoutId);
        }
      });
    }

    // Listen for port rename events at the graph model level
    graphModel.on('nodePortRenamed', function (event) {
      // Only handle events for stateManager nodes
      const node = graphModel.getNodeWithId(event.nodeId);
      if (!node || (node.type !== 'stateManager' && node.type !== 'State Manager')) {
        return;
      }

      if (event.port.plug === 'input' && event.port.name.startsWith('input')) {
        // Input port was renamed - update corresponding alias parameter
        const inputIndex = event.port.name.replace('input', '');
        const aliasName = `alias${inputIndex}`;

        // Extract the display name (remove "Input " prefix)
        const newDisplayName = event.port.displayName.replace(/^Input\s+/, '');

        // Update the alias parameter and internal state
        node.setParameter(aliasName, newDisplayName);
        node._internal.aliases[aliasName] = newDisplayName;

        // Trigger port update to sync the output port display name
        updatePorts(node.id, node.parameters, context.editorConnection);
      } else if (event.port.plug === 'output' && event.port.name.startsWith('output')) {
        // Output port was renamed - update corresponding alias parameter
        const outputIndex = event.port.name.replace('output', '');
        const aliasName = `alias${outputIndex}`;

        // Extract the display name (remove "Output " prefix)
        const newDisplayName = event.port.displayName.replace(/^Output\s+/, '');

        // Update the alias parameter and internal state
        node.setParameter(aliasName, newDisplayName);
        node._internal.aliases[aliasName] = newDisplayName;

        // Trigger port update to sync the input port display name
        updatePorts(node.id, node.parameters, context.editorConnection);
      }
    });

    graphModel.on('nodeAdded.stateManager', setupNodeEvents);
    // graphModel.on('nodeAdded.State Manager', setupNodeEvents);
  }
};
