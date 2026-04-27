//import CloudStore from '@xgenia/runtime/src/api/cloudstore'

import xgeniaRuntime from '@xgenia/runtime';
import ConfigService from '@xgenia/runtime/src/api/configservice';
import Model from '@xgenia/runtime/src/model';

export const node = {
  name: 'xgenia.cloud.request',
  displayNodeName: 'Request',
  category: 'Cloud',
  docs: 'https://docsapp.xgenia.com/nodes/cloud-functions/request',
  useVariants: false,
  mountedInput: false,
  allowAsExportRoot: false,
  singleton: true,
  color: 'data',
  connectionPanel: {
    groupPriority: ['General', 'Mounted']
  },
  outputs: {
    receive: {
      displayName: 'Received',
      type: 'signal',
      group: 'General'
    },
    auth: {
      displayName: 'Authenticated',
      type: 'boolean',
      group: 'Request',
      getter: function () {
        return !!this._internal.authenticated;
      }
    },
    userId: {
      displayName: 'User Id',
      type: 'boolean',
      group: 'Request',
      getter: function () {
        return this._internal.authUserId;
      }
    }
  },
  inputs: {
    allowNoAuth: {
      group: 'General',
      type: 'boolean',
      displayName: 'Allow Unauthenticated',
      default: false,
      set: function (value) {
        this._internal.allowNoAuth = value;
      }
    },
    params: {
      group: 'Parameters',
      type: { name: 'stringlist', allowEditOnly: true },
      set: function (value) {
        this._internal.params = value;
      }
    }
  },
  initialize: function () {
    this._internal.allowNoAuth = false;
    this._internal.requestParameters = {};
    this._internal.userProperties = {
      Authenticated: false
    };
  },
  methods: {
    getRequestParameter: function (name) {
      return this._internal.requestParameters[name];
    },
    setRequestParameter: function (name, value) {
      this._internal.requestParameters[name] = value;
      if (this.hasOutput('pm-' + name)) this.flagOutputDirty('pm-' + name);
    },
    fetchCurrentUser: async function (sessionToken) {
      return new Promise((resolve, reject) => {
        const userService = xgeniaRuntime.Services.UserService.forScope(this.nodeScope.modelScope);
        userService.fetchCurrentUser({
          sessionToken,
          success: resolve,
          error: reject
        });
      });
    },
    sendRequest: async function (req) {
      const sessionToken = req.headers['x-parse-session-token'];
      const authHeader = req.headers['authorization'];
      let params = {};
      try {
        params = JSON.parse(req.body);
      } catch (e: any) {}

      // Check for Supabase JWT token in Authorization header
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const jwtToken = authHeader.substring(7);

        // Get user service to validate Supabase JWT
        const userService = xgeniaRuntime.Services.UserService.forScope(this.nodeScope.modelScope);

        if (userService && userService.backendType === 'supabase' && userService.supabaseClient) {
          try {
            // Verify the JWT token with Supabase
            const {
              data: { user },
              error
            } = await userService.supabaseClient.auth.getUser(jwtToken);

            if (error) {
              console.warn('[CloudRequest] Invalid Supabase JWT token:', error);
              if (!this._internal.allowNoAuth) throw Error('Invalid authentication token.');
            } else if (user) {
              // Valid Supabase user
              this._internal.authenticated = true;
              this._internal.authUserId = user.id;
              this.flagOutputDirty('userId');
            }
          } catch (error: any) {
            console.warn('[CloudRequest] Error validating Supabase JWT:', error);
            if (!this._internal.allowNoAuth) throw Error('Authentication validation failed.');
          }
        }
      } else if (sessionToken) {
        // Handle Parse Server session token (existing logic)
        try {
          await this.fetchCurrentUser(sessionToken);

          const userService = xgeniaRuntime.Services.UserService.forScope(this.nodeScope.modelScope);
          const userModel = userService.current;

          this._internal.authenticated = true;
          this._internal.authUserId = userModel.getId();
          this.flagOutputDirty('userId');
        } catch (e: any) {
          // User could not be fetched
          if (!this._internal.allowNoAuth) throw Error('Unauthenticated requests not accepted.');
        }
      } else if (!this._internal.allowNoAuth) {
        throw Error('Unauthenticated requests not accepted.');
      }

      // Make sure config is cached before processing request
      await ConfigService.instance.getConfig();

      // Create request object
      const requestModel = (this.nodeScope.modelScope || Model).get('Request');
      requestModel.set('Authenticated', !!this._internal.authenticated);
      requestModel.set('UserId', this._internal.authUserId);
      requestModel.set('Parameters', params);
      requestModel.set('Headers', req.headers);

      this.flagOutputDirty('auth');

      for (let key in params) {
        this.setRequestParameter(key, params[key]);
      }
      this.sendSignalOnOutput('receive');
    },
    registerOutputIfNeeded: function (name) {
      if (this.hasOutput(name)) {
        return;
      }

      if (name.startsWith('pm-'))
        this.registerOutput(name, {
          getter: this.getRequestParameter.bind(this, name.substring('pm-'.length))
        });
    }
  }
};

export function setup(context, graphModel) {
  if (!context.editorConnection || !context.editorConnection.isRunningLocally()) {
    return;
  }

  function _managePortsForNode(node) {
    function _updatePorts() {
      var ports = [];

      // Add params outputs
      var params = node.parameters.params;
      if (params !== undefined && params.trim() !== '') {
        params = params.split(',');
        for (var i in params) {
          var p = params[i].trim();
          if (p !== '') {
            ports.push({
              type: '*',
              plug: 'output',
              group: 'Parameters',
              name: 'pm-' + p,
              displayName: p
            });
          }
        }
      }

      context.editorConnection.sendDynamicPorts(node.id, ports);
    }

    _updatePorts();
    node.on('parameterUpdated', function (event) {
      if (event.name === 'params') {
        _updatePorts();
      }
    });
  }

  // Handle existing nodes immediately when setup is called
  const existingNodes = graphModel.getNodesWithType('xgenia.cloud.request');

  for (const node of existingNodes) {
    _managePortsForNode(node);
  }

  // Handle new nodes added after setup
  graphModel.on('nodeAdded.xgenia.cloud.request', function (node) {
    _managePortsForNode(node);
  });

  // Handle when project data is loaded (this is the key fix!)
  graphModel.on('editorImportComplete', () => {
    const allNodes = graphModel.getNodesWithType('xgenia.cloud.request');

    for (const node of allNodes) {
      _managePortsForNode(node);
    }
  });

  // Also handle component imports (when individual components are loaded)
  graphModel.on('componentAdded', (component) => {
    const componentNodes = component.getNodesWithType('xgenia.cloud.request');
    if (componentNodes.length > 0) {
      for (const node of componentNodes) {
        _managePortsForNode(node);
      }
    }
  });
}
