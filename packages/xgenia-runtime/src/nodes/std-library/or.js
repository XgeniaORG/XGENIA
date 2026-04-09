'use strict';

const OrNode = {
  name: 'Or ',
  docs: 'https://docsapp.xgenia.com/nodes/logic/or',
  category: 'Logic',
  shortDesc: 'Receives two boolean inputs and emits True/False signals when Do is triggered.',
  inputs: {
    a: {
      type: 'boolean',
      displayName: 'A',
      group: 'General',
      set: function () {
        this.flagOutputDirty('result');
      }
    },
    b: {
      type: 'boolean',
      displayName: 'B',
      group: 'General',
      set: function () {
        this.flagOutputDirty('result');
      }
    },
    do: {
      type: 'signal',
      displayName: 'Do',
      group: 'Control',
      valueChangedToTrue: function () {
        this.scheduleEvaluate();
      }
    }
  },
  outputs: {
    result: {
      type: 'boolean',
      displayName: 'Result',
      getter: function () {
        const a = this.getInputValue('a');
        const b = this.getInputValue('b');
        if (a === undefined || a === null || b === undefined || b === null) {
          return undefined;
        }
        return a === true || b === true;
      }
    },
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
        const a = this.getInputValue('a');
        const b = this.getInputValue('b');

        if (a === undefined || a === null || b === undefined || b === null) {
          return; // Do not emit if either input is not set
        }

        // ensure result reflects latest value for any listeners
        this.flagOutputDirty('result');

        if (a === true || b === true) {
          this.sendSignalOnOutput('trueCondition');
        } else if (a === false && b === false) {
          this.sendSignalOnOutput('falseCondition');
        }
      });
    }
  }
};

module.exports = {
  node: OrNode
};
