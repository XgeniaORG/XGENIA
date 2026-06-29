'use strict';

const MAX_VALUE = 1000000000000;
const MIN_VALUE = -1000000000000;

const { validateBoundedNumber } = require('./lib/validate-number');

const RoundNode = {
  name: 'Round',
  docs: 'https://docsapp.xgenia.com/nodes/math/round',
  category: 'Math',
  color: 'data',
  searchTags: ['round', 'rounding', 'nearest', 'integer', 'math', 'number'],
  initialize: function () {
    this._internal.inputValue = 0;
    this._internal.result = 0;
    this._internal.lastError = null;
  },
  getInspectInfo() {
    if (this._internal.lastError) {
      return { type: 'text', value: `Error: ${this._internal.lastError}` };
    }
    return {
      type: 'value',
      value: `Round(${this._internal.inputValue}) = ${this._internal.result}`
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
    value: {
      type: 'number',
      displayName: 'Value',
      group: 'Input',
      default: 0,
      set: function (value) {
        try {
          this._internal.inputValue = validateBoundedNumber(value);
          this._internal.lastError = null;
        } catch (error) {
          this._internal.lastError = error.message;
          console.error('Round Node - Value error:', error.message);
        }
      }
    }
  },
  outputs: {
    result: {
      displayName: 'Rounded Value',
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

        const result = Math.round(this._internal.inputValue);

        // Check if result exceeds limits
        if (result > MAX_VALUE || result < MIN_VALUE) {
          this._internal.lastError = `Result (${result}) exceeds allowed range (${MIN_VALUE} to ${MAX_VALUE})`;
          return;
        }

        this._internal.result = result;
        this.flagOutputDirty('result');
        this.sendSignalOnOutput('Done');
      } catch (error) {
        this._internal.lastError = error.message;
        console.error('Round Node - Calculate error:', error.message);
      }
    }
  }
};

module.exports = {
  node: RoundNode
};
