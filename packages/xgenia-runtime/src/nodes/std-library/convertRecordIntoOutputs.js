'use strict';

// Convert Record into Outputs
// ---------------------------
// The inverse of the Convert Inputs into Record node: it takes a single Record
// / Dictionary / JSON object on `data` and exposes one dynamic output port per
// key, mapped as { [key]: value }. When `Do` fires, every output is refreshed
// from the current record and `Done` is emitted.
//
// Dynamic ports follow the same pattern as Convert Dict Keys to Ports: the keys
// of the incoming object are stored in the hidden `dataKeys` parameter, which
// the editor side (setup) turns into output ports via
// editorConnection.sendDynamicPorts. The runtime side registers a matching
// output for each key whose getter reads back from the stored record.

const ConvertRecordIntoOutputsNode = {
  name: 'Convert Record into Outputs',
  displayNodeName: 'Convert Record into Outputs',
  docs: 'https://docsapp.xgenia.com/nodes/data/convert-record-into-outputs',
  shortDesc: 'Split a record/dictionary object into one dynamic output port per key.',
  category: 'Data',
  color: 'data',
  searchTags: [
    'record',
    'object',
    'dictionary',
    'dict',
    'json',
    'split',
    'destructure',
    'unpack',
    'outputs',
    'ports',
    'keys'
  ],

  initialize: function () {
    this._internal.record = null;
    this._internal.recordKeys = [];
  },

  getInspectInfo: function () {
    const data = this._internal.record;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { type: 'text', value: '[Not executed yet]' };
    }
    return { type: 'value', value: data };
  },

  inputs: {
    Do: {
      type: 'signal',
      displayName: 'Do',
      group: 'Actions',
      valueChangedToTrue: function () {
        this.emitOutputs();
      }
    },
    data: {
      type: 'object',
      displayName: 'Data',
      group: 'Data',
      set: function (value) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          this._internal.record = value;
          this.syncOutputs();
        } else {
          this._internal.record = null;
          this._internal.recordKeys = [];
          this.setKeysParameter('[]');
        }
      }
    },
    // Hidden parameter that drives the dynamic output ports in the editor.
    dataKeys: {
      type: 'string',
      exportToEditor: false,
      set: function (value) {
        try {
          const arr = JSON.parse(value || '[]');
          if (Array.isArray(arr)) this._internal.recordKeys = arr;
        } catch (e) {
          // ignore malformed values
        }
      }
    }
  },

  outputs: {
    Done: {
      type: 'signal',
      displayName: 'Done',
      group: 'Events'
    }
  },

  prototypeExtensions: {
    // setParameter only exists in the editor context; fall back to the model
    // when present and no-op otherwise (e.g. deployed runtime).
    setKeysParameter: function (keysJson) {
      if (typeof this.setParameter === 'function') {
        this.setParameter('dataKeys', keysJson);
      } else if (this.model && typeof this.model.setParameter === 'function') {
        this.model.setParameter('dataKeys', keysJson);
      }
    },

    // Recompute keys, push the dataKeys parameter (so the editor builds the
    // ports) and register/flag the matching runtime outputs.
    syncOutputs: function () {
      const data = this._internal.record;
      const isObject = data && typeof data === 'object' && !Array.isArray(data);
      const keys = isObject ? Object.keys(data) : [];
      this._internal.recordKeys = keys;

      this.setKeysParameter(JSON.stringify(keys));
      this.createOutputsFromRecord();
      this.flagAllRecordOutputsDirty();
    },

    createOutputsFromRecord: function () {
      const data = this._internal.record;
      if (!data || typeof data !== 'object' || Array.isArray(data)) return;

      Object.keys(data).forEach((key) => {
        if (!this.hasOutput(key)) {
          this.registerOutput(key, {
            type: this.inferType(data[key]),
            displayName: key,
            group: 'Outputs',
            getter: function () {
              return this._internal.record ? this._internal.record[key] : undefined;
            }.bind(this)
          });
        }
      });
    },

    flagAllRecordOutputsDirty: function () {
      const data = this._internal.record;
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

    emitOutputs: function () {
      this.syncOutputs();
      this.sendSignalOnOutput('Done');
    }
  }
};

// Build the dynamic port layout for the editor from the dataKeys parameter.
function updatePorts(nodeId, parameters, editorConnection) {
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
      type: 'object',
      plug: 'input',
      group: 'Data',
      name: 'data',
      displayName: 'Data'
    }
  );

  // One output per record key.
  let dataKeys = [];
  try {
    if (parameters && parameters.dataKeys) {
      dataKeys = JSON.parse(parameters.dataKeys);
    }
  } catch (e) {
    // ignore malformed values
  }

  if (Array.isArray(dataKeys)) {
    dataKeys.forEach((key) => {
      ports.push({
        type: '*',
        plug: 'output',
        group: 'Outputs',
        name: key,
        displayName: key
      });
    });
  }

  // Static output last.
  ports.push({
    type: 'signal',
    plug: 'output',
    group: 'Events',
    name: 'Done',
    displayName: 'Done'
  });

  editorConnection.sendDynamicPorts(nodeId, ports);
}

module.exports = {
  node: ConvertRecordIntoOutputsNode,
  setup: function (context, graphModel) {
    if (!context.editorConnection || !context.editorConnection.isRunningLocally()) {
      return;
    }

    function setupNodeEvents(node) {
      updatePorts(node.id, node.parameters, context.editorConnection);

      node.on('parameterUpdated', function (event) {
        if (event.name === 'dataKeys') {
          updatePorts(node.id, node.parameters, context.editorConnection);
        }
      });
    }

    graphModel.on('nodeAdded.Convert Record into Outputs', setupNodeEvents);
  }
};
