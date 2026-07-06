'use strict';

const { validateNumber } = require('./lib/validate-number');

const HitFrequencyMonitorNode = {
  name: 'Hit Frequency Monitor',
  docs: 'https://docsapp.xgenia.com/nodes/math/hit-frequency-monitor',
  category: 'Math',
  color: 'data',
  searchTags: ['hit frequency', 'monitor', 'simulation', 'math'],
  initialize: function () {
    this._internal.winAmount = 0;
    this._internal.totalGames = 0;
    this._internal.totalWins = 0;
    this._internal.hitFrequency = 0;
    this._internal.lastError = null;
  },
  getInspectInfo() {
    if (this._internal.lastError) {
      return { type: 'text', value: `Error: ${this._internal.lastError}` };
    }
    return {
      type: 'value',
      value: `Total Games: ${this._internal.totalGames}, Total Wins: ${this._internal.totalWins}, Hit Frequency: ${this._internal.hitFrequency}%`
    };
  },
  inputs: {
    Do: {
      type: 'signal',
      displayName: 'Do',
      group: 'Actions',
      valueChangedToTrue: function () {
        this.calculate();
      }
    },
    Reset: {
      type: 'signal',
      displayName: 'Reset',
      group: 'Actions',
      valueChangedToTrue: function () {
        this._internal.totalGames = 0;
        this._internal.totalWins = 0;
        this._internal.hitFrequency = 0;
        this._internal.lastError = null;
        this.flagOutputDirty('Hit Frequency');
      }
    },
    winAmount: {
      type: 'number',
      displayName: 'Win Amount',
      group: 'Data',
      default: 0,
      set: function (value) {
        try {
          this._internal.winAmount = validateNumber(value);
          this._internal.lastError = null;
        } catch (error) {
          this._internal.lastError = error.message;
          console.error('Hit Frequency Monitor Node - Win Amount error:', error.message);
        }
      }
    }
  },
  outputs: {
    'Hit Frequency': {
      displayName: 'Hit Frequency',
      type: 'number',
      getter: function () {
        return this._internal.hitFrequency;
      }
    },
    Done: {
      displayName: 'Done',
      type: 'signal'
    }
  },
  methods: {
    calculate: function () {
      // Every exit fires Done — a Do without a Done deadlocks any signal chain
      // wired through this node (same class as the slot-maths reels-never-stop bug).
      try {
        if (this._internal.lastError) {
          this.sendSignalOnOutput('Done');
          return;
        }

        this._internal.totalGames += 1;
        if (this._internal.winAmount > 0) {
          this._internal.totalWins += 1;
        }

        if (this._internal.totalGames > 0) {
          this._internal.hitFrequency = (this._internal.totalWins / this._internal.totalGames) * 100;
        } else {
          this._internal.hitFrequency = 0;
        }

        this.flagOutputDirty('Hit Frequency');
        this.sendSignalOnOutput('Done');
      } catch (error) {
        this._internal.lastError = error.message;
        console.error('Hit Frequency Monitor Node - Calculate error:', error.message);
        this.sendSignalOnOutput('Done');
      }
    }
  }
};

module.exports = {
  node: HitFrequencyMonitorNode
};
