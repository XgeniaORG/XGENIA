'use strict';

const { validateNumber } = require('./lib/validate-number');

const VolatilityMonitorNode = {
  name: 'Volatility Monitor',
  docs: 'https://docsapp.xgenia.com/nodes/math/volatility-monitor',
  category: 'Math',
  color: 'data',
  searchTags: ['volatility', 'variance', 'standard deviation', 'simulation', 'math'],
  initialize: function () {
    // Inputs
    this._internal.value = 0;

    // Outputs
    this._internal.results = {
      volatilityPercentage: 0,
      standardDeviation: 0,
      mean: 0,
      variance: 0,
      amplitude: 0
    };

    // Accumulator to retain values across executions until reset
    this._internal.cumulativeValues = [];

    this._internal.lastError = null;
    this._internal.inspectData = null;
  },
  getInspectInfo() {
    if (this._internal.lastError) {
      return { type: 'text', value: `Error: ${this._internal.lastError}` };
    }
    return this._internal.inspectData
      ? { type: 'value', value: this._internal.inspectData }
      : { type: 'text', value: '[Not executed yet]' };
  },
  inputs: {
    value: {
      type: 'number',
      displayName: 'Value',
      group: 'Data',
      default: 0,
      set: function (val) {
        try {
          this._internal.value = validateNumber(val);
          this._internal.lastError = null;
        } catch (error) {
          this._internal.lastError = error.message;
          console.error('Volatility Monitor Node - Value error:', error.message);
        }
      }
    },
    Do: {
      type: 'signal',
      displayName: 'Do',
      group: 'Actions',
      valueChangedToTrue: function () {
        this.calculate();
      }
    },
    Reset: {
      type: 'signal',
      displayName: 'Reset',
      group: 'Actions',
      valueChangedToTrue: function () {
        this._internal.cumulativeValues = [];
        this._internal.results = {
          volatilityPercentage: 0,
          standardDeviation: 0,
          mean: 0,
          variance: 0,
          amplitude: 0
        };
        this._internal.lastError = null;
        this._internal.inspectData = {
          reset: true,
          count: 0,
          mean: 0,
          variance: 0,
          standardDeviation: 0,
          volatilityPercentage: 0,
          amplitude: 0
        };
        this.flagOutputDirty('volatilityResult');
        this.flagOutputDirty('standardDeviation');
        this.flagOutputDirty('mean');
        this.flagOutputDirty('variance');
        this.flagOutputDirty('amplitude');
      }
    }
  },
  outputs: {
    Done: {
      type: 'signal',
      displayName: 'Done',
      group: 'Events'
    },
    volatilityResult: {
      type: 'number',
      displayName: 'Volatility (%)',
      group: 'Results',
      getter: function () {
        return this._internal.results.volatilityPercentage;
      }
    },
    standardDeviation: {
      type: 'number',
      displayName: 'Standard Deviation (σ)',
      group: 'Results',
      getter: function () {
        return this._internal.results.standardDeviation;
      }
    },
    mean: {
      type: 'number',
      displayName: 'Mean (μ)',
      group: 'Results',
      getter: function () {
        return this._internal.results.mean;
      }
    },
    variance: {
      type: 'number',
      displayName: 'Variance (σ²)',
      group: 'Results',
      getter: function () {
        return this._internal.results.variance;
      }
    },
    amplitude: {
      type: 'number',
      displayName: 'Amplitude / Scaling Factor',
      group: 'Results',
      getter: function () {
        return this._internal.results.amplitude;
      }
    }
  },
  methods: {
    calculate: function () {
      try {
        if (this._internal.lastError) {
          return;
        }

        const val = this._internal.value;

        // Merge with retained values from previous runs
        const cumulativeValues = Array.isArray(this._internal.cumulativeValues)
          ? this._internal.cumulativeValues
          : [];
        
        if (typeof val === 'number' && Number.isFinite(val)) {
          cumulativeValues.push(val);
        }

        const n = cumulativeValues.length;
        let mean = 0;
        let variance = 0;
        let standardDeviation = 0;

        if (n > 0) {
          mean = cumulativeValues.reduce((s, v) => s + v, 0) / n;
          if (n > 1) {
            const diffSquares = cumulativeValues.map((v) => {
              const d = v - mean;
              return d * d;
            });
            // Use sample variance (unbiased) with n-1; if n==1 fall back to 0
            variance = diffSquares.reduce((s, v) => s + v, 0) / (n - 1);
          } else {
            variance = 0;
          }
          standardDeviation = Math.sqrt(variance);
        }

        // Volatility in percentage: sigma divided by mean, times 100, when mean > 0
        let volatilityPercentage = 0;
        if (mean > 0) {
          volatilityPercentage = (standardDeviation / mean) * 100;
        } else if (standardDeviation > 0) {
          // If mean is 0 but there is spread, define as 100% for signaling high volatility
          volatilityPercentage = 100;
        }

        // Amplitude / Scaling factor: use peak-to-peak relative to mean if possible
        let amplitude = 0;
        if (n > 0) {
          const minV = Math.min.apply(null, cumulativeValues);
          const maxV = Math.max.apply(null, cumulativeValues);
          const peakToPeak = maxV - minV;
          amplitude = mean !== 0 ? peakToPeak / Math.abs(mean) : peakToPeak;
        }

        this._internal.results = {
          volatilityPercentage,
          standardDeviation,
          mean,
          variance,
          amplitude
        };

        // Persist the retained series
        this._internal.cumulativeValues = cumulativeValues;

        this._internal.inspectData = {
          count: n,
          mean,
          variance,
          standardDeviation,
          volatilityPercentage,
          amplitude
        };

        this.flagOutputDirty('volatilityResult');
        this.flagOutputDirty('standardDeviation');
        this.flagOutputDirty('mean');
        this.flagOutputDirty('variance');
        this.flagOutputDirty('amplitude');
        this.sendSignalOnOutput('Done');
      } catch (error) {
        this._internal.lastError = error.message;
        console.error('Volatility Monitor Node - Calculate error:', error.message);
      }
    }
  }
};

module.exports = {
  node: VolatilityMonitorNode
};
