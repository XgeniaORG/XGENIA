'use strict';

let crypto;
try {
  crypto = require('crypto');
} catch (e) {
  crypto = null;
}

function generateUUID() {
  // Prefer native randomUUID (Node 14.17+, modern browsers)
  if (crypto && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof window !== 'undefined' && window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }

  // Fallback: build an RFC 4122 v4 UUID from random bytes
  let bytes;
  if (crypto && typeof crypto.randomBytes === 'function') {
    bytes = crypto.randomBytes(16);
  } else if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
    bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
  } else {
    bytes = new Array(16);
    for (let i = 0; i < 16; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  // Set the version (4) and variant (RFC 4122) bits
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = [];
  for (let i = 0; i < 16; i++) {
    hex.push((bytes[i] & 0xff).toString(16).padStart(2, '0'));
  }

  return (
    hex[0] + hex[1] + hex[2] + hex[3] + '-' +
    hex[4] + hex[5] + '-' +
    hex[6] + hex[7] + '-' +
    hex[8] + hex[9] + '-' +
    hex[10] + hex[11] + hex[12] + hex[13] + hex[14] + hex[15]
  );
}

const RandomUuidGeneratorNode = {
  name: 'Random UUID Generator',
  docs: 'https://docsapp.xgenia.com/nodes/math/random-uuid-generator',
  category: 'Math',
  color: 'data',
  searchTags: ['random', 'uuid', 'guid', 'generator', 'id', 'identifier', 'unique', 'string'],
  initialize: function () {
    this._internal.uuid = null;
    this._internal.lastError = null;
  },
  getInspectInfo() {
    if (this._internal.lastError) {
      return { type: 'text', value: `Error: ${this._internal.lastError}` };
    }
    return this._internal.uuid
      ? { type: 'value', value: this._internal.uuid }
      : { type: 'text', value: '[Not generated yet]' };
  },
  inputs: {
    Do: {
      type: 'signal',
      displayName: 'Do',
      group: 'Actions',
      valueChangedToTrue: function () {
        this.generate();
      }
    }
  },
  outputs: {
    uuid: {
      displayName: 'UUID',
      type: 'string',
      getter: function () {
        return this._internal.uuid;
      }
    },
    Done: {
      displayName: 'Done',
      type: 'signal'
    }
  },
  methods: {
    generate: function () {
      try {
        this._internal.uuid = generateUUID();
        this._internal.lastError = null;
        this.flagOutputDirty('uuid');
        this.sendSignalOnOutput('Done');
      } catch (error) {
        this._internal.lastError = error.message;
        console.error('Random UUID Generator error:', error.message);
      }
    }
  }
};

module.exports = {
  node: RandomUuidGeneratorNode
};
