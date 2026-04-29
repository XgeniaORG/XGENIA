'use strict';

const BooleanToSignalNode = {
  name: 'Boolean To Signal',
  docs: 'https://docsapp.xgenia.com/nodes/events/boolean-to-signal',
  category: 'Events',
  displayNodeName: 'Boolean To Signal',
  shortDesc: 'Receives a boolean input and output the signal',
  color: 'default',
  initialize: function () {
    // No internal state needed for boolean to signal conversion
  },
  inputs: {
    input: {
      displayName: 'Signal In',
      type: 'boolean',
      set: function () {
        // When boolean of any value is set, output the signal
        this.sendSignalOnOutput('output');
      }
    }
  },
  outputs: {
    output: {
      displayName: 'Signal Out',
      type: 'signal'
    }
  }
};

module.exports = {
  node: BooleanToSignalNode
};
