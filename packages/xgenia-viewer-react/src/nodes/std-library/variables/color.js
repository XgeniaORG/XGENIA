'use strict';

const VariableBase = require('@xgenia/runtime/src/nodes/std-library/variables/variablebase');

module.exports = {
  node: VariableBase.createDefinition({
    name: 'Color',
    docs: 'https://docsapp.xgenia.com/nodes/data/color',
    startValue: '#f1f2f4',
    nodeDoubleClickAction: {
      focusPort: 'value'
    },
    type: {
      name: 'color'
    },
    cast: function (value) {
      return value;
    }
  })
};
