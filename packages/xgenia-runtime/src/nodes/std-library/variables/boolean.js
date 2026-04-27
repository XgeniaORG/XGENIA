'use strict';

const VariableBase = require('./variablebase');

const BooleanNode = VariableBase.createDefinition({
  name: 'Boolean',
  docs: 'https://docsapp.xgenia.com/nodes/data/boolean',
  startValue: false,
  type: {
    name: 'boolean'
  },
  cast: function (value) {
    return Boolean(value);
  }
});

module.exports = {
  node: BooleanNode
};
