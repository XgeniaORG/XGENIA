'use strict';

const now = require('performance-now');

const Timestamp = {
  name: 'Timestamp',
  docs: 'https://docsapp.xgenia.com/nodes/utilities/timestamp',
  category: 'Utilities',
  initialize() {
    this._internal.lastTimestamp = 0;
  },
  getInspectInfo() {
    return this._internal.lastTimestamp.toString();
  },
  inputs: {
    input: {
      type: '*',
      displayName: 'Input',
      set(value) {
        // Get high-resolution timestamp in microseconds using performance-now package
        // This provides monotonic timing based on process.hrtime with sub-millisecond precision
        this._internal.lastTimestamp = Math.round(now() * 1000);
        this.flagOutputDirty('timestamp');
      }
    }
  },
  outputs: {
    timestamp: {
      type: 'number',
      displayName: 'Timestamp (μs)',
      get() {
        return this._internal.lastTimestamp;
      }
    }
  }
};

module.exports = {
  node: Timestamp
};
