'use strict';

const Model = require('../../model');
const Collection = require('../../collection');
const { evaluate } = require('mathjs');

const MAX_VALUE = 1000000000000;
const MIN_VALUE = -1000000000000;
const MAX_ARRAY_LENGTH = 10000;

function validateArrayLength(length) {
  const len = Number(length);
  if (isNaN(len) || len < 0) {
    throw new Error('Array length must be a valid positive number');
  }
  if (len > MAX_ARRAY_LENGTH) {
    throw new Error(`Array length cannot exceed ${MAX_ARRAY_LENGTH}`);
  }
  return Math.floor(len);
}

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

const MathFormulaArrayGeneratorNode = {
  name: 'Formula-Generated Array',
  docs: 'https://docsapp.xgenia.com/nodes/math/mfag',
  category: 'Math',
  color: 'data',
  searchTags: ['math', 'formula', 'array', 'generator', 'expression', 'mathjs'],
  initialize: function () {
    this._internal.mathFormula = 'exp(-x / 15)';
    this._internal.arrayLength = 10;
    this._internal.collection = null;
    this._internal.lastError = null;
  },
  getInspectInfo() {
    if (this._internal.lastError) {
      return { type: 'text', value: `Error: ${this._internal.lastError}` };
    }

    const collection = this._internal.collection;
    if (!collection) {
      return { type: 'text', value: '[Not generated yet]' };
    }

    // Match the standard Array node inspect pattern with count
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
    mathFormula: {
      type: 'string',
      displayName: 'Math Formula',
      group: 'Parameters',
      default: 'exp(-x / 15)',
      set: function (value) {
        try {
          this._internal.mathFormula = value || 'exp(-x / 15)';
          this._internal.lastError = null;
          // Test the formula with x=0 to validate syntax
          evaluateFormula(this._internal.mathFormula, 0);
        } catch (error) {
          this._internal.lastError = error.message;
          console.error('Formula-Generated Array - Formula error:', error.message);
        }
      }
    },
    arrayLength: {
      type: 'number',
      displayName: 'Array Length',
      group: 'Parameters',
      default: 10,
      set: function (value) {
        try {
          this._internal.arrayLength = validateArrayLength(value);
          this._internal.lastError = null;
        } catch (error) {
          this._internal.lastError = error.message;
          console.error('Formula-Generated Array - Array Length error:', error.message);
        }
      }
    },
    Do: {
      type: 'signal',
      displayName: 'Do',
      group: 'Actions',
      valueChangedToTrue: function () {
        this.generateArray();
      }
    }
  },
  outputs: {
    id: {
      type: 'string',
      displayName: 'Id',
      group: 'General',
      getter: function () {
        return this._internal.collection ? this._internal.collection.getId() : undefined;
      }
    },
    items: {
      displayName: 'Items',
      type: 'array',
      group: 'General',
      getter: function () {
        return this._internal.collection;
      }
    },
    firstItemId: {
      type: 'string',
      displayName: 'First Item Id',
      group: 'General',
      getter: function () {
        if (this._internal.collection) {
          var firstItem = this._internal.collection.get(0);
          if (firstItem !== undefined) return firstItem.getId();
        }
      }
    },
    count: {
      type: 'number',
      displayName: 'Count',
      group: 'General',
      getter: function () {
        return this._internal.collection ? this._internal.collection.size() : 0;
      }
    },
    Done: {
      displayName: 'Done',
      type: 'signal'
    }
  },
  methods: {
    generateArray: function () {
      try {
        if (this._internal.lastError) {
          console.error('Formula-Generated Array - Cannot generate due to error:', this._internal.lastError);
          return;
        }

        const formula = this._internal.mathFormula;
        const length = this._internal.arrayLength;

        // Create a new collection with its own ID
        const collection = Collection.get();

        if (length === 0) {
          collection.set([]);
          this._internal.collection = collection;
          this.flagOutputDirty('id');
          this.flagOutputDirty('items');
          this.flagOutputDirty('firstItemId');
          this.flagOutputDirty('count');
          this.sendSignalOnOutput('Done');
          return;
        }

        const generatedItems = [];

        for (let x = 0; x < length; x++) {
          try {
            const evaluatedValue = evaluateFormula(formula, x);

            // Validate the result
            if (!isFinite(evaluatedValue)) {
              throw new Error(`Formula produced non-finite value at x=${x}: ${evaluatedValue}`);
            }
            if (evaluatedValue > MAX_VALUE || evaluatedValue < MIN_VALUE) {
              throw new Error(
                `Formula result at x=${x} (${evaluatedValue}) exceeds allowed range (${MIN_VALUE} to ${MAX_VALUE})`
              );
            }

            // Create a proper Model with the calculated value
            const itemData = {
              0: evaluatedValue
            };

            generatedItems.push(itemData);
          } catch (error) {
            this._internal.lastError = `Error at index ${x}: ${error.message}`;
            // Emit Done before bailing so the signal chain doesn't deadlock
            // when a single formula index fails.
            this.sendSignalOnOutput('Done');
            return;
          }
        }

        // Set the items in the collection (this will create Models automatically)
        collection.set(generatedItems);
        this._internal.collection = collection;

        // Flag all outputs as dirty
        this.flagOutputDirty('id');
        this.flagOutputDirty('items');
        this.flagOutputDirty('firstItemId');
        this.flagOutputDirty('count');
        this.sendSignalOnOutput('Done');
      } catch (error) {
        this._internal.lastError = error.message;
        console.error('Formula-Generated Array error:', error);
        // Still emit Done on error so the signal chain completes instead of
        // deadlocking downstream consumers.
        this.sendSignalOnOutput('Done');
      }
    }
  }
};

module.exports = {
  node: MathFormulaArrayGeneratorNode
};
