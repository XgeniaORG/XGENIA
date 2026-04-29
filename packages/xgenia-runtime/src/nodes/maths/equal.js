'use strict';

const MAX_VALUE = 1000000000000;
const MIN_VALUE = -1000000000000;

const EqualNode = {
  name: 'Equal',
  docs: 'https://docsapp.xgenia.com/nodes/math/equal',
  category: 'Math',
  color: 'data',
  searchTags: ['equal', '==', '===', 'compare', 'number'],
  initialize: function () {
    this._internal.firstNumber = 0;
    this._internal.secondNumber = 0;
    this._internal.result = false;
    this._internal.lastError = null;
  },
  getInspectInfo() {
    if (this._internal.lastError) {
      return { type: 'text', value: `Error: ${this._internal.lastError}` };
    }
    return {
      type: 'value',
      value: `(${this._internal.firstNumber} === ${this._internal.secondNumber}) = ${this._internal.result}`
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
          console.error('Equal Node - First Number error:', error.message);
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
          console.error('Equal Node - Second Number error:', error.message);
        }
      }
    }
  },
  outputs: {
    result: {
      displayName: 'Result',
      type: 'boolean',
      getter: function () {
        return this._internal.result;
      }
    },
    trueCondition: {
      displayName: 'True Condition',
      type: 'signal'
    },
    falseCondition: {
      displayName: 'False Condition',
      type: 'signal'
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
        const result = a === b;

        this._internal.result = result;
        this.flagOutputDirty('result');
        // emit condition signals similar to If node behavior
        if (result === true) {
          this.sendSignalOnOutput('trueCondition');
        } else {
          this.sendSignalOnOutput('falseCondition');
        }
        this.sendSignalOnOutput('Done');
      } catch (error) {
        this._internal.lastError = error.message;
        console.error('Equal Node - Calculate error:', error.message);
      }
    }
  }
};

module.exports = {
  node: EqualNode
};
