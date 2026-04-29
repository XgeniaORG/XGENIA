'use strict';

const ConvertDictKeysToPortsNode = {
  name: 'Convert Dict Keys to Ports',
  docs: 'https://docsapp.xgenia.com/nodes/utilities/logic/convert-dict-keys-to-ports',
  shortDesc: 'Map keys in an object to dynamic output ports and emit values on signal.',
  category: 'Logic',

  initialize() {
    this._internal.dictData = null;
    this._internal.dictKeys = [];
  },

  getInspectInfo() {
    const data = this._internal.dictData;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return 'No dict';
    const keys = Object.keys(data);
    return `Keys: ${keys.length}`;
  },

  inputs: {
    dict: {
      type: 'object',
      displayName: 'Dict',
      group: 'Data',
      set: function (value) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          this._internal.dictData = value;

          const keys = Object.keys(value);
          this._internal.dictKeys = keys;

          const keysJson = JSON.stringify(keys);
          if (typeof this.setParameter === 'function') {
            this.setParameter('dictKeys', keysJson);
          } else if (this.model && typeof this.model.setParameter === 'function') {
            this.model.setParameter('dictKeys', keysJson);
          }

          this.createOutputsFromDict();
          this.flagAllDictOutputsDirty();
        } else {
          this._internal.dictData = null;
          this._internal.dictKeys = [];
          if (typeof this.setParameter === 'function') {
            this.setParameter('dictKeys', '[]');
          } else if (this.model && typeof this.model.setParameter === 'function') {
            this.model.setParameter('dictKeys', '[]');
          }
        }
      }
    },
    do: {
      type: 'signal',
      displayName: 'Do',
      group: 'Control',
      valueChangedToTrue: function () {
        const data = this._internal.dictData;
        if (data && typeof data === 'object' && !Array.isArray(data)) {
          const keys = Object.keys(data);
          this._internal.dictKeys = keys;

          // Update the hidden parameter to trigger dynamic ports in the editor
          const keysJson = JSON.stringify(keys);
          if (typeof this.setParameter === 'function') {
            this.setParameter('dictKeys', keysJson);
          } else if (this.model && typeof this.model.setParameter === 'function') {
            this.model.setParameter('dictKeys', keysJson);
          }

          this.createOutputsFromDict();
          this.flagAllDictOutputsDirty();
        }

        this.sendSignalOnOutput('done');
      }
    },
    // Hidden parameter to drive dynamic port updates via the editor
    dictKeys: {
      type: 'string',
      exportToEditor: false,
      set: function (value) {
        try {
          const arr = JSON.parse(value || '[]');
          if (Array.isArray(arr)) this._internal.dictKeys = arr;
        } catch (e) {
          // ignore
        }
      }
    }
  },

  outputs: {
    done: {
      type: 'signal',
      displayName: 'Done',
      group: 'Control'
    }
  },

  prototypeExtensions: {
    createOutputsFromDict: function () {
      const data = this._internal.dictData;
      if (!data || typeof data !== 'object' || Array.isArray(data)) return;

      Object.keys(data).forEach((key) => {
        if (!this.hasOutput(key)) {
          this.registerOutput(key, {
            type: this.inferType(data[key]),
            displayName: this.formatDisplayName(key),
            group: 'Data',
            getter: function () {
              return this._internal.dictData && this._internal.dictData[key];
            }.bind(this)
          });
        }
      });
    },

    flagAllDictOutputsDirty: function () {
      const data = this._internal.dictData;
      if (!data || typeof data !== 'object' || Array.isArray(data)) return;
      Object.keys(data).forEach((key) => {
        if (this.hasOutput(key)) {
          this.flagOutputDirty(key);
        }
      });
    },

    inferType: function (value) {
      if (typeof value === 'number') return 'number';
      if (typeof value === 'boolean') return 'boolean';
      if (typeof value === 'string') return 'string';
      if (Array.isArray(value)) return 'array';
      if (typeof value === 'object' && value !== null) return 'object';
      return '*';
    },

    formatDisplayName: function (key) {
      return key.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase());
    }
  }
};

function updatePorts(nodeId, parameters, editorConnection) {
  const ports = [];

  // Static inputs
  ports.push(
    {
      type: 'object',
      plug: 'input',
      group: 'Data',
      name: 'dict',
      displayName: 'Dict'
    },
    {
      type: 'signal',
      plug: 'input',
      group: 'Control',
      name: 'do',
      displayName: 'Do'
    }
  );

  // Dynamic outputs from dictKeys parameter
  let dictKeys = [];
  try {
    const keysParam = parameters && parameters.dictKeys;
    if (keysParam) {
      dictKeys = JSON.parse(keysParam);
    }
  } catch (e) {
    // ignore
  }

  if (Array.isArray(dictKeys)) {
    dictKeys.forEach((key) => {
      ports.push({
        type: '*',
        plug: 'output',
        group: 'Data',
        name: key,
        displayName: key.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase())
      });
    });
  }

  // Static outputs
  ports.push({
    type: 'signal',
    plug: 'output',
    group: 'Control',
    name: 'done',
    displayName: 'Done'
  });

  editorConnection.sendDynamicPorts(nodeId, ports);
}

module.exports = {
  node: ConvertDictKeysToPortsNode,
  setup: function (context, graphModel) {
    if (!context.editorConnection || !context.editorConnection.isRunningLocally()) {
      return;
    }

    function setupNodeEvents(node) {
      updatePorts(node.id, node.parameters, context.editorConnection);

      node.on('parameterUpdated', function (event) {
        if (event.name === 'dictKeys') {
          updatePorts(node.id, node.parameters, context.editorConnection);
        }
      });
    }

    graphModel.on('nodeAdded.Convert Dict Keys to Ports', setupNodeEvents);
  }
};
