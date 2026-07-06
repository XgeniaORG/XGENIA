'use strict';

const { evaluate } = require('mathjs');

const MAX_VALUE = 1000000000000;
const MIN_VALUE = -1000000000000;

const { validateBoundedNumber } = require('./lib/validate-number');

// Math formula evaluation using mathjs
function evaluateFormula(formula, x) {
  try {
    // Create a scope with the variable x and common constants
    const scope = {
      x: x,
      pi: Math.PI,
      e: Math.E
    };

    // Use mathjs evaluate function which is much more robust
    const result = evaluate(formula, scope);

    // Ensure we get a number result
    if (typeof result !== 'number') {
      throw new Error(`Formula must evaluate to a number, got ${typeof result}: ${result}`);
    }

    return result;
  } catch (error) {
    throw new Error(`Formula evaluation error: ${error.message}`);
  }
}

const SingleParameterFormulaNode = {
  name: 'Single Parameter Formula',
  docs: 'https://docsapp.xgenia.com/nodes/math/spf',
  category: 'Math',
  color: 'data',
  searchTags: ['math', 'formula', 'single', 'parameter', 'expression', 'mathjs', 'calculate'],
  initialize: function () {
    this._internal.mathFormula = 'x * 2';
    this._internal.parameterValue = 0;
    this._internal.result = null;
    this._internal.lastError = null;
  },
  getInspectInfo() {
    if (this._internal.lastError) {
      return { type: 'text', value: `Error: ${this._internal.lastError}` };
    }

    if (this._internal.result === null) {
      return { type: 'text', value: '[Not calculated yet]' };
    }

    return { type: 'text', value: `Result: ${this._internal.result}` };
  },
  inputs: {
    mathFormula: {
      type: 'string',
      displayName: 'Math Formula',
      group: 'Parameters',
      default: 'x * 2',
      set: function (value) {
        try {
          this._internal.mathFormula = value || 'x * 2';
          this._internal.lastError = null;
          // Test the formula with x=0 to validate syntax
          evaluateFormula(this._internal.mathFormula, 0);
        } catch (error) {
          this._internal.lastError = error.message;
          this._internal.result = null;
          this.flagOutputDirty('result');
          console.error('Single Parameter Formula - Formula error:', error.message);
        }
      }
    },
    parameterValue: {
      type: 'number',
      displayName: 'Parameter Value (x)',
      group: 'Parameters',
      default: 0,
      set: function (value) {
        try {
          this._internal.parameterValue = validateBoundedNumber(value);
          this._internal.lastError = null;
        } catch (error) {
          this._internal.lastError = error.message;
          this._internal.result = null;
          this.flagOutputDirty('result');
          console.error('Single Parameter Formula - Parameter error:', error.message);
        }
      }
    },
    Do: {
      type: 'signal',
      displayName: 'Do',
      group: 'Actions',
      valueChangedToTrue: function () {
        this.calculateResult();
      }
    }
  },
  outputs: {
    result: {
      type: 'number',
      displayName: 'Result',
      group: 'General',
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
    calculateResult: function () {
      try {
        if (this._internal.lastError) {
          console.error('Single Parameter Formula - Cannot calculate due to error:', this._internal.lastError);
          // Still emit Done so the signal chain completes instead of deadlocking.
          this.sendSignalOnOutput('Done');
          return;
        }

        const formula = this._internal.mathFormula;
        const parameterValue = this._internal.parameterValue;

        // Calculate the result
        const result = evaluateFormula(formula, parameterValue);

        // Validate the result
        if (!isFinite(result)) {
          throw new Error(`Formula produced non-finite value: ${result}`);
        }
        if (result > MAX_VALUE || result < MIN_VALUE) {
          throw new Error(`Formula result (${result}) exceeds allowed range (${MIN_VALUE} to ${MAX_VALUE})`);
        }

        this._internal.result = result;
        this._internal.lastError = null;

        // Flag output as dirty and send signal
        this.flagOutputDirty('result');
        this.sendSignalOnOutput('Done');
      } catch (error) {
        this._internal.lastError = error.message;
        this._internal.result = null;
        this.flagOutputDirty('result');
        console.error('Single Parameter Formula error:', error);
        // Still emit Done on error so the signal chain completes instead of
        // deadlocking downstream consumers.
        this.sendSignalOnOutput('Done');
      }
    }
  }
};

module.exports = {
  node: SingleParameterFormulaNode
};
