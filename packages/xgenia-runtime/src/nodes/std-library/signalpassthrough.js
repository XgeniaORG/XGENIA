'use strict';

const SignalPassthroughNode = {
  name: 'Relay',
  docs: 'https://docsapp.xgenia.com/nodes/events/signal-passthrough',
  category: 'Events',
  displayNodeName: 'Relay',
  shortDesc: 'Receives a signal input and outputs the same signal. Useful for organizing signal flow.',
  color: 'default',
  initialize: function () {
    // No internal state needed for simple passthrough
  },
  inputs: {
    input: {
      displayName: 'Signal In',
      type: 'signal',
      valueChangedToTrue: function () {
        // When input signal is received, immediately send it to output
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
  node: SignalPassthroughNode
};
