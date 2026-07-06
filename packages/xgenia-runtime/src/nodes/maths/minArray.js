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

function calculateMin(array, keyPath = '') {
  if (array.length === 0) {
    return 0;
  }

  const arrayType = detectArrayType(array);

  if (arrayType === 'object' && (!keyPath || keyPath.trim() === '')) {
    throw new Error('Key path is required for arrays containing objects');
  }

  let values = array;

  if (arrayType === 'object') {
    values = array.map((item, index) => {
      const value = getValueFromPath(item, keyPath);
      if (value === undefined) {
        throw new Error(`Key path "${keyPath}" not found in object at index ${index}`);
      }
      return value;
    });
  }

  // Filter out null/undefined values
  const validValues = values.filter((v) => v !== null && v !== undefined);

  if (validValues.length === 0) {
    return 0;
  }

  if (arrayType === 'number' || (arrayType === 'object' && typeof validValues[0] === 'number')) {
    return Math.min(...validValues);
  } else if (arrayType === 'string' || (arrayType === 'object' && typeof validValues[0] === 'string')) {
    return validValues.sort()[0]; // Alphabetical sort, first element is minimum
  } else {
    throw new Error(
      'Unsupported data type. Array must contain numbers, strings, or objects with numeric/string values.'
    );
  }
}

const MinNode = {
  name: 'Min Array',
  docs: 'https://docsapp.xgenia.com/nodes/math/min',
  category: 'Math',
  color: 'data',
  searchTags: ['min', 'minimum', 'smallest', 'math', 'number', 'string', 'array', 'list', 'object'],
  initialize: function () {
    this._internal.inputArray = [];
    this._internal.keyPath = '';
    this._internal.result = 0;
    this._internal.lastError = null;
  },
  getInspectInfo() {
    if (this._internal.lastError) {
      return { type: 'text', value: `Error: ${this._internal.lastError}` };
    }
    const arrayLength = this._internal.inputArray.length;
    const arrayType = detectArrayType(this._internal.inputArray);
    const keyInfo = this._internal.keyPath ? ` (key: ${this._internal.keyPath})` : '';
    return {
      type: 'value',
      value: `Min of ${arrayLength} ${arrayType} elements${keyInfo} = ${this._internal.result}`
    };
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
          this._internal.result = 0;
          this.flagOutputDirty('result');
          console.error('Min Node - Array input error:', error.message);
        }
      }
    },
    keyPath: {
      type: 'string',
      displayName: 'Key Path',
      group: 'Object Options',
      default: '',
      set: function (value) {
        this._internal.keyPath = value || '';
      }
    }
  },
  outputs: {
    result: {
      displayName: 'Minimum',
      type: '*',
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
          this.sendSignalOnOutput('Done');
          return;
        }

        this._internal.result = calculateMin(this._internal.inputArray, this._internal.keyPath);

        this.flagOutputDirty('result');
        this.sendSignalOnOutput('Done');
      } catch (error) {
        this._internal.lastError = error.message;
        this._internal.result = 0;
        this.flagOutputDirty('result');
        console.error('Min Node - Calculate error:', error.message);
        this.sendSignalOnOutput('Done');
      }
    }
  }
};

module.exports = {
  node: MinNode
};
