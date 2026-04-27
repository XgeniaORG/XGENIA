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

const MinNode = {
  name: 'Min',
  docs: 'https://docsapp.xgenia.com/nodes/math/min',
  category: 'Math',
  color: 'data',
  searchTags: ['min', 'minimum', 'smaller', 'math', 'number'],
  initialize: function () {
    this._internal.firstNumber = 0;
    this._internal.secondNumber = 0;
    this._internal.result = 0;
    this._internal.lastError = null;
  },
  getInspectInfo() {
    if (this._internal.lastError) {
      return { type: 'text', value: `Error: ${this._internal.lastError}` };
    }
    return {
      type: 'value',
      value: `min(${this._internal.firstNumber}, ${this._internal.secondNumber}) = ${this._internal.result}`
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
          this._internal.firstNumber = num;
          this._internal.lastError = null;
        } catch (error) {
          this._internal.lastError = error.message;
          console.error('Min Node - First Number error:', error.message);
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
          this._internal.secondNumber = num;
          this._internal.lastError = null;
        } catch (error) {
          this._internal.lastError = error.message;
          console.error('Min Node - Second Number error:', error.message);
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

        const a = this._internal.firstNumber;
        const b = this._internal.secondNumber;
        const result = Math.min(a, b);

        if (result > MAX_VALUE || result < MIN_VALUE) {
          this._internal.lastError = `Result (${result}) exceeds allowed range (${MIN_VALUE} to ${MAX_VALUE})`;
          return;
        }

        this._internal.result = result;
        this.flagOutputDirty('result');
        this.sendSignalOnOutput('Done');
      } catch (error) {
        this._internal.lastError = error.message;
        console.error('Min Node - Calculate error:', error.message);
      }
    }
  }
};

module.exports = {
  node: MinNode
};
