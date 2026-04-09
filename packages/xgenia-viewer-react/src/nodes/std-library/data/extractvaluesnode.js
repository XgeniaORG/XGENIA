'use strict';

const MAX_ARRAY_LENGTH = 1000000;

function validateArrayInput(array) {
  if (!Array.isArray(array)) {
    throw new Error('Input must be an array');
  }
  if (array.length === 0) {
    throw new Error('Array cannot be empty');
  }
  if (array.length > MAX_ARRAY_LENGTH) {
    throw new Error(`Array cannot contain more than ${MAX_ARRAY_LENGTH} elements`);
  }

  return array;
}

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

function detectArrayType(array) {
  if (array.length === 0) return 'unknown';

  const firstElement = array[0];

  if (typeof firstElement === 'number') {
    return 'number';
  } else if (typeof firstElement === 'string') {
    return 'string';
  } else if (typeof firstElement === 'object' && firstElement !== null) {
    return 'object';
  }

  return 'unknown';
}

function generateUniqueId() {
  return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

function extractValues(array, keyPath = '') {
  if (array.length === 0) {
    return [];
  }

  const arrayType = detectArrayType(array);

  if (arrayType !== 'object') {
    throw new Error('Input array must contain objects to extract values from');
  }

  if (!keyPath || keyPath.trim() === '') {
    throw new Error('Key path is required to extract values from objects');
  }

  const extractedValues = [];

  for (let i = 0; i < array.length; i++) {
    const item = array[i];
    const extractedValue = getValueFromPath(item, keyPath);

    if (extractedValue === undefined) {
      throw new Error(`Key path "${keyPath}" not found in object at index ${i}`);
    }

    // Add the extracted value with a unique ID
    extractedValues.push({
      value: extractedValue,
      _extractId: generateUniqueId(),
      _originalIndex: i
    });
  }

  return extractedValues.map((item) => item.value);
}

const ExtractValuesNode = {
  name: 'Extract Values',
  docs: 'https://docsapp.xgenia.com/nodes/data/array/extract-values',
  category: 'Data',
  color: 'data',
  searchTags: ['extract', 'values', 'convert', 'array', 'object', 'key', 'path', 'data'],
  initialize: function () {
    this._internal.inputArray = [];
    this._internal.keyPath = '';
    this._internal.result = [];
    this._internal.lastError = null;
  },
  getInspectInfo() {
    if (this._internal.lastError) {
      return { type: 'text', value: `Error: ${this._internal.lastError}` };
    }

    if (!this._internal.result || this._internal.result.length === 0) {
      return { type: 'text', value: '[Not executed yet]' };
    }

    // Generate a simple ID based on the extracted content
    // const extractId = `extract-${this._internal.keyPath || 'nokey'}-${this._internal.result.length}`;

    return [
      // {
      //   type: 'text',
      //   value: 'Id: ' + extractId
      // },
      {
        type: 'value',
        value: this._internal.result
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
    array: {
      type: 'array',
      displayName: 'Array',
      group: 'Input',
      default: [],
      set: function (value) {
        try {
          this._internal.inputArray = validateArrayInput(value || []);
          this._internal.lastError = null;
        } catch (error) {
          this._internal.lastError = error.message;
          this._internal.inputArray = [];
          this._internal.result = [];
          this.flagOutputDirty('result');
          console.error('Extract Values Node - Array input error:', error.message);
        }
      }
    },
    keyPath: {
      type: 'string',
      displayName: 'Key Path',
      group: 'Extract Options',
      default: '',
      set: function (value) {
        this._internal.keyPath = value || '';
      }
    }
  },
  outputs: {
    result: {
      displayName: 'Extracted Array',
      type: 'array',
      getter: function () {
        return this._internal.result;
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

        this._internal.result = extractValues(this._internal.inputArray, this._internal.keyPath);

        this.flagOutputDirty('result');
        this.sendSignalOnOutput('Done');
      } catch (error) {
        this._internal.lastError = error.message;
        this._internal.result = [];
        this.flagOutputDirty('result');
        console.error('Extract Values Node - Calculate error:', error.message);
      }
    }
  }
};

module.exports = {
  node: ExtractValuesNode
};
