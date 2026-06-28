'use strict';

const MAX_VALUE = 1000000000000;
const MIN_VALUE = -1000000000000;

const { validateBoundedNumber } = require('./lib/validate-number');

const ModuloNode = {
  name: 'Modulo',
  docs: 'https://docsapp.xgenia.com/nodes/math/modulo',
  category: 'Math',
  color: 'data',
  searchTags: ['modulo', 'remainder', 'mod', 'math', 'number'],
  initialize: function () {
    this._internal.firstNumber = 0;
    this._internal.secondNumber = 1;
    this._internal.result = 0;
    this._internal.lastError = null;
  },
  getInspectInfo() {
    if (this._internal.lastError) {
      return { type: 'text', value: `Error: ${this._internal.lastError}` };
    }
    return {
      type: 'value',
      value: `${this._internal.firstNumber} % ${this._internal.secondNumber} = ${this._internal.result}`
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
    firstNumber: {
      type: 'number',
      displayName: 'First Number',
      group: 'Numbers',
      default: 0,
      set: function (value) {
        try {
          this._internal.firstNumber = validateBoundedNumber(value);
          this._internal.lastError = null;
        } catch (error) {
          this._internal.lastError = error.message;
          console.error('Modulo Node - First Number error:', error.message);
        }
      }
    },
    secondNumber: {
      type: 'number',
      displayName: 'Second Number',
      group: 'Numbers',
      default: 0,
      set: function (value) {
        try {
          this._internal.secondNumber = validateBoundedNumber(value);
          this._internal.lastError = null;
        } catch (error) {
          this._internal.lastError = error.message;
          console.error('Modulo Node - Second Number error:', error.message);
        }
      }
    }
  },
  outputs: {
    result: {
      displayName: 'Result',
      type: 'number',
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

        // Check for modulo by zero
        if (this._internal.secondNumber === 0) {
          this._internal.lastError = 'Modulo by zero is not allowed';
          return;
        }

        const result = this._internal.firstNumber % this._internal.secondNumber;

        // Check if result exceeds limits or is not finite
        if (!isFinite(result) || result > MAX_VALUE || result < MIN_VALUE) {
          this._internal.lastError = `Result (${result}) exceeds allowed range (${MIN_VALUE} to ${MAX_VALUE})`;
          return;
        }

        this._internal.result = result;
        this.flagOutputDirty('result');
        this.sendSignalOnOutput('Done');
      } catch (error) {
        this._internal.lastError = error.message;
        console.error('Modulo Node - Calculate error:', error.message);
      }
    }
  }
};

module.exports = {
  node: ModuloNode
};
