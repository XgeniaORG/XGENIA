'use strict';

const { Node } = require('@xgenia/runtime');
const Collection = require('@xgenia/runtime/src/collection');

function validateArrayInput(array, inputName) {
  if (!array) {
    return []; // Return empty array for null/undefined inputs
  }

  if (!Array.isArray(array) && !(array instanceof Collection)) {
    throw new Error(`${inputName} must be an array or Collection`);
  }

  // If it's a Collection, extract the items
  if (array instanceof Collection) {
    return array.items || [];
  }

  return array;
}

function concatenateArrays(array1, array2) {
  const validArray1 = validateArrayInput(array1, 'Array 1');
  const validArray2 = validateArrayInput(array2, 'Array 2');

  // Concatenate the arrays
  return validArray1.concat(validArray2);
}

const ConcatenateArrayNode = {
  name: 'Concatenate Array',
  docs: 'https://docsapp.xgenia.com/nodes/data/array/array-concatenate',
  category: 'Data',
  color: 'data',
  searchTags: ['concatenate', 'merge', 'combine', 'join', 'array', 'collection', 'append'],
  initialize: function () {
    this._internal.array1 = [];
    this._internal.array2 = [];
    this._internal.collection = null;
    this._internal.lastError = null;
  },
  getInspectInfo() {
    if (this._internal.lastError) {
      return { type: 'text', value: `Error: ${this._internal.lastError}` };
    }

    const collection = this._internal.collection;
    if (!collection) {
      return { type: 'text', value: '[Not executed yet]' };
    }

    // Match the standard Array node inspect pattern exactly
    return [
      {
        type: 'text',
        value: 'Id: ' + collection.getId()
      },
      {
        type: 'value',
        value: collection.items
      }
    ];
  },
  inputs: {
    Do: {
      type: 'signal',
      displayName: 'Do',
      group: 'Actions',
      valueChangedToTrue: function () {
        this.calculate();
      }
    },
    array1: {
      type: 'array',
      displayName: 'Array 1',
      group: 'Input',
      default: [],
      set: function (value) {
        try {
          this._internal.array1 = value;
          this._internal.lastError = null;
        } catch (error) {
          this._internal.lastError = error.message;
          this._internal.array1 = [];
          this._internal.collection = null;
          this.flagOutputDirty('result');
          console.error('Concatenate Array Node - Array 1 input error:', error.message);
        }
      }
    },
    array2: {
      type: 'array',
      displayName: 'Array 2',
      group: 'Input',
      default: [],
      set: function (value) {
        try {
          this._internal.array2 = value;
          this._internal.lastError = null;
        } catch (error) {
          this._internal.lastError = error.message;
          this._internal.array2 = [];
          this._internal.collection = null;
          this.flagOutputDirty('result');
          console.error('Concatenate Array Node - Array 2 input error:', error.message);
        }
      }
    }
  },
  outputs: {
    result: {
      displayName: 'Concatenated Array',
      type: 'array',
      getter: function () {
        return this._internal.collection;
      }
    },
    Done: {
      displayName: 'Done',
      type: 'signal'
    }
  },
  methods: {
    calculate: function () {
      try {
        if (this._internal.lastError) {
          return;
        }

        const concatenatedArray = concatenateArrays(this._internal.array1, this._internal.array2);

        // Create a new collection and set the concatenated array
        const collection = Collection.get();
        collection.set(concatenatedArray);
        this._internal.collection = collection;

        this.flagOutputDirty('result');
      } catch (error) {
        this._internal.lastError = error.message;
        this._internal.collection = null;
        this.flagOutputDirty('result');
        console.error('Concatenate Array Node - Calculate error:', error.message);
      } finally {
        this.sendSignalOnOutput('Done');
      }
    }
  }
};

module.exports = {
  node: ConcatenateArrayNode
};
