'use strict';

const { Node } = require('@xgenia/runtime');
const Collection = require('@xgenia/runtime/src/collection');

const MAX_ARRAY_SIZE = 1000000;

function validateSize(size) {
  if (size == null || size === '') {
    throw new Error('Size must be specified');
  }

  const numericSize = Number(size);
  if (isNaN(numericSize) || !Number.isInteger(numericSize)) {
    throw new Error('Size must be an integer');
  }

  if (numericSize < 0) {
    throw new Error('Size must be non-negative');
  }

  if (numericSize > MAX_ARRAY_SIZE) {
    throw new Error(`Size cannot exceed ${MAX_ARRAY_SIZE} elements`);
  }

  return numericSize;
}

function convertElementToAppropriateType(element) {
  // If element is already a number, return it as is
  if (typeof element === 'number') {
    return element;
  }

  // If element is a string, try to convert to number
  if (typeof element === 'string') {
    // Check if it's a valid number string (not empty and not just whitespace)
    const trimmed = element.trim();
    if (trimmed === '') {
      return element; // Return empty string as is
    }

    const converted = Number(trimmed);
    // Check if conversion was successful (not NaN) and the original string represents the same number
    if (!isNaN(converted) && isFinite(converted) && trimmed === converted.toString()) {
      return converted;
    }
  }

  // Return original element if conversion is not possible or appropriate
  return element;
}

function createFilledArray(size, element) {
  if (size === 0) {
    return [];
  }

  // Convert element to appropriate type before filling
  const convertedElement = convertElementToAppropriateType(element);
  return new Array(size).fill(convertedElement);
}

const FillArrayNode = {
  name: 'Fill-Generated Array',
  docs: 'https://docsapp.xgenia.com/nodes/data/array/array-fill',
  category: 'Data',
  color: 'data',
  searchTags: ['fill', 'array', 'collection', 'create', 'initialize', 'repeat', 'populate', 'generate'],
  initialize: function () {
    this._internal.size = 0;
    this._internal.element = null;
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
    size: {
      type: 'number',
      displayName: 'Size',
      group: 'Input',
      default: 0,
      set: function (value) {
        try {
          this._internal.size = validateSize(value);
          this._internal.lastError = null;
        } catch (error) {
          this._internal.lastError = error.message;
          this._internal.size = 0;
          this._internal.collection = null;
          this.flagOutputDirty('result');
          console.error('Fill-Generated Array Node - Size input error:', error.message);
        }
      }
    },
    element: {
      type: 'string',
      displayName: 'Element',
      group: 'Input',
      default: '',
      set: function (value) {
        this._internal.element = value;
      }
    },
    Do: {
      type: 'signal',
      displayName: 'Do',
      group: 'Actions',
      valueChangedToTrue: function () {
        this.calculate();
      }
    }
  },
  outputs: {
    result: {
      displayName: 'Filled Array',
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

        const filledArray = createFilledArray(this._internal.size, this._internal.element);

        // Create a new collection and set the filled array
        const collection = Collection.get();
        collection.set(filledArray);
        this._internal.collection = collection;

        this.flagOutputDirty('result');
        this.sendSignalOnOutput('Done');
      } catch (error) {
        this._internal.lastError = error.message;
        this._internal.collection = null;
        this.flagOutputDirty('result');
        console.error('Fill-Generated Array Node - Calculate error:', error.message);
      }
    }
  }
};

module.exports = {
  node: FillArrayNode
};
