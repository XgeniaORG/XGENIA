'use strict';

const xgeniaRuntime = require('../../../../xgenia-runtime');

var SetUserPropertiesNodeDefinition = {
  name: 'net.xgenia.user.SetUserProperties',
  docs: 'https://docsapp.xgenia.com/nodes/data/user/set-user-properties',
  displayNodeName: 'Set User Properties',
  category: 'Cloud Services',
  color: 'data',
  initialize: function () {
    var internal = this._internal;

    internal.userProperties = {};
  },
  getInspectInfo() {},
  outputs: {
    success: {
      type: 'signal',
      displayName: 'Success',
      group: 'Events'
    },
    failure: {
      type: 'signal',
      displayName: 'Failure',
      group: 'Events'
    },
    error: {
      type: 'string',
      displayName: 'Error',
      group: 'Error',
      getter: function () {
        return this._internal.error;
      }
    }
  },
  inputs: {
    store: {
      displayName: 'Do',
      group: 'Actions',
      valueChangedToTrue: function () {
        this.scheduleStore();
      }
    },
    email: {
      displayName: 'Email',
      type: 'string',
      group: 'General',
      set: function (value) {
        this._internal.email = value;
      }
    },
    username: {
      displayName: 'Username',
      type: 'string',
      group: 'General',
      set: function (value) {
        this._internal.username = value;
      }
    }
  },
  methods: {
    setError: function (err) {
      this._internal.error = err;
      this.flagOutputDirty('error');
      this.sendSignalOnOutput('failure');

      if (this.context.editorConnection) {
        this.context.editorConnection.sendWarning(this.nodeScope.componentOwner.name, this.id, 'user-set-warning', {
          message: err,
          showGlobally: true
        });
      }
    },
    clearWarnings() {
      if (this.context.editorConnection) {
        this.context.editorConnection.clearWarning(this.nodeScope.componentOwner.name, this.id, 'user-set-warning');
      }
    },
    scheduleStore: function () {
      const internal = this._internal;

      if (this.storeScheduled === true) return;
      this.storeScheduled = true;

      this.scheduleAfterInputsHaveUpdated(() => {
        this.storeScheduled = false;

        const UserService = xgeniaRuntime.Services.UserService;
        UserService.forScope(this.nodeScope.modelScope).setUserProperties({
          email: this._internal.email,
          username: this._internal.username,
          properties: internal.userProperties,
          success: () => {
            this.sendSignalOnOutput('success');
          },
          error: (e) => {
            this.setError(e);
          }
        });
      });
    },
    setUserProperty: function (name, value) {
      this._internal.userProperties[name] = value;
    },
    registerInputIfNeeded: function (name) {
      if (this.hasInput(name)) {
        return;
      }

      if (name.startsWith('prop-'))
        return this.registerInput(name, {
          set: this.setUserProperty.bind(this, name.substring('prop-'.length))
        });
    }
  }
};

function updatePorts(nodeId, parameters, editorConnection, systemCollections) {
  var ports = [];

  if (systemCollections) {
    // Fetch ports from collection keys
    var c = systemCollections.find((c) => c.name === '_User');
    if (c && c.schema && c.schema.properties) {
      var props = c.schema.properties;

      const _ignoreKeys =
        typeof _xgenia_cloud_runtime_version === 'undefined'
          ? ['authData', 'createdAt', 'updatedAt', 'email', 'username', 'emailVerified', 'password']
          : ['authData', 'createdAt', 'updatedAt', 'email', 'username'];

      for (var key in props) {
        if (_ignoreKeys.indexOf(key) !== -1) continue;

        var p = props[key];
        if (ports.find((_p) => _p.name === key)) continue;

        if (p.type === 'Relation') {
        } else {
          // Other schema type ports
          const _typeMap = {
            String: 'string',
            Boolean: 'boolean',
            Number: 'number',
            Date: 'date'
          };

          ports.push({
            type: {
              name: _typeMap[p.type] ? _typeMap[p.type] : '*'
            },
            plug: 'input',
            group: 'Properties',
            name: 'prop-' + key,
            displayName: key
          });
        }
      }
    }
  }

  editorConnection.sendDynamicPorts(nodeId, ports);
}

module.exports = {
  node: SetUserPropertiesNodeDefinition,
  setup: function (context, graphModel) {
    if (!context.editorConnection || !context.editorConnection.isRunningLocally()) {
      return;
    }

    function _managePortsForNode(node) {
      updatePorts(node.id, node.parameters, context.editorConnection, graphModel.getMetaData('systemCollections'));

      node.on('parameterUpdated', function (event) {
        updatePorts(node.id, node.parameters, context.editorConnection, graphModel.getMetaData('systemCollections'));
      });

      graphModel.on('metadataChanged.systemCollections', function (data) {
        updatePorts(node.id, node.parameters, context.editorConnection, data);
      });
    }

    graphModel.on('editorImportComplete', () => {
      graphModel.on('nodeAdded.net.xgenia.user.SetUserProperties', function (node) {
        _managePortsForNode(node);
      });

      for (const node of graphModel.getNodesWithType('net.xgenia.user.SetUserProperties')) {
        _managePortsForNode(node);
      }
    });
  }
};
