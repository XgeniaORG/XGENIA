'use strict';

const defaultPaytable = {
  'Classic': {
    '10': { 0: 0, 1: 0, 2: 0, 3: 0, 4: 2, 5: 5, 6: 20, 7: 100, 8: 500, 9: 2000, 10: 10000 },
    '9': { 0: 0, 1: 0, 2: 0, 3: 1, 4: 3, 5: 10, 6: 50, 7: 200, 8: 1000, 9: 5000 },
    '8': { 0: 0, 1: 0, 2: 0, 3: 1, 4: 4, 5: 15, 6: 50, 7: 300, 8: 2000 },
    '7': { 0: 0, 1: 0, 2: 0, 3: 1, 4: 5, 5: 20, 6: 100, 7: 500 },
    '6': { 0: 0, 1: 0, 2: 1, 3: 2, 4: 5, 5: 50, 6: 200 },
    '5': { 0: 0, 1: 0, 2: 1, 3: 5, 4: 20, 5: 100 },
    '4': { 0: 0, 1: 0, 2: 1, 3: 5, 4: 50 },
    '3': { 0: 0, 1: 0, 2: 2, 3: 20 },
    '2': { 0: 0, 1: 1, 2: 5 },
    '1': { 0: 0, 1: 3 }
  },
  'Low': {
    '10': { 0: 1, 1: 0.5, 2: 0, 3: 0, 4: 1, 5: 3, 6: 10, 7: 50, 8: 200, 9: 1000, 10: 5000 }
  },
  'Medium': {
    '10': { 0: 0, 1: 0, 2: 0, 3: 0, 4: 2, 5: 6, 6: 25, 7: 150, 8: 750, 9: 3000, 10: 15000 }
  },
  'High': {
    '10': { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 2, 6: 20, 7: 200, 8: 2000, 9: 10000, 10: 100000 }
  }
};

const EvaluateKenoPaytableNode = {
  name: 'Evaluate Keno Paytable',
  docs: 'https://docsapp.xgenia.com/nodes/math/evaluate-keno-paytable',
  category: 'Math',
  color: 'data',
  description: 'Retrieves the payout multiplier for Keno based on risk profile, spots picked, and hit count.',
  searchTags: ['keno', 'paytable', 'payout', 'multiplier', 'risk'],
  initialize: function () {
    this._internal.multiplier = 0;
  },
  inputs: {
    'Do': {
      type: 'signal',
      displayName: 'Do',
      group: 'Actions',
      valueChangedToTrue: function () {
        this.calculate();
      }
    },
    'risk profile': { type: 'string', defaultValue: 'Classic' },
    'selected spots count': { type: 'number', defaultValue: 10 },
    'hit count': { type: 'number', defaultValue: 0 }
  },
  outputs: {
    'payout multiplier': { type: 'number', getter: function () { return this._internal.multiplier; } },
    'Done': { type: 'signal', displayName: 'Done' }
  },
  methods: {
    calculate: function () {
      try {
        const risk = this.getInputValue('risk profile') || 'Classic';
        const spotsCount = String(this.getInputValue('selected spots count') || 10);
        const hits = this.getInputValue('hit count') || 0;
        
        let mult = 0;
        const profileTable = defaultPaytable[risk] || defaultPaytable['Classic'];
        const spotsTable = profileTable[spotsCount] || profileTable['10'];
        
        if (spotsTable && spotsTable[hits] !== undefined) {
          mult = spotsTable[hits];
        }
        
        this._internal.multiplier = mult;
        
        this.flagOutputDirty('payout multiplier');
        this.sendSignalOnOutput('Done');
      } catch (error) {
        console.error('Evaluate Keno Paytable error:', error);
      }
    }
  }
};

module.exports = EvaluateKenoPaytableNode;
