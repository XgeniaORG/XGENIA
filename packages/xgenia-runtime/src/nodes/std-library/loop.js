'use strict';

const LoopNode = {
  name: 'Loop',
  docs: 'https://docsapp.xgenia.com/nodes/utilities/loop',
  category: 'Utilities',
  initialize: function () {
    this._internal.index = 0;
    this._internal.initialIndex = 0;
    this._internal.steps = 1;
    this._internal.lessThan = 1;
    this._internal.moreThan = -1;
    this._internal.isRunning = false;
  },
  getInspectInfo() {
    return 'Index: ' + this._internal.index;
  },
  inputs: {
    Do: {
      type: 'signal',
      group: 'Actions',
      displayName: 'Do',
      valueChangedToTrue: function () {
        // Reset index to initial value when starting
        this._internal.index = this._internal.initialIndex;
        this._internal.isRunning = true;
        this.flagOutputDirty('currentIndex');
        this.flagOutputDirty('index');
        this.sendSignalOnOutput('indexUpdated');
      }
    },
    next: {
      type: 'signal',
      group: 'Actions',
      displayName: 'Next Iteration',
      valueChangedToTrue: function () {
        if (!this._internal.isRunning) {
          return;
        }

        // Increment index by steps
        this._internal.index += this._internal.steps;

        // Check conditions before incrementing
        let shouldContinue = true;

        if (this._internal.steps > 0) {
          // For positive steps, check if index is less than the limit
          if (this._internal.index >= this._internal.lessThan) {
            shouldContinue = false;
          }
        } else if (this._internal.steps < 0) {
          // For negative steps, check if index is more than the limit
          if (this._internal.index <= this._internal.moreThan) {
            shouldContinue = false;
          }
        }

        if (shouldContinue) {
          this.flagOutputDirty('currentIndex');
          this.flagOutputDirty('index');
          // Only emit signal if index meets the condition to continue
          this.sendSignalOnOutput('indexUpdated');
        } else {
          this._internal.isRunning = false;
          // Send finished signal when loop is completed
          this.sendSignalOnOutput('Done');
        }
      }
    },
    index: {
      type: 'number',
      displayName: 'Initial Index',
      default: 0,
      set: function (value) {
        this._internal.initialIndex = Number(value);
        // Only update current index if loop is not running
        if (!this._internal.isRunning) {
          this._internal.index = this._internal.initialIndex;
          // this.flagOutputDirty('currentIndex');
          // this.flagOutputDirty('index');
        }
      }
    },
    steps: {
      type: 'number',
      displayName: 'Steps',
      default: 1,
      set: function (value) {
        this._internal.steps = Number(value);
      }
    },
    lessThan: {
      type: 'number',
      displayName: 'Less Than',
      group: 'Conditions',
      default: 1,
      set: function (value) {
        this._internal.lessThan = Number(value);
      }
    },
    moreThan: {
      type: 'number',
      displayName: 'More Than',
      group: 'Conditions',
      default: -1,
      set: function (value) {
        this._internal.moreThan = Number(value);
      }
    }
  },
  outputs: {
    index: {
      displayName: 'Index',
      type: 'number',
      getter: function () {
        return this._internal.index;
      }
    },
    currentIndex: {
      displayName: 'Current Index',
      type: 'number',
      getter: function () {
        return this._internal.index;
      }
    },
    indexUpdated: {
      displayName: 'Index Updated',
      type: 'signal'
    },
    Done: {
      displayName: 'Done',
      type: 'signal'
    }
  }
};

module.exports = {
  node: LoopNode
};
