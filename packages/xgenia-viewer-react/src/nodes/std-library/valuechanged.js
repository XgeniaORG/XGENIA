'use strict';

const ValueChangedNode = {
  name: 'Value Changed',
  docs: 'https://docsapp.xgenia.com/nodes/logic/value-changed',
  category: 'Logic',
  initialize: function () {
    this._internal.lastValue = undefined;
    this._internal.changeCount = 0;
  },
  getInspectInfo() {
    if (this._internal.changeCount) {
      return 'Triggered ' + this._internal.changeCount + (this._internal.changeCount === 1 ? ' time' : ' times');
    }
    return 'Not triggered';
  },
  inputs: {
    value: {
      type: '*',
      displayName: 'Input',
      set: function (value) {
        if (this._internal.lastValue === value) {
          return;
        }

        this._internal.changeCount++;
        this.sendSignalOnOutput('valueChanged');
        this._internal.lastValue = value;
      }
    }
  },
  outputs: {
    valueChanged: {
      type: 'signal',
      displayName: 'Value Changed'
    }
  }
};

module.exports = {
  node: ValueChangedNode
};
