'use strict';

const IfNode = {
  name: 'If',
  docs: 'https://docsapp.xgenia.com/nodes/utilities/logic/if',
  category: 'Logic',
  shortDesc: 'Receives a boolean signal and conditionally emits true or false signals when triggered by the Do signal.',
  initialize: function () {
    // No internal state needed for simple if logic
  },
  inputs: {
    input: {
      type: 'boolean',
      displayName: 'Boolean Input',
      group: 'General',
      set: function (value) {
        // Store the boolean value but don't automatically evaluate
        // Evaluation will happen when Do signal is triggered
      }
    },
    do: {
      type: 'signal',
      displayName: 'Do',
      group: 'Control',
      valueChangedToTrue: function () {
        // When Do signal is triggered, evaluate the boolean input and emit appropriate signal
        this.scheduleEvaluate();
      }
    }
  },
  outputs: {
    trueCondition: {
      type: 'signal',
      displayName: 'True Condition',
      group: 'Signals'
    },
    falseCondition: {
      type: 'signal',
      displayName: 'False Condition',
      group: 'Signals'
    }
  },
  methods: {
    scheduleEvaluate: function () {
      this.scheduleAfterInputsHaveUpdated(() => {
        const inputValue = this.getInputValue('input');

        // Emit the appropriate signal based on the boolean input
        if (inputValue === true) {
          this.sendSignalOnOutput('trueCondition');
        } else if (inputValue === false) {
          this.sendSignalOnOutput('falseCondition');
        }
        // If inputValue is undefined/null, don't emit any signal
      });
    }
  }
};

module.exports = {
  node: IfNode
};
