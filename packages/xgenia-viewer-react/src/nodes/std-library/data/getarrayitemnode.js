'use strict';

const Collection = require('@xgenia/runtime/src/collection');

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

function getObjectId(obj) {
  // Try to get object ID if it's a Model or has an getId method
  if (obj && typeof obj.getId === 'function') {
    return obj.getId();
  }
  // If it's a plain object with an id property
  if (obj && typeof obj === 'object' && obj.id !== undefined) {
    return obj.id;
  }
  return null;
}

const GetArrayItemNode = {
  name: 'GetArrayItem',
  docs: 'https://docsapp.xgenia.com/nodes/data/array/get-array-item',
  displayNodeName: 'Get Object from Array',
  shortDesc: 'Get an object or value from an array by index with optional key path when triggered.',
  category: 'Data',
  color: 'data',
  searchTags: ['get', 'array', 'item', 'index', 'element', 'access', 'retrieve', 'object', 'key', 'path', 'trigger'],

  initialize: function () {
    this._internal.arrayId = null;
    this._internal.index = 0;
    this._internal.keyPath = '';
    this._internal.result = null;
    this._internal.objectId = null;
    this._internal.lastError = null;
    this._internal.hasBeenTriggered = false;
  },

  getInspectInfo() {
    if (this._internal.lastError) {
      return { type: 'text', value: `Error: ${this._internal.lastError}` };
    }

    if (!this._internal.hasBeenTriggered) {
      return { type: 'text', value: '[Waiting for trigger signal]' };
    }

    if (this._internal.result === null && !this._internal.arrayId) {
      return { type: 'text', value: '[Not executed yet]' };
    }

    const keyInfo = this._internal.keyPath ? ` (key: ${this._internal.keyPath})` : '';

    return [
      {
        type: 'text',
        value: `Array ID: ${this._internal.arrayId}, Index: ${this._internal.index}${keyInfo}`
      },
      {
        type: 'value',
        value: this._internal.result
      }
    ];
  },

  inputs: {
    arrayId: {
      type: {
        name: 'string',
        identifierOf: 'CollectionName',
        identifierDisplayName: 'Array Ids'
      },
      displayName: 'Array Id',
      group: 'Input',
      set: function (value) {
        this._internal.arrayId = value;
        this._internal.lastError = null;
        // Don't automatically calculate - wait for trigger
      }
    },
    index: {
      type: 'number',
      displayName: 'Index',
      group: 'Input',
      default: 0,
      set: function (value) {
        this._internal.index = value;
        this._internal.lastError = null;
        // Don't automatically calculate - wait for trigger
      }
    },
    keyPath: {
      type: 'string',
      displayName: 'Key Path',
      group: 'Object Options',
      default: '',
      set: function (value) {
        this._internal.keyPath = value || '';
        // Don't automatically calculate - wait for trigger
      }
    },
    Do: {
      type: 'signal',
      displayName: 'Do',
      group: 'Actions',
      valueChangedToTrue: function () {
        this._internal.hasBeenTriggered = true;
        this.calculate();
      }
    }
  },

  outputs: {
    value: {
      type: '*',
      displayName: 'Value',
      group: 'Output',
      getter: function () {
        return this._internal.result;
      }
    },
    objectId: {
      type: 'string',
      displayName: 'Object Id',
      group: 'Output',
      getter: function () {
        return this._internal.objectId;
      }
    },
    keyPath: {
      type: 'string',
      displayName: 'Key Path',
      group: 'Output',
      getter: function () {
        return this._internal.keyPath;
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
    calculate: function () {
      try {
        // Step 1: Check if we have an array ID
        if (!this._internal.arrayId) {
          this._internal.result = null;
          this._internal.objectId = null;
          this._internal.lastError = null;
          this.flagOutputDirty('value');
          this.flagOutputDirty('objectId');
          this.flagOutputDirty('keyPath');
          return;
        }

        // Step 2: Get the array using the Array ID
        const collection = Collection.get(this._internal.arrayId);
        if (!collection) {
          throw new Error(`Array with ID "${this._internal.arrayId}" not found`);
        }

        // Step 3: Validate index
        const index = this._internal.index;
        if (typeof index !== 'number' || !Number.isInteger(index)) {
          throw new Error('Index must be an integer');
        }

        // Step 4: Handle negative indices (Python-style)
        const actualIndex = index < 0 ? collection.length + index : index;

        if (actualIndex < 0 || actualIndex >= collection.length) {
          throw new Error(`Index ${index} is out of bounds for array of length ${collection.length}`);
        }

        // Step 5: Access the object in the array at the given index
        const object = collection[actualIndex];
        if (object === undefined) {
          throw new Error(`No object found at index ${index}`);
        }

        // Step 6: Get the object ID from the full object
        this._internal.objectId = getObjectId(object);

        // Step 7: Access the property using key path, or return the object if no key path
        let result;
        if (this._internal.keyPath && this._internal.keyPath.trim() !== '') {
          result = getValueFromPath(object, this._internal.keyPath);
          if (result === undefined) {
            throw new Error(`Key path "${this._internal.keyPath}" not found in object at index ${index}`);
          }
        } else {
          result = object;
        }

        // Step 8: Return the value
        this._internal.result = result;
        this._internal.lastError = null;
        this.flagOutputDirty('value');
        this.flagOutputDirty('objectId');
        this.flagOutputDirty('keyPath');
        this.sendSignalOnOutput('Done');
      } catch (error) {
        this._internal.lastError = error.message;
        this._internal.result = null;
        this._internal.objectId = null;
        this.flagOutputDirty('value');
        this.flagOutputDirty('objectId');
        this.flagOutputDirty('keyPath');
        this.sendSignalOnOutput('failure');
        console.error('Get Object from Array Node calculation error:', error.message);
      }
    }
  }
};

module.exports = {
  node: GetArrayItemNode
};
