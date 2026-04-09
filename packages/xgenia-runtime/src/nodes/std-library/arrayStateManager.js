'use strict';

const ArrayStateManagerNode = {
  name: 'arrayStateManager',
  displayNodeName: 'Array State Manager',
  docs: 'https://docsapp.xgenia.com/nodes/utilities/logic/arraystatemanager',
  shortDesc: 'Accept dynamic inputs and output accumulated arrays when update signal is triggered.',
  category: 'Logic',

  initialize: function () {
    this._internal.inputValues = {};
    this._internal.outputArrays = {};
    this._internal.aliases = {};
    this._internal.numInputs = this._internal.numInputs || 3;
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
    }
  },

  prototypeExtensions: {
    registerInputIfNeeded: function (name) {
      if (this.hasInput(name)) return;

      if (name.startsWith('input')) {
        this.registerInput(name, {
          type: '*',
          displayName: name.replace('input', 'Input '),
          group: 'Inputs',
          set: function (value) {
            this._internal.inputValues[name] = value;
          }
        });
      } else if (name.startsWith('alias')) {
        this.registerInput(name, {
          type: 'string',
          displayName: name.replace('alias', 'Alias '),
          group: 'Aliases',
          default: '',
          set: function (value) {
            this._internal.aliases[name] = value || '';
            this.setParameter(name, value || '');
          }
        });
      }
    },

    registerOutputIfNeeded: function (name) {
      if (this.hasOutput(name)) return;

      if (name.startsWith('output')) {
        this.registerOutput(name, {
          type: 'array',
          displayName: name.replace('output', 'Output '),
          group: 'Outputs',
          getter: function () {
            const inputName = name.replace('output', 'input');
            const arr = this._internal.outputArrays[inputName];
            return Array.isArray(arr) ? arr : [];
          }
        });
      }
    },

    performUpdate: function () {
      const internal = this._internal;
      const numInputs = internal.numInputs || 3;

      for (let i = 0; i < numInputs; i++) {
        const inputName = `input${i}`;
        const outputName = `output${i}`;

        const inputValue = internal.inputValues[inputName];
        if (!Array.isArray(internal.outputArrays[inputName])) {
          internal.outputArrays[inputName] = [];
        }
        if (inputValue !== undefined) {
          internal.outputArrays[inputName].push(inputValue);
        }

        if (this.hasOutput(outputName)) {
          this.flagOutputDirty(outputName);
        }
      }

      this.sendSignalOnOutput('updated');
    },

    performReset: function () {
      const internal = this._internal;
      const numInputs = internal.numInputs || 3;

      for (let i = 0; i < numInputs; i++) {
        const inputName = `input${i}`;
        const outputName = `output${i}`;
        internal.outputArrays[inputName] = [];
        if (this.hasOutput(outputName)) {
          this.flagOutputDirty(outputName);
        }
      }

      if (this.hasOutput('Reset Done')) this.sendSignalOnOutput('Reset Done');
    }
  }
};

function updatePorts(nodeId, parameters, editorConnection) {
  const numInputs = Math.max(0, Math.floor(parameters.numInputs || 3));
  const ports = [];

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

  for (let i = 0; i < numInputs; i++) {
    const inputName = `input${i}`;
    const outputName = `output${i}`;
    const aliasName = `alias${i}`;

    const aliasValue = parameters[aliasName];
    const displayName = aliasValue || `${i}`;

    ports.push({
      type: '*',
      plug: 'input',
      group: 'Inputs',
      name: inputName,
      displayName: `Input ${displayName}`
    });

    ports.push({
      type: 'string',
      plug: 'input',
      group: 'Aliases',
      name: aliasName,
      displayName: `Alias ${i}`,
      default: ''
    });

    ports.push({
      type: 'array',
      plug: 'output',
      group: 'Outputs',
      name: outputName,
      displayName: `Output ${displayName}`
    });
  }

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
    }
  );

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
  node: ArrayStateManagerNode,
  setup: function (context, graphModel) {
    if (!context.editorConnection || !context.editorConnection.isRunningLocally()) {
      return;
    }

    function setupNodeEvents(node) {
      const numInputs = Math.max(0, Math.floor(node.parameters.numInputs || 3));
      for (let i = 0; i < numInputs; i++) {
        const aliasName = `alias${i}`;
        const aliasValue = node.parameters[aliasName];
        if (aliasValue) {
          node._internal.aliases[aliasName] = aliasValue;
        }
      }

      updatePorts(node.id, node.parameters, context.editorConnection);

      node.on('parameterUpdated', function (event) {
        if (event.name === 'numInputs' || event.name.startsWith('alias')) {
          updatePorts(node.id, node.parameters, context.editorConnection);
        }
      });
    }

    graphModel.on('nodePortRenamed', function (event) {
      const node = graphModel.getNodeWithId(event.nodeId);
      if (!node || (node.type !== 'arrayStateManager' && node.type !== 'Array State Manager')) {
        return;
      }

      if (event.port.plug === 'input' && event.port.name.startsWith('input')) {
        const inputIndex = event.port.name.replace('input', '');
        const aliasName = `alias${inputIndex}`;
        const newDisplayName = event.port.displayName.replace(/^Input\s+/, '');
        node.setParameter(aliasName, newDisplayName);
        node._internal.aliases[aliasName] = newDisplayName;
        updatePorts(node.id, node.parameters, context.editorConnection);
      } else if (event.port.plug === 'output' && event.port.name.startsWith('output')) {
        const outputIndex = event.port.name.replace('output', '');
        const aliasName = `alias${outputIndex}`;
        const newDisplayName = event.port.displayName.replace(/^Output\s+/, '');
        node.setParameter(aliasName, newDisplayName);
        node._internal.aliases[aliasName] = newDisplayName;
        updatePorts(node.id, node.parameters, context.editorConnection);
      }
    });

    graphModel.on('nodeAdded.arrayStateManager', setupNodeEvents);
    // graphModel.on('nodeAdded.Array State Manager', setupNodeEvents);
  }
};
