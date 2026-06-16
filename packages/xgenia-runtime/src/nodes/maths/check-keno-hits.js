'use strict';

const CheckKenoHitsNode = {
  name: 'Check Keno Hits',
  docs: 'https://docsapp.xgenia.com/nodes/math/check-keno-hits',
  category: 'Math',
  color: 'data',
  description: 'Checks how many player selected spots hit the drawn numbers.',
  searchTags: ['keno', 'hits', 'intersection', 'array', 'match'],
  initialize: function () {
    this._internal.hitCount = 0;
    this._internal.hitNumbers = [];
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
    'selected spots': { type: 'array', defaultValue: [] },
    'drawn numbers': { type: 'array', defaultValue: [] }
  },
  outputs: {
    'hit count': { type: 'number', getter: function () { return this._internal.hitCount; } },
    'hit numbers': { type: 'array', getter: function () { return this._internal.hitNumbers; } },
    'Done': { type: 'signal', displayName: 'Done' }
  },
  methods: {
    calculate: function () {
      try {
        const selected = this.getInputValue('selected spots') || [];
        const drawn = this.getInputValue('drawn numbers') || [];
        
        const hitNumbers = [];
        for (let i = 0; i < selected.length; i++) {
          if (drawn.includes(selected[i])) {
            hitNumbers.push(selected[i]);
          }
        }
        
        this._internal.hitCount = hitNumbers.length;
        this._internal.hitNumbers = hitNumbers;
        
        this.flagOutputDirty('hit count');
        this.flagOutputDirty('hit numbers');
        this.sendSignalOnOutput('Done');
      } catch (error) {
        console.error('Check Keno Hits error:', error);
      }
    }
  }
};

module.exports = CheckKenoHitsNode;
