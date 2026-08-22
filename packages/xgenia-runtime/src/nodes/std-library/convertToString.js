'use strict';

// Convert to String
// -----------------
// Converts a value of ANY JavaScript/TypeScript type into its string
// representation. Triggered by the `Do` signal; emits `Done` and exposes the
// converted value on `Result`.
//
//   * strings pass through unchanged
//   * numbers / booleans / bigint use String()
//   * objects & arrays are JSON-stringified (falling back to String() on cyclic
//     structures that can't be serialised)
//   * null  -> "null", undefined / no input -> "" (empty string)

// Shared conversion so the runtime node and the RGS converter agree on behaviour.
function valueToString(data) {
  if (data === undefined) return '';
  if (data === null) return 'null';
  if (typeof data === 'string') return data;
  if (typeof data === 'number' || typeof data === 'boolean' || typeof data === 'bigint') {
    return String(data);
  }
  if (typeof data === 'object') {
    try {
      return JSON.stringify(data);
    } catch (e) {
      return String(data);
    }
  }
  return String(data);
}

const ConvertToStringNode = {
  name: 'Convert to String',
  displayNodeName: 'Convert to String',
  docs: 'https://docsapp.xgenia.com/nodes/utilities/convert-to-string',
  shortDesc: 'Convert any data value into its string representation.',
  category: 'Utilities',
  color: 'data',
  searchTags: ['convert', 'string', 'stringify', 'to string', 'cast', 'serialize', 'json', 'text', 'parse'],

  initialize: function () {
    this._internal.result = '';
  },

  getInspectInfo: function () {
    return { type: 'text', value: this._internal.result };
  },

  inputs: {
    Do: {
      type: 'signal',
      displayName: 'Do',
      group: 'Actions',
      valueChangedToTrue: function () {
        this.convert();
      }
    },
    Data: {
      type: '*',
      displayName: 'Data',
      group: 'General'
    }
  },

  outputs: {
    Done: {
      type: 'signal',
      displayName: 'Done',
      group: 'Events'
    },
    Result: {
      type: 'string',
      displayName: 'Result',
      group: 'Result',
      getter: function () {
        return this._internal.result;
      }
    }
  },

  methods: {
    convert: function () {
      try {
        const data = this.getInputValue('Data');
        this._internal.result = valueToString(data);
      } catch (error) {
        console.error('Convert to String error:', error);
        this._internal.result = '';
      }
      this.flagOutputDirty('Result');
      this.sendSignalOnOutput('Done');
    }
  }
};

module.exports = {
  node: ConvertToStringNode,
  valueToString: valueToString
};
