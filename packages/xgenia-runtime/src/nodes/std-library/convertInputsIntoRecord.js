'use strict';

// Convert Inputs into Record
// --------------------------
// Combines several dynamic input ports into a single Record / Dictionary
// object. The user decides how many inputs to expose (numInputs) and gives
// each one a key; when `Do` fires, every connected input is collected into a
// plain object mapped as { [key]: value } and emitted on the `data` output.
//
// Dynamic ports follow the same pattern as the State Manager node: the editor
// side (setup) sends the port layout via editorConnection.sendDynamicPorts and
// the runtime side registers the matching inputs on demand through
// registerInputIfNeeded. Each value input (`input{i}`) can be named either by
// typing into its paired `key{i}` field or by renaming the port directly
// (rename detection keeps the two in sync). Without a custom key, the record
// falls back to the internal port name (`input{i}`).

const ConvertInputsIntoRecordNode = {
  name: 'Convert Inputs into Record',
  displayNodeName: 'Convert Inputs into Record',
  docs: 'https://docsapp.xgenia.com/nodes/data/convert-inputs-into-record',
  shortDesc: 'Combine multiple dynamic inputs into a single record/dictionary object.',
  category: 'Data',
  color: 'data',
  searchTags: ['record', 'object', 'dictionary', 'dict', 'json', 'combine', 'merge', 'inputs', 'build', 'map', 'key'],

  initialize: function () {
    this._internal.numInputs = 2;
    this._internal.inputValues = {};
    this._internal.keys = {};
    this._internal.record = null;
  },

  getInspectInfo: function () {
    return this._internal.record
      ? { type: 'value', value: this._internal.record }
      : { type: 'text', value: '[Not executed yet]' };
  },

  inputs: {
    Do: {
      type: 'signal',
      displayName: 'Do',
      group: 'Actions',
      valueChangedToTrue: function () {
        this.buildRecord();
      }
    },
    numInputs: {
      type: 'number',
      displayName: 'Number of Inputs',
      group: 'Configuration',
      default: 2,
      set: function (value) {
        this._internal.numInputs = Math.max(0, Math.floor(value || 0));
      }
    }
  },

  outputs: {
    Done: {
      type: 'signal',
      displayName: 'Done',
      group: 'Events'
    },
    data: {
      type: 'object',
      displayName: 'Data',
      group: 'Result',
      getter: function () {
        return this._internal.record;
      }
    }
  },

  prototypeExtensions: {
    // Register dynamic ports on demand. Value ports are named `input{i}` and
    // their optional key fields are named `key{i}`.
    registerInputIfNeeded: function (name) {
      if (this.hasInput(name)) return;

      if (name.indexOf('input') === 0) {
        this.registerInput(name, {
          type: '*',
          group: 'Inputs',
          set: function (value) {
            this._internal.inputValues[name] = value;
          }
        });
      } else if (name.indexOf('key') === 0) {
        this.registerInput(name, {
          type: 'string',
          group: 'Field Names',
          default: '',
          set: function (value) {
            this._internal.keys[name] = value || '';
          }
        });
      }
    },

    // Resolve the record key for a given index: a custom key takes priority,
    // otherwise fall back to the internal port name (`input{i}`).
    keyForIndex: function (i) {
      const customKey = this._internal.keys['key' + i];
      if (customKey && customKey.trim() !== '') {
        return customKey.trim();
      }
      return 'input' + i;
    },

    buildRecord: function () {
      try {
        const internal = this._internal;
        const numInputs = internal.numInputs || 0;
        const record = {};

        for (let i = 0; i < numInputs; i++) {
          const value = internal.inputValues['input' + i];

          // Skip ports that were never connected/set. null, false, 0 and '' are
          // all valid values and are kept.
          if (value === undefined) continue;

          record[this.keyForIndex(i)] = value;
        }

        internal.record = record;
        this.flagOutputDirty('data');
      } finally {
        this.sendSignalOnOutput('Done');
      }
    }
  }
};

// Build the dynamic port layout for the editor based on the current parameters.
function updatePorts(nodeId, parameters, editorConnection) {
  const numInputs = Math.max(0, Math.floor(parameters.numInputs || 0));
  const ports = [];

  // Static inputs first so dynamic updates never drop them.
  ports.push(
    {
      type: 'signal',
      plug: 'input',
      group: 'Actions',
      name: 'Do',
      displayName: 'Do'
    },
    {
      type: 'number',
      plug: 'input',
      group: 'Configuration',
      name: 'numInputs',
      displayName: 'Number of Inputs'
    }
  );

  // Dynamic value/key pairs.
  for (let i = 0; i < numInputs; i++) {
    const keyValue = parameters['key' + i];
    const valueDisplayName = keyValue && keyValue.trim() !== '' ? keyValue : 'Input ' + i;

    ports.push({
      type: '*',
      plug: 'input',
      group: 'Inputs',
      name: 'input' + i,
      displayName: valueDisplayName
    });

    ports.push({
      type: 'string',
      plug: 'input',
      group: 'Field Names',
      name: 'key' + i,
      displayName: 'Key ' + i,
      default: ''
    });
  }

  // Static outputs.
  ports.push(
    {
      type: 'object',
      plug: 'output',
      group: 'Result',
      name: 'data',
      displayName: 'Data'
    },
    {
      type: 'signal',
      plug: 'output',
      group: 'Events',
      name: 'Done',
      displayName: 'Done'
    }
  );

  // Allow renaming a value port directly; the new label becomes its key.
  editorConnection.sendDynamicPorts(nodeId, ports, {
    detectRenamed: [
      {
        plug: 'input',
        prefix: 'input'
      }
    ]
  });
}

module.exports = {
  node: ConvertInputsIntoRecordNode,
  setup: function (context, graphModel) {
    if (!context.editorConnection || !context.editorConnection.isRunningLocally()) {
      return;
    }

    // Debounce rapid parameter changes (e.g. typing a key name) per node.
    const pendingUpdates = new Map();

    function setupNodeEvents(node) {
      updatePorts(node.id, node.parameters, context.editorConnection);

      node.on('parameterUpdated', function (event) {
        if (event.name === 'numInputs' || event.name.indexOf('key') === 0) {
          if (pendingUpdates.has(node.id)) {
            clearTimeout(pendingUpdates.get(node.id));
          }

          const timeoutId = setTimeout(function () {
            pendingUpdates.delete(node.id);
            updatePorts(node.id, node.parameters, context.editorConnection);
          }, 50);

          pendingUpdates.set(node.id, timeoutId);
        }
      });
    }

    // Renaming a value port writes the new label into its paired key parameter
    // so the record key follows the port name.
    graphModel.on('nodePortRenamed', function (event) {
      const node = graphModel.getNodeWithId(event.nodeId);
      if (!node || node.type !== 'Convert Inputs into Record') {
        return;
      }

      if (event.port.plug === 'input' && event.port.name.indexOf('input') === 0) {
        const index = event.port.name.replace('input', '');
        const keyName = 'key' + index;

        // Strip the default "Input " prefix if the user renamed the unnamed default.
        const newKey = (event.port.displayName || '').replace(/^Input\s+/, '');

        node.setParameter(keyName, newKey);
        node._internal && node._internal.keys && (node._internal.keys[keyName] = newKey);

        updatePorts(node.id, node.parameters, context.editorConnection);
      }
    });

    graphModel.on('nodeAdded.Convert Inputs into Record', setupNodeEvents);
  }
};
