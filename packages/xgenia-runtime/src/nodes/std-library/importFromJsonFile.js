'use strict';

const ImportFromJsonFileNode = {
  name: 'Import from JSON file',
  docs: 'https://docsapp.xgenia.com/nodes/utilities/system/import-from-json',
  category: 'System',
  shortDesc: 'Upload a JSON file and output its top-level keys as ports.',

  initialize() {
    this._internal.jsonData = null;
    this._internal.fileName = '';
    this._internal.jsonKeys = [];

    if (typeof document !== 'undefined') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      this._internal.inputElement = input;
    }
  },

  getInspectInfo() {
    if (!this._internal.jsonData) return 'No file loaded';
    const keys = Object.keys(this._internal.jsonData || {});
    return `${this._internal.fileName || 'JSON'} - keys: ${keys.length}`;
  },

  inputs: {
    // Hidden parameter to drive dynamic port re-render, mirrors stateManager's parameter-driven flow
    jsonKeys: {
      type: 'string',
      exportToEditor: false,
      set: function (value) {
        // Keep internal state in sync if editor ever sets this
        try {
          const arr = JSON.parse(value || '[]');
          if (Array.isArray(arr)) this._internal.jsonKeys = arr;
        } catch (e) {
          // ignore
        }
      }
    },
    Upload: {
      type: 'signal',
      displayName: 'Upload',
      group: 'Control',
      valueChangedToTrue: function () {
        const input = this._internal.inputElement;
        if (!input) {
          // Not running in a browser environment
          return;
        }

        const onChange = (e) => {
          const file = e.target.files && e.target.files[0];
          if (!file) {
            input.onchange = null;
            input.value = '';
            return;
          }

          const reader = new FileReader();
          reader.onload = () => {
            try {
              const text = reader.result || '';
              const parsed = JSON.parse(text);
              if (parsed && typeof parsed === 'object') {
                this._internal.jsonData = parsed;
                this._internal.fileName = file.name || '';

                if (!Array.isArray(parsed)) {
                  this._internal.jsonKeys = Object.keys(parsed);
                } else {
                  this._internal.jsonKeys = [];
                }

                // Update the jsonKeys parameter on the model to trigger dynamic port update
                const keysJson = JSON.stringify(this._internal.jsonKeys);
                if (typeof this.setParameter === 'function') {
                  this.setParameter('jsonKeys', keysJson);
                } else if (this.model && typeof this.model.setParameter === 'function') {
                  this.model.setParameter('jsonKeys', keysJson);
                }

                // Create/refresh dynamic outputs for object keys
                if (!Array.isArray(parsed)) {
                  this.createOutputsFromJson();
                  this.flagAllJsonOutputsDirty();
                }

                // Always flag the full data output
                this.flagOutputDirty('data');
                this.sendSignalOnOutput('Done');
              } else {
                // Not an object/array; ignore silently
              }
            } catch (err) {
              // Invalid JSON; ignore silently
            }
          };
          reader.readAsText(file);

          input.onchange = null;
          input.value = '';
        };

        input.onchange = onChange;
        input.click();
      }
    },
    Update: {
      type: 'signal',
      displayName: 'Update',
      group: 'Control',
      valueChangedToTrue: function () {
        try {
          const data = this._internal.jsonData;
          if (data && typeof data === 'object') {
            if (!Array.isArray(data)) {
              try {
                const keys = Object.keys(data);
                this._internal.jsonKeys = keys;
                const keysJson = JSON.stringify(keys);
                if (typeof this.setParameter === 'function') {
                  this.setParameter('jsonKeys', keysJson);
                } else if (this.model && typeof this.model.setParameter === 'function') {
                  this.model.setParameter('jsonKeys', keysJson);
                }
              } catch (e) {
                // ignore
              }
              this.createOutputsFromJson();
              this.flagAllJsonOutputsDirty();
            } else {
              // For array payloads, clear key-based outputs
              this._internal.jsonKeys = [];
              const keysJson = '[]';
              if (typeof this.setParameter === 'function') {
                this.setParameter('jsonKeys', keysJson);
              } else if (this.model && typeof this.model.setParameter === 'function') {
                this.model.setParameter('jsonKeys', keysJson);
              }
            }
            // Always flag the full data output
            this.flagOutputDirty('data');
          }
        } finally {
          this.sendSignalOnOutput('Done');
        }
      }
    }
  },

  outputs: {
    Done: {
      type: 'signal',
      displayName: 'Done',
      group: 'Control'
    },
    data: {
      type: '*',
      displayName: 'Data',
      group: 'Data',
      getter: function () {
        return this._internal.jsonData;
      }
    }
  },

  prototypeExtensions: {
    createOutputsFromJson: function () {
      const data = this._internal.jsonData;
      if (!data || typeof data !== 'object' || Array.isArray(data)) return;

      Object.keys(data).forEach((key) => {
        if (!this.hasOutput(key)) {
          this.registerOutput(key, {
            type: this.inferType(data[key]),
            displayName: this.formatDisplayName(key),
            group: 'Data',
            getter: function () {
              return this._internal.jsonData && this._internal.jsonData[key];
            }.bind(this)
          });
        }
      });
    },

    flagAllJsonOutputsDirty: function () {
      const data = this._internal.jsonData;
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
      return 'string';
    },

    formatDisplayName: function (key) {
      return key.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase());
    }
  }
};

function updatePorts(nodeId, parameters, editorConnection) {
  const ports = [];

  // Add Upload input
  ports.push({
    type: 'signal',
    plug: 'input',
    group: 'Control',
    name: 'Upload',
    displayName: 'Upload'
  });

  // Add Update input
  ports.push({
    type: 'signal',
    plug: 'input',
    group: 'Control',
    name: 'Update',
    displayName: 'Update'
  });

  // Add full data output
  ports.push({
    type: '*',
    plug: 'output',
    group: 'Data',
    name: 'data',
    displayName: 'Data'
  });

  // Add dynamic outputs based on jsonKeys parameter
  let jsonKeys = [];
  try {
    const keysParam = parameters && parameters.jsonKeys;
    if (keysParam) {
      jsonKeys = JSON.parse(keysParam);
    }
  } catch (e) {
    // Ignore parse errors
  }

  // Add output ports for each JSON key
  if (Array.isArray(jsonKeys)) {
    jsonKeys.forEach((key) => {
      ports.push({
        type: '*', // Will be inferred from the actual value
        plug: 'output',
        group: 'Data',
        name: key,
        displayName: key.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase())
      });
    });
  }

  editorConnection.sendDynamicPorts(nodeId, ports);
}

module.exports = {
  node: ImportFromJsonFileNode,
  setup: function (context, graphModel) {
    if (!context.editorConnection || !context.editorConnection.isRunningLocally()) {
      return;
    }

    function setupNodeEvents(node) {
      // Initial port update
      updatePorts(node.id, node.parameters, context.editorConnection);

      // Listen for parameter updates
      node.on('parameterUpdated', function (event) {
        if (event.name === 'jsonKeys') {
          updatePorts(node.id, node.parameters, context.editorConnection);
        }
      });
    }

    // Register after editor import completes, like other dynamic nodes
    graphModel.on('nodeAdded.Import from JSON file', setupNodeEvents);
  }
};
