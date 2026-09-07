'use strict';

const { Node } = require('@xgenia/runtime');
const Collection = require('@xgenia/runtime/src/collection');

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

function calculateSort(array, keyPath = '', ascending = true) {
  if (array.length === 0) {
    return [];
  }

  const arrayType = detectArrayType(array);

  if (arrayType === 'object' && (!keyPath || keyPath.trim() === '')) {
    throw new Error('Key path is required for arrays containing objects');
  }

  let itemsToSort = array.map((item, index) => ({
    originalValue: item,
    sortValue: item,
    originalIndex: index
  }));

  if (arrayType === 'object') {
    itemsToSort = itemsToSort.map((item, index) => {
      const value = getValueFromPath(item.originalValue, keyPath);
      if (value === undefined) {
        throw new Error(`Key path "${keyPath}" not found in object at index ${index}`);
      }
      return {
        ...item,
        sortValue: value
      };
    });
  }

  // Filter out items with null/undefined sort values
  const validItems = itemsToSort.filter((item) => item.sortValue !== null && item.sortValue !== undefined);

  if (validItems.length === 0) {
    return [];
  }

  // Determine sort function based on data type
  const firstSortValue = validItems[0].sortValue;
  let compareFn;

  if (typeof firstSortValue === 'number') {
    compareFn = (a, b) => {
      const diff = a.sortValue - b.sortValue;
      return ascending ? diff : -diff;
    };
  } else if (typeof firstSortValue === 'string') {
    compareFn = (a, b) => {
      const comparison = a.sortValue.localeCompare(b.sortValue);
      return ascending ? comparison : -comparison;
    };
  } else {
    throw new Error(
      'Unsupported data type for sorting. Array must contain numbers, strings, or objects with numeric/string values.'
    );
  }

  // Sort the items
  validItems.sort(compareFn);

  // Return the sorted array
  return validItems.map((item) => item.originalValue);
}

const SortNode = {
  name: 'Sort Collection',
  docs: 'https://docsapp.xgenia.com/nodes/data/array/array-sort',
  category: 'Data',
  color: 'data',
  searchTags: ['sort', 'order', 'arrange', 'ascending', 'descending', 'collection', 'array', 'list', 'object'],
  initialize: function () {
    this._internal.inputArray = [];
    this._internal.keyPath = '';
    this._internal.ascending = true;
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
          this._internal.collection = null;
          this.flagOutputDirty('result');
          console.error('Sort Collection Node - Array input error:', error.message);
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
    },
    ascending: {
      type: 'boolean',
      displayName: 'Ascending',
      group: 'Sort Options',
      default: true,
      set: function (value) {
        this._internal.ascending = value !== false; // Default to true if undefined/null
      }
    }
  },
  outputs: {
    result: {
      displayName: 'Sorted Array',
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

        const sortedArray = calculateSort(this._internal.inputArray, this._internal.keyPath, this._internal.ascending);

        // Create a new collection and set the sorted items
        const collection = Collection.get();
        collection.set(sortedArray);
        this._internal.collection = collection;

        this.flagOutputDirty('result');
      } catch (error) {
        this._internal.lastError = error.message;
        this._internal.collection = null;
        this.flagOutputDirty('result');
        console.error('Sort Collection Node - Calculate error:', error.message);
      } finally {
        this.sendSignalOnOutput('Done');
      }
    }
  }
};

module.exports = {
  node: SortNode
};
