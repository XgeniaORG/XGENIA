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

function validateNumberInput(value, defaultValue = 0) {
  const num = Number(value);
  if (isNaN(num)) {
    throw new Error('Input must be a valid number');
  }
  if (num > MAX_VALUE) {
    throw new Error(`Input cannot exceed ${MAX_VALUE}`);
  }
  if (num < MIN_VALUE) {
    throw new Error(`Input cannot be less than ${MIN_VALUE}`);
  }
  return num;
}

const TRNGGeneratorNode = {
  name: 'True Random Number Generator',
  docs: 'https://docsapp.xgenia.com/nodes/math/trng',
  category: 'Math',
  color: 'data',
  searchTags: ['random', 'generator', 'trng', 'true', 'number'],
  initialize: function () {
    // Fixed range [0, 1e12]
    this._internal.lastGeneratedValue = null;
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
    Do: {
      type: 'signal',
      displayName: 'Do',
      group: 'Actions',
      valueChangedToTrue: function () {
        this.generateRandomValue();
      }
    }
  },
  outputs: {
    value: {
      displayName: 'Generated Value',
      type: 'number',
      getter: function () {
        return this._internal.lastGeneratedValue;
      }
    },
    Done: {
      displayName: 'Done',
      type: 'signal'
    }
  },
  methods: {
    generateRandomValue: function () {
      try {
        if (this._internal.lastError) {
          console.error('TRNG Node - Cannot generate due to input error:', this._internal.lastError);
          return;
        }

        const min = 0;
        const max = MAX_VALUE;

        // Fixed range; no validation needed here

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

        this._internal.lastGeneratedValue = randomValue;
        this._internal.inspectData = {
          value: randomValue,
          range: `${min} - ${max}`,
          type: Number.isInteger(min) && Number.isInteger(max) ? 'integer' : 'decimal',
          timestamp: new Date().toISOString()
        };

        this.flagOutputDirty('value');
        this.sendSignalOnOutput('Done');
      } catch (error) {
        this._internal.lastError = error.message;
        console.error('True Random Number Generator error:', error);
        this._internal.inspectData = {
          error: error.message,
          timestamp: new Date().toISOString()
        };
      }
    }
  }
};

module.exports = {
  node: TRNGGeneratorNode
};
