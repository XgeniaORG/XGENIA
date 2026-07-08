'use strict';

const Model = require('@xgenia/runtime/src/model');

function getValueFromPath(obj, path) {
  if (!path || path.trim() === '') {
    return obj;
  }

  const keys = path.split(',').map((key) => key.trim());
  let value = obj;

  for (const key of keys) {
    if (value === null || value === undefined) {
      return undefined;
    }
    value = value[key];
  }

  return value;
}

function setValueAtPath(obj, path, newValue) {
  if (!path || path.trim() === '') {
    throw new Error('Key path is required for modification');
  }

  const keys = path.split(',').map((key) => key.trim());
  let current = obj;

  // Navigate to the parent of the target property
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (current === null || current === undefined) {
      throw new Error(`Cannot access property "${key}" on null or undefined`);
    }
    if (!(key in current)) {
      throw new Error(`Property "${key}" not found in object`);
    }
    current = current[key];
  }

  // Set the final property
  const finalKey = keys[keys.length - 1];
  if (current === null || current === undefined) {
    throw new Error(`Cannot set property "${finalKey}" on null or undefined`);
  }

  current[finalKey] = newValue;
}

const ModifyObjectInArrayNode = {
  name: 'ModifyObjectInArray',
  docs: 'https://docsapp.xgenia.com/nodes/data/array/modify-object-in-array',
  displayNodeName: 'Modify Object in Array',
  shortDesc: 'Modify a property of an object by object ID and key path when triggered.',
  category: 'Data',
  color: 'data',
  searchTags: ['modify', 'update', 'object', 'property', 'set', 'change', 'edit', 'key', 'path', 'trigger'],

  initialize: function () {
    this._internal.objectId = null;
    this._internal.keyPath = '';
    this._internal.newValue = null;
    this._internal.originalValue = null;
    this._internal.modifiedObject = null;
    this._internal.lastError = null;
    this._internal.modified = false;
    this._internal.hasBeenTriggered = false;
  },

  getInspectInfo() {
    if (this._internal.lastError) {
      return { type: 'text', value: `Error: ${this._internal.lastError}` };
    }

    if (!this._internal.hasBeenTriggered) {
      return { type: 'text', value: '[Waiting for modify signal]' };
    }

    if (!this._internal.objectId) {
      return { type: 'text', value: '[Waiting for object ID]' };
    }

    const status = this._internal.modified ? 'Modified' : 'Ready to modify';
    const keyInfo = this._internal.keyPath ? ` (key: ${this._internal.keyPath})` : '';

    return [
      {
        type: 'text',
        value: `${status} - Object: ${this._internal.objectId}${keyInfo}`
      },
      {
        type: 'value',
        value: this._internal.modifiedObject
      }
    ];
  },

  inputs: {
    objectId: {
      type: 'string',
      displayName: 'Object Id',
      group: 'Input',
      set: function (value) {
        this._internal.objectId = value;
        this._internal.lastError = null;
        this._internal.modified = false;
        // Don't automatically validate - wait for trigger
      }
    },
    keyPath: {
      type: 'string',
      displayName: 'Key Path',
      group: 'Object Options',
      default: '',
      set: function (value) {
        this._internal.keyPath = value || '';
        this._internal.modified = false;
        // Don't automatically validate - wait for trigger
      }
    },
    newValue: {
      type: '*',
      displayName: 'New Value',
      group: 'Input',
      set: function (value) {
        this._internal.newValue = value;
        this._internal.modified = false;
      }
    },
    Do: {
      type: 'signal',
      displayName: 'Do',
      group: 'Actions',
      valueChangedToTrue: function () {
        this._internal.hasBeenTriggered = true;
        this.performModification();
      }
    }
  },

  outputs: {
    originalValue: {
      type: '*',
      displayName: 'Original Value',
      group: 'Output',
      getter: function () {
        return this._internal.originalValue;
      }
    },
    newValue: {
      type: '*',
      displayName: 'New Value',
      group: 'Output',
      getter: function () {
        return this._internal.newValue;
      }
    },
    modifiedObject: {
      type: '*',
      displayName: 'Modified Object',
      group: 'Output',
      getter: function () {
        return this._internal.modifiedObject;
      }
    },
    Done: {
      type: 'signal',
      displayName: 'Done',
      group: 'Events'
    },
    failure: {
      type: 'signal',
      displayName: 'Failure',
      group: 'Events'
    }
  },

  methods: {
    validateInputs: function () {
      try {
        // Reset state
        this._internal.originalValue = null;
        this._internal.modifiedObject = null;
        this._internal.lastError = null;

        if (!this._internal.objectId) {
          return; // Not ready yet
        }

        // Get the object directly by ID using the model registry
        const object = (this.nodeScope.modelScope || Model).get(this._internal.objectId);
        if (!object) {
          throw new Error(`Object with ID "${this._internal.objectId}" not found`);
        }

        // Validate key path access
        if (this._internal.keyPath && this._internal.keyPath.trim() !== '') {
          const currentValue = getValueFromPath(object, this._internal.keyPath);
          if (currentValue === undefined) {
            throw new Error(`Key path "${this._internal.keyPath}" not found in object`);
          }
          this._internal.originalValue = currentValue;
        } else {
          throw new Error('Key path is required for modification');
        }

        this._internal.modifiedObject = object;
        this.flagOutputDirty('originalValue');
        this.flagOutputDirty('modifiedObject');
      } catch (error) {
        this._internal.lastError = error.message;
        this._internal.originalValue = null;
        this._internal.modifiedObject = null;
        this.flagOutputDirty('originalValue');
        this.flagOutputDirty('modifiedObject');
        console.error('Modify Object in Array Node validation error:', error.message);
      }
    },

    performModification: function () {
      try {
        // First validate inputs
        this.validateInputs();

        if (this._internal.lastError) {
          throw new Error(this._internal.lastError);
        }

        if (!this._internal.objectId) {
          throw new Error('Object ID is required');
        }

        if (!this._internal.keyPath || this._internal.keyPath.trim() === '') {
          throw new Error('Key path is required for modification');
        }

        // Get the object directly by ID using the model registry
        const object = (this.nodeScope.modelScope || Model).get(this._internal.objectId);
        if (!object) {
          throw new Error(`Object with ID "${this._internal.objectId}" not found`);
        }

        // Store original value before modification
        this._internal.originalValue = getValueFromPath(object, this._internal.keyPath);
        if (this._internal.originalValue === undefined) {
          throw new Error(`Key path "${this._internal.keyPath}" not found in object`);
        }

        // Perform the modification directly on the object
        setValueAtPath(object, this._internal.keyPath, this._internal.newValue);

        // Update internal state
        this._internal.modifiedObject = object;
        this._internal.modified = true;
        this._internal.lastError = null;

        // Flag outputs as dirty and send success signal
        this.flagOutputDirty('originalValue');
        this.flagOutputDirty('newValue');
        this.flagOutputDirty('modifiedObject');

        console.log(`Successfully modified object ${this._internal.objectId}`);
      } catch (error) {
        this._internal.lastError = error.message;
        this.flagOutputDirty('originalValue');
        this.flagOutputDirty('newValue');
        this.flagOutputDirty('modifiedObject');
        this.sendSignalOnOutput('failure');
        console.error('Modify Object in Array Node modification error:', error.message);
      } finally {
        this.sendSignalOnOutput('Done');
      }
    }
  }
};

module.exports = {
  node: ModifyObjectInArrayNode
};
