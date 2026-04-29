'use strict';

const Collection = require('@xgenia/runtime/src/collection');

function normalizeToArray(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input;
  if (input instanceof Collection) return input.items || [];
  if (Array.isArray(input.items)) return input.items;
  return [];
}

const IteratorNode = {
  name: 'Iterator',
  docs: 'https://docsapp.xgenia.com/nodes/data/array/iterator',
  displayNodeName: 'Iterator',
  shortDesc: 'Iterates through an array on Next; Reset returns to start.',
  category: 'Data',
  color: 'data',

  initialize: function () {
    this._internal.items = [];
    this._internal.index = -1;
    this._internal.currentValue = null;
  },

  getInspectInfo() {
    const length = Array.isArray(this._internal.items) ? this._internal.items.length : 0;
    return [
      { type: 'text', value: `Index: ${this._internal.index} / ${Math.max(length - 1, -1)}` },
      { type: 'value', value: this._internal.currentValue }
    ];
  },

  inputs: {
    array: {
      type: 'array',
      displayName: 'Array',
      group: 'Input',
      default: [],
      set: function (value) {
        this._internal.items = normalizeToArray(value);
      }
    },
    next: {
      type: 'signal',
      displayName: 'Next',
      group: 'Actions',
      valueChangedToTrue: function () {
        this._advance();
      }
    },
    reset: {
      type: 'signal',
      displayName: 'Reset',
      group: 'Actions',
      valueChangedToTrue: function () {
        this._reset();
      }
    }
  },

  outputs: {
    value: {
      type: '*',
      displayName: 'Value',
      group: 'Output',
      getter: function () {
        return this._internal.currentValue;
      }
    },
    done: {
      type: 'signal',
      displayName: 'Done',
      group: 'Events'
    }
  },

  methods: {
    _reset: function () {
      this._internal.index = -1;
      this._internal.currentValue = null;
      this.flagOutputDirty('value');
    },
    _advance: function () {
      const items = this._internal.items || [];
      const length = Array.isArray(items) ? items.length : 0;
      if (length === 0) {
        // No items; value stays null
        this._internal.currentValue = null;
        this.flagOutputDirty('value');
        return;
      }

      if (this._internal.index < length - 1) {
        this._internal.index++;
        this._internal.currentValue = items[this._internal.index];
        this.flagOutputDirty('value');
        this.sendSignalOnOutput('done');
      }
      // If already at end, do not change value
    }
  }
};

module.exports = {
  node: IteratorNode
};
