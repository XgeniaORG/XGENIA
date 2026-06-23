'use strict';

const ValidateOutcomeNode = {
  name: 'Validate Outcome',
  docs: 'https://docsapp.xgenia.com/nodes/math/validate-outcome',
  category: 'Math',
  color: 'data',
  description: 'Translates a fair hash into a game outcome based on a specified range.',
  searchTags: ['validate', 'outcome', 'fair', 'hash', 'range', 'dice', 'roll', 'betslip'],
  initialize: function () {
    this._internal.rollResult = 0;
  },
  inputs: {
    'Do': {
      type: 'signal',
      displayName: 'Do',
      group: 'Actions',
      valueChangedToTrue: function () {
        this.validate();
      }
    },
    'fairHash': {
      type: 'string',
      defaultValue: '',
      displayName: 'Fair Hash'
    },
    'maxRange': {
      type: 'number',
      defaultValue: 100,
      displayName: 'Max Range'
    },
    'minRange': {
      type: 'number',
      defaultValue: 0,
      displayName: 'Min Range'
    }
  },
  outputs: {
    'rollResult': {
      type: 'number',
      displayName: 'Roll Result',
      getter: function () {
        return this._internal.rollResult;
      }
    },
    'Done': {
      type: 'signal',
      displayName: 'Done'
    }
  },
  methods: {
    validate: function () {
      try {
        const fairHash = this.getInputValue('fairHash') || '';
        let maxRange = this.getInputValue('maxRange');
        let minRange = this.getInputValue('minRange');

        if (maxRange === undefined || maxRange === null) maxRange = 100;
        if (minRange === undefined || minRange === null) minRange = 0;

        // Take the first 8 characters of the hex hash and convert to decimal
        const hexSubset = fairHash.substring(0, 8);
        let decimalValue = parseInt(hexSubset, 16);
        if (isNaN(decimalValue)) {
            decimalValue = 0;
        }

        // Apply modulo for the custom min/max range
        const rangeSize = maxRange - minRange + 1;
        const diceRoll = (decimalValue % rangeSize) + minRange;
        
        console.log(`Hash ${fairHash} translates to a dice roll of: ${diceRoll}`);
        
        this._internal.rollResult = diceRoll;

        this.flagOutputDirty('rollResult');
        this.sendSignalOnOutput('Done');
      } catch (error) {
        console.error('Validate Outcome error:', error);
      }
    }
  }
};

module.exports = ValidateOutcomeNode;
