'use strict';

const Base = require('./base');

module.exports = Base.extendSetComponentObjectProperties({
  name: 'net.xgenia.SetComponentObjectProperties',
  displayName: 'Set Component Object Properties',
  docs: 'https://docsapp.xgenia.com/nodes/component-utilities/set-component-object-properties',
  getComponentObjectId: function () {
    return 'componentState' + this.nodeScope.componentOwner.getInstanceId();
  }
});
