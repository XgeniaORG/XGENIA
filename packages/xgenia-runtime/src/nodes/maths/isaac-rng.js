'use strict';

const MAX_VALUE = 1000000000000;
const MIN_VALUE = 0;

const { validateBoundedNumber } = require('./lib/validate-number');

/**
 * ISAAC (Indirection, Shift, Accumulate, Add, and Count) Random Number Generator
 * Based on the algorithm by Robert J. Jenkins Jr. (1996)
 *
 * This is a cryptographically secure pseudorandom number generator that:
 * - Requires 18.75 instructions per 32-bit value
 * - Has no cycles shorter than 2^40 values
 * - Expected cycle length is 2^8295 values
 * - Produces uniformly distributed, unbiased output
 */
class IsaacRNG {
  constructor(seed, nonce) {
    this.RANDSIZL = 8;
    this.RANDSIZ = 1 << this.RANDSIZL; // 256

    // Internal state
    this.randrsl = new Array(this.RANDSIZ); // Results array
    this.mm = new Array(this.RANDSIZ); // Memory array
    this.aa = 0; // Accumulator
    this.bb = 0; // Previous result
    this.cc = 0; // Counter
    this.randcnt = 0; // Index into results

    // Initialize with seed
    this.init(seed, nonce);
  }

  /**
   * Initialize ISAAC with a seed
   */
  init(seed, nonce) {
    let i;

    // Clear arrays
    for (i = 0; i < this.RANDSIZ; i++) {
      this.mm[i] = 0;
      this.randrsl[i] = 0;
    }

    const hasSeed = seed !== undefined && seed !== null;
    const hasNonce = nonce !== undefined && nonce !== null;

    // Handle seed
    if (hasSeed) {
      if (typeof seed === 'number') {
        // Convert number to array of bytes
        const seedArray = [];
        let num = Math.abs(Math.floor(seed));
        if (num === 0) num = 1; // Avoid all-zero seed

        while (num > 0) {
          seedArray.push(num & 0xff);
          num = Math.floor(num / 256);
        }

        // Fill randrsl with seed data
        for (i = 0; i < Math.min(seedArray.length, this.RANDSIZ * 4); i++) {
          const index = Math.floor(i / 4);
          const bytePos = i % 4;
          this.randrsl[index] |= seedArray[i] << (bytePos * 8);
        }
      } else if (Array.isArray(seed)) {
        // Use array as seed
        for (i = 0; i < Math.min(seed.length, this.RANDSIZ); i++) {
          this.randrsl[i] = seed[i] >>> 0; // Convert to unsigned 32-bit
        }
      }
    }

    // Mix in nonce deterministically (if provided)
    if (hasNonce) {
      if (typeof nonce === 'number') {
        const nonceArray = [];
        let n = Math.abs(Math.floor(nonce));
        // Allow zero nonce; include a fixed constant so zero still affects state when seed present
        if (n === 0) n = 0x9e3779b9; // golden ratio constant
        while (n > 0) {
          nonceArray.push(n & 0xff);
          n = Math.floor(n / 256);
        }
        for (i = 0; i < Math.min(nonceArray.length, this.RANDSIZ * 4); i++) {
          const index = Math.floor(i / 4);
          const bytePos = i % 4;
          this.randrsl[index] ^= nonceArray[i] << (bytePos * 8);
        }
        // Further diffuse nonce across first 8 words
        const nonce32 = Math.abs(Math.floor(nonce)) >>> 0;
        for (let j = 0; j < 8; j++) {
          const rot = ((nonce32 << (j * 4)) | (nonce32 >>> (32 - j * 4))) >>> 0;
          this.randrsl[j] = (this.randrsl[j] ^ rot) >>> 0;
        }
      } else if (Array.isArray(nonce)) {
        for (i = 0; i < Math.min(nonce.length, this.RANDSIZ); i++) {
          this.randrsl[i] = (this.randrsl[i] ^ (nonce[i] >>> 0)) >>> 0;
        }
      }
    }

    // If neither seed nor nonce, use current time and random values
    if (!hasSeed && !hasNonce) {
      const now = Date.now();
      this.randrsl[0] = now & 0xffffffff;
      this.randrsl[1] = (now >>> 32) & 0xffffffff;

      // Fill remaining with Math.random() for entropy
      for (i = 2; i < this.RANDSIZ; i++) {
        this.randrsl[i] = (Math.random() * 0x100000000) >>> 0;
      }
    }

    this.randinit();
  }

  /**
   * Initialize the arrays with the golden ratio
   */
  randinit() {
    let a, b, c, d, e, f, g, h;
    let i;

    // Golden ratio: 0x9e3779b9
    a = b = c = d = e = f = g = h = 0x9e3779b9;

    // Scramble it
    for (i = 0; i < 4; i++) {
      a ^= b << 11;
      d += a;
      b += c;
      b ^= c >>> 2;
      e += b;
      c += d;
      c ^= d << 8;
      f += c;
      d += e;
      d ^= e >>> 16;
      g += d;
      e += f;
      e ^= f << 10;
      h += e;
      f += g;
      f ^= g >>> 4;
      a += f;
      g += h;
      g ^= h << 8;
      b += g;
      h += a;
      h ^= a >>> 9;
      c += h;
      a += b;
    }

    // Fill in mm[] with messy stuff
    for (i = 0; i < this.RANDSIZ; i += 8) {
      a += this.randrsl[i];
      b += this.randrsl[i + 1];
      c += this.randrsl[i + 2];
      d += this.randrsl[i + 3];
      e += this.randrsl[i + 4];
      f += this.randrsl[i + 5];
      g += this.randrsl[i + 6];
      h += this.randrsl[i + 7];

      a ^= b << 11;
      d += a;
      b += c;
      b ^= c >>> 2;
      e += b;
      c += d;
      c ^= d << 8;
      f += c;
      d += e;
      d ^= e >>> 16;
      g += d;
      e += f;
      e ^= f << 10;
      h += e;
      f += g;
      f ^= g >>> 4;
      a += f;
      g += h;
      g ^= h << 8;
      b += g;
      h += a;
      h ^= a >>> 9;
      c += h;
      a += b;

      this.mm[i] = a;
      this.mm[i + 1] = b;
      this.mm[i + 2] = c;
      this.mm[i + 3] = d;
      this.mm[i + 4] = e;
      this.mm[i + 5] = f;
      this.mm[i + 6] = g;
      this.mm[i + 7] = h;
    }

    // Do a second pass to make all of the seed affect all of mm
    for (i = 0; i < this.RANDSIZ; i += 8) {
      a += this.mm[i];
      b += this.mm[i + 1];
      c += this.mm[i + 2];
      d += this.mm[i + 3];
      e += this.mm[i + 4];
      f += this.mm[i + 5];
      g += this.mm[i + 6];
      h += this.mm[i + 7];

      a ^= b << 11;
      d += a;
      b += c;
      b ^= c >>> 2;
      e += b;
      c += d;
      c ^= d << 8;
      f += c;
      d += e;
      d ^= e >>> 16;
      g += d;
      e += f;
      e ^= f << 10;
      h += e;
      f += g;
      f ^= g >>> 4;
      a += f;
      g += h;
      g ^= h << 8;
      b += g;
      h += a;
      h ^= a >>> 9;
      c += h;
      a += b;

      this.mm[i] = a;
      this.mm[i + 1] = b;
      this.mm[i + 2] = c;
      this.mm[i + 3] = d;
      this.mm[i + 4] = e;
      this.mm[i + 5] = f;
      this.mm[i + 6] = g;
      this.mm[i + 7] = h;
    }

    this.isaac(); // Fill in the first set of results
    this.randcnt = this.RANDSIZ; // Prepare to use the first set
  }

  /**
   * Generate 256 32-bit random numbers
   */
  isaac() {
    let i;
    let x, y;

    this.cc++; // cc just gets incremented once per 256 results
    this.bb += this.cc; // then combined with bb

    for (i = 0; i < this.RANDSIZ; i++) {
      x = this.mm[i];

      switch (i % 4) {
        case 0:
          this.aa ^= this.aa << 13;
          break;
        case 1:
          this.aa ^= this.aa >>> 6;
          break;
        case 2:
          this.aa ^= this.aa << 2;
          break;
        case 3:
          this.aa ^= this.aa >>> 16;
          break;
      }

      this.aa += this.mm[(i + 128) % this.RANDSIZ];
      this.mm[i] = y = (this.mm[(x >>> 2) & 0xff] + this.aa + this.bb) >>> 0;
      this.randrsl[i] = this.bb = (this.mm[(y >>> 10) & 0xff] + x) >>> 0;
    }
  }

  /**
   * Get the next random 32-bit unsigned integer
   */
  next() {
    if (this.randcnt >= this.RANDSIZ) {
      this.isaac();
      this.randcnt = 0;
    }

    return this.randrsl[this.randcnt++];
  }

  /**
   * Get the next random number in the range [0, 1)
   */
  random() {
    return this.next() / 0x100000000;
  }

  /**
   * Get the next random integer in the range [min, max)
   */
  randomInt(min, max) {
    return min + Math.floor(this.random() * (max - min));
  }

  /**
   * Get the next random number in the range [min, max)
   */
  randomFloat(min, max) {
    return min + this.random() * (max - min);
  }
}

const IsaacRNGGeneratorNode = {
  name: 'ISAAC Random Number Generator',
  docs: 'https://docsapp.xgenia.com/nodes/math/isaac-rng',
  category: 'Math',
  color: 'data',
  searchTags: ['random', 'generator', 'isaac', 'cryptographic', 'secure', 'number'],
  initialize: function () {
    this._internal.seed = null;
    this._internal.nonce = null;
    this._internal.isaac = null;
    this._internal.lastGeneratedValue = null;
    this._internal.inspectData = null;
    this._internal.lastError = null;
    this._internal.mode = 'local';
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
    mode: {
      type: {
        name: 'enum',
        enums: [
          { value: 'local', label: 'Local' },
          { value: 'xgenia', label: 'XGENIA RGS' }
        ]
      },
      displayName: 'Mode',
      group: 'Configuration',
      default: 'local',
      set: function (value) {
        this._internal.mode = value || 'local';
      }
    },
    seed: {
      type: 'number',
      displayName: 'Seed',
      group: 'Configuration',
      default: null,
      set: function (value) {
        try {
          if (value === null || value === undefined || value === '') {
            this._internal.seed = null;
          } else {
            this._internal.seed = validateBoundedNumber(value, 0);
          }
          // Reset ISAAC instance when seed changes
          this._internal.isaac = null;
          this._internal.lastError = null;
        } catch (error) {
          this._internal.lastError = error.message;
          console.error('ISAAC RNG Node - Seed error:', error.message);
        }
      }
    },
    nonce: {
      type: 'number',
      displayName: 'Nonce',
      group: 'Configuration',
      default: null,
      set: function (value) {
        try {
          if (value === null || value === undefined || value === '') {
            this._internal.nonce = null;
          } else {
            this._internal.nonce = validateBoundedNumber(value, 0);
          }
          // Reset ISAAC instance when nonce changes
          this._internal.isaac = null;
          this._internal.lastError = null;
        } catch (error) {
          this._internal.lastError = error.message;
          console.error('ISAAC RNG Node - Nonce error:', error.message);
        }
      }
    },
    Do: {
      type: 'signal',
      displayName: 'Do',
      group: 'Actions',
      valueChangedToTrue: function () {
        this.generateRandomValue();
      }
    }
  },
  outputs: {
    value: {
      displayName: 'Generated Value',
      type: 'number',
      getter: function () {
        return this._internal.lastGeneratedValue;
      }
    },
    Done: {
      displayName: 'Done',
      type: 'signal'
    }
  },
  methods: {
    generateRandomValue: function () {
      try {
        if (this._internal.lastError) {
          console.error('ISAAC RNG Node - Cannot generate due to input error:', this._internal.lastError);
          return;
        }

        if (this._internal.mode === 'xgenia') {
          this._generateFromRGS();
          return;
        }

        this._generateLocal();
      } catch (error) {
        this._internal.lastError = error.message;
        console.error('ISAAC Random Number Generator error:', error);
        this._internal.inspectData = {
          error: error.message,
          timestamp: new Date().toISOString()
        };
      }
    },

    _generateLocal: function () {
      const min = 0;
      const max = MAX_VALUE;

      // Always initialize ISAAC fresh so same seed+nonce => same output per run
      this._internal.isaac = new IsaacRNG(this._internal.seed, this._internal.nonce);

      // Generate random value using ISAAC
      let randomValue;
      if (Number.isInteger(min) && Number.isInteger(max)) {
        randomValue = this._internal.isaac.randomInt(min, max);
      } else {
        randomValue = this._internal.isaac.randomFloat(min, max);
      }

      this._internal.lastGeneratedValue = randomValue;
      this._internal.inspectData = {
        value: randomValue,
        range: `${min} - ${max}`,
        type: 'integer',
        seed: this._internal.seed || 'auto-generated',
        nonce: this._internal.nonce ?? 'none',
        algorithm: 'ISAAC (Local)',
        mode: 'local',
        timestamp: new Date().toISOString()
      };

      this.flagOutputDirty('value');
      this.sendSignalOnOutput('Done');
    },

    _generateFromRGS: function () {
      // FAILURE SEMANTICS (2026-07-03, decided): on ANY RGS failure, FALL BACK to the
      // local ISAAC generator instead of silently stalling the signal chain (the old
      // behavior — no Done — deadlocked the spin). The fallback value is still genuine
      // ISAAC randomness; only server-side verifiability is lost, which is irrelevant in
      // the editor PREVIEW (real-money play runs the RGS-compiled script server-side,
      // never this node). The warn + inspectData make the degradation visible.
      const xrgs = typeof window !== 'undefined' && window.__xrgs;
      if (!xrgs) {
        this._internal.lastError = 'RGS not connected — fell back to LOCAL ISAAC for this value. Open Maths Panel and connect for server RNG.';
        this._internal.inspectData = { error: this._internal.lastError, mode: 'xgenia', fallback: 'local-isaac' };
        console.warn('ISAAC RNG Node:', this._internal.lastError);
        this._generateLocal();
        return;
      }

      const apiKey = xrgs.getApiKey();
      const rgsUrl = xrgs.getUrl();
      if (!apiKey || !rgsUrl) {
        this._internal.lastError = 'RGS API key not set — fell back to LOCAL ISAAC for this value. Open Maths Panel and connect.';
        this._internal.inspectData = { error: this._internal.lastError, mode: 'xgenia', fallback: 'local-isaac' };
        console.warn('ISAAC RNG Node:', this._internal.lastError);
        this._generateLocal();
        return;
      }

      const self = this;

      fetch(rgsUrl + '/spin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Operator-Key': apiKey },
        body: JSON.stringify({ action: 'rng', count: 1 })
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data.error) {
            self._internal.lastError = 'RGS error: ' + data.error + ' — fell back to LOCAL ISAAC for this value.';
            self._internal.inspectData = { error: self._internal.lastError, mode: 'xgenia', fallback: 'local-isaac' };
            console.warn('ISAAC RNG Node RGS error (falling back to local ISAAC):', data.error);
            self._generateLocal();
            return;
          }

          const randomValue = data.values ? data.values[0] : data.value;
          self._internal.lastGeneratedValue = randomValue;
          self._internal.inspectData = {
            value: randomValue,
            algorithm: 'ISAAC (XGENIA RGS)',
            mode: 'xgenia',
            source: 'server',
            timestamp: new Date().toISOString()
          };

          self.flagOutputDirty('value');
          self.sendSignalOnOutput('Done');
        })
        .catch(function (err) {
          self._internal.lastError = 'RGS request failed: ' + err.message + ' — fell back to LOCAL ISAAC for this value.';
          self._internal.inspectData = { error: self._internal.lastError, mode: 'xgenia', fallback: 'local-isaac' };
          console.warn('ISAAC RNG Node fetch error (falling back to local ISAAC):', err);
          self._generateLocal();
        });
    }
  }
};

module.exports = {
  node: IsaacRNGGeneratorNode
};
