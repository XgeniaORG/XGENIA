'use strict';

const { sha256Hex } = require('./lib/sha256');
const { hashToRange } = require('./lib/hash-to-range');

const CalculateRollNode = {
  name: 'Calculate Roll',
  docs: 'https://docsapp.xgenia.com/nodes/math/calculate-roll',
  category: 'Math',
  color: 'data',
  description: 'Calculates a provably fair roll based on client seed, server seed, and nonce.',
  searchTags: ['calculate', 'roll', 'provably', 'fair', 'seed', 'nonce', 'hash', 'random'],
  initialize: function () {
    this._internal.result = 0;
    this._internal['combinedString hash'] = '';
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
    'client seed': {
      type: 'string',
      defaultValue: ''
    },
    'server seed': {
      type: 'string',
      defaultValue: ''
    },
    nonce: {
      type: 'number',
      defaultValue: 0
    },
    'max range': {
      type: 'number',
      defaultValue: 100
    },
    'min range': {
      type: 'number',
      defaultValue: 0
    }
  },
  outputs: {
    result: {
      type: 'number',
      getter: function () {
        return this._internal.result;
      }
    },
    'combinedString hash': {
      type: 'string',
      getter: function () {
        return this._internal['combinedString hash'];
      }
    },
    Done: {
      type: 'signal',
      displayName: 'Done'
    }
  },
  methods: {
    calculate: function () {
      try {
        const clientSeed = this.getInputValue('client seed') || '';
        const serverSeed = this.getInputValue('server seed') || '';
        const nonce = this.getInputValue('nonce') || 0;
        const maxRange = this.getInputValue('max range');
        const minRange = this.getInputValue('min range');

        const max = maxRange !== undefined ? maxRange : 100;
        const min = minRange !== undefined ? minRange : 0;

        // Combine the inputs exactly as specified
        const combinedString = `${serverSeed}:${clientSeed}:${nonce}`;
        const hash = sha256Hex(combinedString);

        // Map the hash onto the custom min/max range (swapping if inverted)
        this._internal.result = hashToRange(hash, min, max, { swapWhenInverted: true });
        this._internal['combinedString hash'] = hash;

        this.flagOutputDirty('result');
        this.flagOutputDirty('combinedString hash');
        this.sendSignalOnOutput('Done');
      } catch (error) {
        console.error('Calculate Roll error:', error);
        // Still emit Done on error so the signal chain completes instead of
        // deadlocking downstream consumers.
        this.sendSignalOnOutput('Done');
      }
    }
  }
};

module.exports = {
  node: CalculateRollNode
};
