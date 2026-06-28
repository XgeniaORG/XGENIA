'use strict';

let crypto;
try {
  crypto = require('crypto');
} catch (e) {
  // crypto module not available in browser environment
  crypto = null;
}

const MAX_VALUE = 1000000000000;
const MIN_VALUE = 0;
const MAX_SIZE = 10000;

function validateSizeInput(value, defaultValue = 1) {
  const num = Number(value);
  if (isNaN(num)) {
    throw new Error('Size must be a valid number');
  }
  if (num < 1) {
    throw new Error('Size must be at least 1');
  }
  if (num > MAX_SIZE) {
    throw new Error(`Size cannot exceed ${MAX_SIZE}`);
  }
  return Math.floor(num);
}

const TRNGArrayGeneratorNode = {
  name: 'True Random Number Array Generator',
  docs: 'https://docsapp.xgenia.com/nodes/math/trng-array',
  category: 'Math',
  color: 'data',
  searchTags: ['random', 'generator', 'trng', 'true', 'number', 'array', 'multiple'],
  initialize: function () {
    // Fixed range [0, 1e12]
    this._internal.size = 1;
    this._internal.lastGeneratedArray = [];
    this._internal.inspectData = null;
    this._internal.lastError = null;
  },
  getInspectInfo() {
    if (this._internal.lastError) {
      return { type: 'text', value: `Error: ${this._internal.lastError}` };
    }
    return this._internal.inspectData
      ? { type: 'value', value: this._internal.inspectData }
      : { type: 'text', value: '[Not generated yet]' };
  },
  inputs: {
    // No min/max inputs; fixed range is used during generation
    size: {
      type: 'number',
      displayName: 'Size',
      group: 'Array',
      default: 1,
      set: function (value) {
        try {
          this._internal.size = validateSizeInput(value, 1);
          this._internal.lastError = null;
        } catch (error) {
          this._internal.lastError = error.message;
          console.error('TRNG Array Node - Size error:', error.message);
        }
      }
    },
    Do: {
      type: 'signal',
      displayName: 'Do',
      group: 'Actions',
      valueChangedToTrue: function () {
        this.generateRandomArray();
      }
    }
  },
  outputs: {
    array: {
      displayName: 'Generated Array',
      type: 'array',
      getter: function () {
        return this._internal.lastGeneratedArray;
      }
    },
    Done: {
      displayName: 'Done',
      type: 'signal'
    }
  },
  methods: {
    generateRandomArray: function () {
      try {
        if (this._internal.lastError) {
          console.error('TRNG Array Node - Cannot generate due to input error:', this._internal.lastError);
          return;
        }

        const min = 0;
        const max = MAX_VALUE;
        const size = this._internal.size;

        // Fixed range; no validation needed here

        const randomArray = [];

        for (let i = 0; i < size; i++) {
          let randomValue;

          // Use crypto.getRandomValues for true randomness when available (browser)
          if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
            const array = new Uint32Array(1);
            window.crypto.getRandomValues(array);
            // Convert to 0-1 range
            const normalizedRandom = array[0] / (0xffffffff + 1);
            randomValue = min + (max - min) * normalizedRandom;
          }
          // Fallback to Node.js crypto module
          else if (crypto && crypto.randomBytes) {
            const buffer = crypto.randomBytes(4);
            const normalizedRandom = buffer.readUInt32BE(0) / (0xffffffff + 1);
            randomValue = min + (max - min) * normalizedRandom;
          }
          // Final fallback to Math.random
          else {
            randomValue = min + (max - min) * Math.random();
          }

          // Handle integer vs decimal based on input values
          if (Number.isInteger(min) && Number.isInteger(max)) {
            randomValue = Math.floor(randomValue);
            // Ensure we don't exceed max for integers
            if (randomValue === max) {
              randomValue = max - 1;
            }
          }

          randomArray.push(randomValue);
        }

        this._internal.lastGeneratedArray = randomArray;
        this._internal.inspectData = {
          arrayLength: randomArray.length,
          range: `${min} - ${max}`,
          type: Number.isInteger(min) && Number.isInteger(max) ? 'integer' : 'decimal',
          sample: randomArray.slice(0, Math.min(5, randomArray.length)), // Show first 5 values
          timestamp: new Date().toISOString()
        };

        this.flagOutputDirty('array');
        this.sendSignalOnOutput('Done');
      } catch (error) {
        this._internal.lastError = error.message;
        console.error('True Random Number Array Generator error:', error);
        this._internal.inspectData = {
          error: error.message,
          timestamp: new Date().toISOString()
        };
      }
    }
  }
};

module.exports = {
  node: TRNGArrayGeneratorNode
};
