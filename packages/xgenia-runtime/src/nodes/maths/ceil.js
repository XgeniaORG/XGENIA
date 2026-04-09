'use strict';

const MAX_VALUE = 1000000000000;
const MIN_VALUE = -1000000000000;

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

const CeilNode = {
  name: 'Ceil',
  docs: 'https://docsapp.xgenia.com/nodes/math/ceil',
  category: 'Math',
  color: 'data',
  searchTags: ['ceil', 'ceiling', 'up', 'integer', 'math', 'number'],
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
      value: `Ceil(${this._internal.inputValue}) = ${this._internal.result}`
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
          this._internal.inputValue = validateNumberInput(value, 0);
          this._internal.lastError = null;
        } catch (error) {
          this._internal.lastError = error.message;
          console.error('Ceil Node - Value error:', error.message);
        }
      }
    }
  },
  outputs: {
    result: {
      displayName: 'Ceiling Value',
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

        const result = Math.ceil(this._internal.inputValue);

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
        console.error('Ceil Node - Calculate error:', error.message);
      }
    }
  }
};

module.exports = {
  node: CeilNode
};
