'use strict';

function invert(value) {
  if (value === undefined) {
    return undefined;
  }
  return !value;
}

const InverterNode = {
  name: 'Inverter',
  docs: 'https://docsapp.xgenia.com/nodes/logic/inverter',
  category: 'Logic',
  initialize: function () {
    this._internal.currentValue = undefined;
  },
  getInspectInfo() {
    return String(invert(this._internal.currentValue));
  },
  inputs: {
    value: {
      type: {
        name: 'boolean'
      },
      displayName: 'Value',
      set: function (value) {
        this._internal.currentValue = value;
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
        return invert(this._internal.currentValue);
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
        const current = invert(this._internal.currentValue);
        // ensure result reflects latest value for any listeners
        if (this._internal.result !== current) {
          this._internal.result = current;
          this.flagOutputDirty('result');
        }

        if (current === true) {
          this.sendSignalOnOutput('trueCondition');
        } else if (current === false) {
          this.sendSignalOnOutput('falseCondition');
        }
      });
    }
  }
};

module.exports = {
  node: InverterNode
};
