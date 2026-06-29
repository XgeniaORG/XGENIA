'use strict';

const { validateNumber } = require('./lib/validate-number');

const RtpMonitorNode = {
  name: 'RTP Monitor',
  docs: 'https://docsapp.xgenia.com/nodes/math/rtp-monitor',
  category: 'Math',
  color: 'data',
  searchTags: ['rtp', 'monitor', 'return to player', 'simulation', 'math'],
  initialize: function () {
    this._internal.betAmount = 0;
    this._internal.winAmount = 0;
    this._internal.totalBet = 0;
    this._internal.totalWin = 0;
    this._internal.rtp = 0;
    this._internal.lastError = null;
  },
  getInspectInfo() {
    if (this._internal.lastError) {
      return { type: 'text', value: `Error: ${this._internal.lastError}` };
    }
    return {
      type: 'value',
      value: `Total Bet: ${this._internal.totalBet}, Total Win: ${this._internal.totalWin}, RTP: ${this._internal.rtp}%`
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
        this._internal.totalBet = 0;
        this._internal.totalWin = 0;
        this._internal.rtp = 0;
        this._internal.lastError = null;
        this.flagOutputDirty('RTP');
      }
    },
    betAmount: {
      type: 'number',
      displayName: 'Bet Amount',
      group: 'Data',
      default: 0,
      set: function (value) {
        try {
          this._internal.betAmount = validateNumber(value);
          this._internal.lastError = null;
        } catch (error) {
          this._internal.lastError = error.message;
          console.error('RTP Monitor Node - Bet Amount error:', error.message);
        }
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
          console.error('RTP Monitor Node - Win Amount error:', error.message);
        }
      }
    }
  },
  outputs: {
    RTP: {
      displayName: 'RTP',
      type: 'number',
      getter: function () {
        return this._internal.rtp;
      }
    },
    Done: {
      displayName: 'Done',
      type: 'signal'
    }
  },
  methods: {
    calculate: function () {
      try {
        if (this._internal.lastError) {
          return;
        }

        this._internal.totalBet += this._internal.betAmount;
        this._internal.totalWin += this._internal.winAmount;

        if (this._internal.totalBet > 0) {
          this._internal.rtp = (this._internal.totalWin / this._internal.totalBet) * 100;
        } else {
          this._internal.rtp = 0;
        }

        this.flagOutputDirty('RTP');
        this.sendSignalOnOutput('Done');
      } catch (error) {
        this._internal.lastError = error.message;
        console.error('RTP Monitor Node - Calculate error:', error.message);
      }
    }
  }
};

module.exports = {
  node: RtpMonitorNode
};
