'use strict';

let crypto;
try {
  crypto = require('crypto');
} catch (e) {
  crypto = null;
}

const { sha256Hex } = require('./lib/sha256');

const ServerSeedGeneratorNode = {
  name: 'Server Seed Generator',
  docs: 'https://docsapp.xgenia.com/nodes/math/server-seed-generator',
  category: 'Math',
  color: 'data',
  searchTags: ['server', 'seed', 'generator', 'random', 'crypto', 'rgs', 'provably', 'fair'],
  initialize: function () {
    this._internal.lastServerSeed = null;
    this._internal.nonce = 0;
    this._internal.lastError = null;
    this._internal.inspectData = null;
  },
  getInspectInfo() {
    if (this._internal.lastError) {
      return { type: 'text', value: `Error: ${this._internal.lastError}` };
    }
    return this._internal.inspectData
      ? { type: 'value', value: this._internal.inspectData }
      : { type: 'text', value: '[Not generated yet]' };
  },
  inputs: {
    Do: {
      type: 'signal',
      displayName: 'Do',
      group: 'Actions',
      valueChangedToTrue: function () {
        this.generateServerSeed();
      }
    }
  },
  outputs: {
    'server seed': {
      displayName: 'Server Seed',
      type: 'string',
      getter: function () {
        return this._internal.lastServerSeed;
      }
    },
    nonce: {
      displayName: 'Nonce',
      type: 'number',
      getter: function () {
        return this._internal.nonce;
      }
    },
    committedHash: {
      displayName: 'Committed Hash',
      type: 'string',
      getter: function () {
        return this._internal.committedHash;
      }
    },
    Done: {
      displayName: 'Done',
      type: 'signal'
    }
  },
  methods: {
    generateServerSeed: function () {
      try {
        // Server seeds are generated locally only. No RGS / edge-function call:
        // the provably-fair generate-seed endpoint requires Studio/operator auth
        // the node doesn't carry, and local generation works everywhere
        // (editor preview included).
        let seed;
        if (crypto && crypto.randomBytes) {
          seed = crypto.randomBytes(32).toString('hex');
        } else if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
          const array = new Uint8Array(32);
          window.crypto.getRandomValues(array);
          seed = Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
        } else {
          seed = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
        }

        // Generate the committed hash
        const committedHash = sha256Hex(seed);

        this._internal.nonce += 1;
        this._internal.lastServerSeed = seed;
        this._internal.committedHash = committedHash;

        this._internal.inspectData = {
          seed: seed,
          committedHash: committedHash,
          nonce: this._internal.nonce,
          timestamp: new Date().toISOString()
        };

        this.flagOutputDirty('server seed');
        this.flagOutputDirty('committedHash');
        this.flagOutputDirty('nonce');
        this.sendSignalOnOutput('Done');
      } catch (error) {
        this._internal.lastError = error.message;
        console.error('Server Seed Generator error:', error);
        this._internal.inspectData = {
          error: error.message,
          timestamp: new Date().toISOString()
        };
        // Still emit Done on error so the signal chain completes instead of
        // deadlocking downstream consumers.
        this.sendSignalOnOutput('Done');
      }
    }
  }
};

module.exports = {
  node: ServerSeedGeneratorNode
};
