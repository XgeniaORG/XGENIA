'use strict';

const { sha256Hex } = require('./lib/sha256');

const VerifyFairnessNode = {
  name: 'Verify Fairness',
  docs: 'https://docsapp.xgenia.com/nodes/math/verify-fairness',
  category: 'Math',
  color: 'data',
  description: 'Verifies that a bet outcome was predetermined before placement and not altered during gameplay.',
  searchTags: ['verify', 'fairness', 'provably', 'fair', 'seed', 'nonce', 'hash', 'hmac', 'betslip'],
  initialize: function () {
    this._internal.isFair = false;
  },
  inputs: {
    'Do': {
      type: 'signal',
      displayName: 'Do',
      group: 'Actions',
      valueChangedToTrue: function () {
        this.verify();
      }
    },
    'serverSeed': {
      type: 'string',
      defaultValue: '',
      displayName: 'Server Seed'
    },
    'clientSeed': {
      type: 'string',
      defaultValue: '',
      displayName: 'Client Seed'
    },
    'nonce': {
      type: 'number',
      defaultValue: 0,
      displayName: 'Nonce'
    },
    'expectedHash': {
      type: 'string',
      defaultValue: '',
      displayName: 'Expected Hash'
    }
  },
  outputs: {
    'isFair': {
      type: 'boolean',
      displayName: 'isFair',
      getter: function () {
        return this._internal.isFair;
      }
    },
    'Done': {
      type: 'signal',
      displayName: 'Done'
    }
  },
  methods: {
    verify: function () {
      try {
        const serverSeed = this.getInputValue('serverSeed') || '';
        const clientSeed = this.getInputValue('clientSeed') || '';
        const nonce = this.getInputValue('nonce') || 0;
        const expectedHash = this.getInputValue('expectedHash') || '';

        // Combine the seeds and the nonce, then hash (matches Calculate Roll)
        const payload = `${serverSeed}:${clientSeed}:${nonce}`;
        const generatedHash = sha256Hex(payload);

        // Fair only if our hash matches the casino's expected hash
        this._internal.isFair = generatedHash === expectedHash;

        this.flagOutputDirty('isFair');
        this.sendSignalOnOutput('Done');
      } catch (error) {
        console.error('Verify Fairness error:', error);
      }
    }
  }
};

module.exports = {
  node: VerifyFairnessNode
};
