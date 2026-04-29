'use strict';

const ShowValueNode = {
  name: 'Show Value',
  docs: 'https://docsapp.xgenia.com/nodes/data/show-value',
  category: 'Data',
  color: 'data',
  initialize() {
    this._internal.value = undefined;
  },
  getInspectInfo() {
    if (this._internal.value === undefined) {
      return '[No value set]';
    }

    const value = this._internal.value;

    // Handle different types for display
    if (value === null) {
      return 'null';
    }
    if (typeof value === 'string') {
      return `"${value}"`;
    }
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value, null, 2);
      } catch (e) {
        return '[Object]';
      }
    }

    return String(value);
  },
  inputs: {
    input: {
      type: '*',
      displayName: 'Input',
      group: 'General',
      set(value) {
        this._internal.value = value;
        this.flagOutputDirty('output');
      }
    }
  },
  outputs: {
    output: {
      type: '*',
      displayName: 'Output',
      group: 'General',
      get() {
        return this._internal.value;
      }
    }
  }
};

module.exports = {
  node: ShowValueNode
};
