'use strict';

const { sha256Hex } = require('./lib/sha256');

const VerifyCommitmentNode = {
  name: 'Verify Commitment',
  docs: 'https://docsapp.xgenia.com/nodes/math/verify-commitment',
  category: 'Math',
  color: 'data',
  description: 'Verifies the generated server seed by comparing it with its own hash.',
  searchTags: ['verify', 'commitment', 'provably', 'fair', 'seed', 'hash'],
  initialize: function () {
    this._internal.result = false;
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
    'committedHash': {
      type: 'string',
      defaultValue: '',
      displayName: 'Committed Hash'
    }
  },
  outputs: {
    'Result': {
      type: 'boolean',
      displayName: 'Result',
      getter: function () {
        return this._internal.result;
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
        const committedHash = this.getInputValue('committedHash') || '';

        const hash = sha256Hex(serverSeed);

        this._internal.result = (hash === committedHash);

        this.flagOutputDirty('Result');
        this.sendSignalOnOutput('Done');
      } catch (error) {
        console.error('Verify Commitment error:', error);
      }
    }
  }
};

module.exports = {
  node: VerifyCommitmentNode
};
