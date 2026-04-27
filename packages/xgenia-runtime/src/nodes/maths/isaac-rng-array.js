'use strict';

const MAX_VALUE = 1000000000000;
const MIN_VALUE = 0;
const MAX_SIZE = 10000;

function validateNumberInput(value, defaultValue = 0) {
  const num = Number(value);
  if (isNaN(num)) {
    throw new Error('Input must be a valid number');
  }
  if (num > MAX_VALUE) {
    throw new Error(`Input cannot exceed ${MAX_VALUE}`);
  }
  if (num < MIN_VALUE) {
    throw new Error(`Input cannot be less than ${MIN_VALUE}`);
  }
  return num;
}

function validateSizeInput(value, defaultValue = 1) {
  const num = Number(value);
  if (isNaN(num) || !Number.isInteger(num)) {
    throw new Error('Size must be a valid integer');
  }
  if (num < 1) {
    throw new Error('Size must be at least 1');
  }
  if (num > MAX_SIZE) {
    throw new Error(`Size cannot exceed ${MAX_SIZE}`);
  }
  return num;
}

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
        if (n === 0) n = 0x9e3779b9; // ensure zero nonce still mixes state
        while (n > 0) {
          nonceArray.push(n & 0xff);
          n = Math.floor(n / 256);
        }
        for (i = 0; i < Math.min(nonceArray.length, this.RANDSIZ * 4); i++) {
          const index = Math.floor(i / 4);
          const bytePos = i % 4;
          this.randrsl[index] ^= nonceArray[i] << (bytePos * 8);
        }
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

const IsaacRNGArrayGeneratorNode = {
  name: 'ISAAC Random Number Array Generator',
  docs: 'https://docsapp.xgenia.com/nodes/math/isaac-rng-array',
  category: 'Math',
  color: 'data',
  searchTags: ['random', 'generator', 'isaac', 'cryptographic', 'secure', 'number', 'array', 'multiple'],
  initialize: function () {
    this._internal.size = 1;
    this._internal.seed = null;
    this._internal.nonce = null;
    this._internal.isaac = null;
    this._internal.lastGeneratedArray = [];
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
    size: {
      type: 'number',
      displayName: 'Size',
      group: 'Array',
      default: 1,
      set: function (value) {
        try {
          this._internal.size = validateSizeInput(value, 1);
          this._internal.lastError = null;
        } catch (error) {
          this._internal.lastError = error.message;
          console.error('ISAAC RNG Array Node - Size error:', error.message);
        }
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
            this._internal.seed = validateNumberInput(value);
          }
          this._internal.isaac = null;
          this._internal.lastError = null;
        } catch (error) {
          this._internal.lastError = error.message;
          console.error('ISAAC RNG Array Node - Seed error:', error.message);
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
            this._internal.nonce = validateNumberInput(value);
          }
          this._internal.isaac = null;
          this._internal.lastError = null;
        } catch (error) {
          this._internal.lastError = error.message;
          console.error('ISAAC RNG Array Node - Nonce error:', error.message);
        }
      }
    },
    Do: {
      type: 'signal',
      displayName: 'Do',
      group: 'Actions',
      valueChangedToTrue: function () {
        this.generateRandomArray();
      }
    }
  },
  outputs: {
    array: {
      displayName: 'Generated Array',
      type: 'array',
      getter: function () {
        return this._internal.lastGeneratedArray;
      }
    },
    Done: {
      displayName: 'Done',
      type: 'signal'
    }
  },
  methods: {
    generateRandomArray: function () {
      try {
        if (this._internal.lastError) {
          console.error('ISAAC RNG Array Node - Cannot generate due to input error:', this._internal.lastError);
          return;
        }

        if (this._internal.mode === 'xgenia') {
          this._generateFromRGS();
          return;
        }

        this._generateLocal();
      } catch (error) {
        this._internal.lastError = error.message;
        console.error('ISAAC Random Number Array Generator error:', error);
        this._internal.inspectData = {
          error: error.message,
          timestamp: new Date().toISOString()
        };
      }
    },

    _generateLocal: function () {
      const min = 0;
      const max = MAX_VALUE;
      const size = this._internal.size;

      this._internal.isaac = new IsaacRNG(this._internal.seed, this._internal.nonce);

      const randomArray = [];
      for (let i = 0; i < size; i++) {
        randomArray.push(this._internal.isaac.randomInt(min, max));
      }

      this._internal.lastGeneratedArray = randomArray;
      this._internal.inspectData = {
        arrayLength: randomArray.length,
        range: `${min} - ${max}`,
        type: 'integer',
        seed: this._internal.seed || 'auto-generated',
        nonce: this._internal.nonce ?? 'none',
        algorithm: 'ISAAC (Local)',
        mode: 'local',
        sample: randomArray.slice(0, Math.min(5, randomArray.length)),
        timestamp: new Date().toISOString()
      };

      this.flagOutputDirty('array');
      this.sendSignalOnOutput('Done');
    },

    _generateFromRGS: function () {
      const xrgs = typeof window !== 'undefined' && window.__xrgs;
      if (!xrgs) {
        this._internal.lastError = 'RGS not connected. Open Maths Panel and enter your API key.';
        this._internal.inspectData = { error: this._internal.lastError, mode: 'xgenia' };
        console.error('ISAAC RNG Array Node:', this._internal.lastError);
        return;
      }

      const apiKey = xrgs.getApiKey();
      const rgsUrl = xrgs.getUrl();
      if (!apiKey || !rgsUrl) {
        this._internal.lastError = 'RGS API key not set. Open Maths Panel and connect.';
        this._internal.inspectData = { error: this._internal.lastError, mode: 'xgenia' };
        console.error('ISAAC RNG Array Node:', this._internal.lastError);
        return;
      }

      const self = this;
      const size = this._internal.size;

      fetch(rgsUrl + '/spin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Operator-Key': apiKey },
        body: JSON.stringify({ action: 'rng', count: size })
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data.error) {
            self._internal.lastError = 'RGS error: ' + data.error;
            self._internal.inspectData = { error: self._internal.lastError, mode: 'xgenia' };
            console.error('ISAAC RNG Array Node RGS error:', data.error);
            return;
          }

          const randomArray = data.values || [];
          self._internal.lastGeneratedArray = randomArray;
          self._internal.inspectData = {
            arrayLength: randomArray.length,
            algorithm: 'ISAAC (XGENIA RGS)',
            mode: 'xgenia',
            source: 'server',
            sample: randomArray.slice(0, Math.min(5, randomArray.length)),
            timestamp: new Date().toISOString()
          };

          self.flagOutputDirty('array');
          self.sendSignalOnOutput('Done');
        })
        .catch(function (err) {
          self._internal.lastError = 'RGS request failed: ' + err.message;
          self._internal.inspectData = { error: self._internal.lastError, mode: 'xgenia' };
          console.error('ISAAC RNG Array Node fetch error:', err);
        });
    }
  }
};

module.exports = {
  node: IsaacRNGArrayGeneratorNode
};
