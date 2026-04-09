const XgeniaRuntime = require('@xgenia/runtime');
const CloudStore = require('@xgenia/runtime/src/api/cloudstore');

('use strict');

/*var defaultBeforeCallScript = "// Add custom code to setup the parameters send to the function\n"+
"// The parameters are found in the object called 'Parameters'\n";

var defaultAfterCallScript = "// Add custom code modfiy the result from the cloud function\n"+
"// The result is found in the object called 'Result'\n";*/

function _makeRequest(path, options) {
  var xhr = new XMLHttpRequest();

  xhr.onreadystatechange = function () {
    if (xhr.readyState === 4) {
      var json;
      try {
        json = JSON.parse(xhr.response);
      } catch (e) {}

      if (xhr.status === 200 || xhr.status === 201) {
        options.success(json);
      } else options.error(json);
    }
  };

  xhr.open(options.method || 'GET', options.endpoint + path, true);

  // Check if this is a Supabase environment
  const cloudServices = XgeniaRuntime.instance.getMetaData('cloudservices');
  const isSupabaseEnvironment = cloudServices && cloudServices.supabase && cloudServices.supabase.enabled;

  if (isSupabaseEnvironment) {
    // For Supabase, try to get the JWT access token from the current session
    // Add null checks to prevent the TypeError
    console.log('[CloudFunction] Checking for UserService availability...');
    console.log('[CloudFunction] XgeniaRuntime.instance:', !!XgeniaRuntime.instance);
    console.log('[CloudFunction] Services:', !!XgeniaRuntime.instance?.Services);
    console.log('[CloudFunction] UserService:', !!XgeniaRuntime.instance?.Services?.UserService);

    if (XgeniaRuntime.instance && XgeniaRuntime.instance.Services && XgeniaRuntime.instance.Services.UserService) {
      const userService = XgeniaRuntime.instance.Services.UserService.forScope(options.modelScope);
      console.log('[CloudFunction] UserService instance:', !!userService);
      console.log('[CloudFunction] UserService backendType:', userService?.backendType);
      console.log('[CloudFunction] UserService supabaseClient:', !!userService?.supabaseClient);

      if (userService && userService.backendType === 'supabase' && userService.supabaseClient) {
        // Get current session and extract JWT token
        userService.supabaseClient.auth
          .getSession()
          .then(({ data: { session }, error }) => {
            if (error) {
              console.warn('[CloudFunction] Failed to get Supabase session:', error);
              // DISABLED: Fallback to anon key for testing
              // xhr.setRequestHeader('Authorization', `Bearer ${cloudServices.supabase.anonKey}`);
              console.log('[CloudFunction] No Authorization header set - testing without anon fallback');
            } else if (session?.access_token) {
              // Use JWT token for authenticated requests
              xhr.setRequestHeader('Authorization', `Bearer ${session.access_token}`);
              console.log('[CloudFunction] Using JWT access token for authentication');
            } else {
              // DISABLED: No session available, use anon key for testing
              // xhr.setRequestHeader('Authorization', `Bearer ${cloudServices.supabase.anonKey}`);
              console.log('[CloudFunction] No session available - testing without anon fallback');
            }

            // Set content type and send request
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.send(JSON.stringify(options.content));
          })
          .catch((error) => {
            console.warn('[CloudFunction] Error getting Supabase session:', error);
            // DISABLED: Fallback to anon key for testing
            // xhr.setRequestHeader('Authorization', `Bearer ${cloudServices.supabase.anonKey}`);
            console.log('[CloudFunction] Error occurred - testing without anon fallback');
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.send(JSON.stringify(options.content));
          });

        // Return early since we're handling the request asynchronously
        return;
      }
    }

    // UserService not available, try to get Supabase client directly from CloudStore
    console.log('[CloudFunction] UserService not available, trying direct Supabase client access...');

    // Try to get Supabase client directly from CloudStore
    if (CloudStore.instance && CloudStore.instance.supabaseClient) {
      console.log('[CloudFunction] Found Supabase client in CloudStore, attempting to get session...');

      CloudStore.instance.supabaseClient.auth
        .getSession()
        .then(({ data: { session }, error }) => {
          if (error) {
            console.warn('[CloudFunction] Failed to get Supabase session from CloudStore:', error);
            console.log('[CloudFunction] No Authorization header set - testing without anon fallback');
          } else if (session?.access_token) {
            xhr.setRequestHeader('Authorization', `Bearer ${session.access_token}`);
            console.log('[CloudFunction] Using JWT access token from CloudStore for authentication');
          } else {
            console.log('[CloudFunction] No session available from CloudStore - testing without anon fallback');
          }

          xhr.setRequestHeader('Content-Type', 'application/json');
          xhr.send(JSON.stringify(options.content));
        })
        .catch((error) => {
          console.warn('[CloudFunction] Error getting Supabase session from CloudStore:', error);
          console.log('[CloudFunction] Error occurred - testing without anon fallback');
          xhr.setRequestHeader('Content-Type', 'application/json');
          xhr.send(JSON.stringify(options.content));
        });
      return; // Exit early since we're handling the request asynchronously
    } else {
      console.log('[CloudFunction] No Supabase client available anywhere - testing without anon fallback');
      // xhr.setRequestHeader('Authorization', `Bearer ${cloudServices.supabase.anonKey}`);
    }
  } else {
    // For Parse Server, use the old method
    xhr.setRequestHeader('Authorization', 'Bearer ' + CloudStore.getApiKey());
  }

  xhr.setRequestHeader('Content-Type', 'application/json');

  // Check for current users (Parse Server style)
  var _cu = localStorage['Parse/' + options.appId + '/currentUser'];
  if (_cu !== undefined) {
    try {
      const currentUser = JSON.parse(_cu);
      xhr.setRequestHeader('X-Parse-Session-Token', currentUser.sessionToken);
    } catch (e) {
      // Failed to extract session token
    }
  }

  xhr.send(JSON.stringify(options.content));
}

var CloudFunctionNode = {
  name: 'Cloud Function',
  category: 'Cloud Services',
  color: 'data',
  usePortAsLabel: 'functionName',
  docs: 'https://docsapp.xgenia.com/nodes/data/cloud-data/cloud-function',
  deprecated: true,
  initialize: function () {
    this._internal.paramsValues = {};
    // this._internal.resultsValues = {};
    // this._internal.convertArraysAndObjects = true;
  },
  getInspectInfo() {
    const result = this._internal.lastCallResult;
    if (!result) return '[Not executed yet]';

    return [{ type: 'value', value: result }];
  },
  inputs: {
    functionName: {
      type: 'string',
      displayName: 'Function Name',
      group: 'General',
      set: function (value) {
        this._internal.functionName = value;
      }
    },
    params: {
      group: 'Parameters',
      type: { name: 'stringlist', allowEditOnly: true },
      set: function (value) {
        this._internal.params = value;
      }
    },
    /* results:{
        group:'Result',
        type:{name:'stringlist',allowEditOnly:true},
        set:function(value) {
            this._internal.results = value;
        }
    },    
    beforeCallScript: {
        group:'Scripts',
        displayName:'Before Call',
        default:defaultBeforeCallScript,
        type:{name:'string',codeeditor:'javascript'},
        set: function(scriptCode) {
            try {
                if(scriptCode !== undefined) {
                    var args = ['Parameters'].concat([scriptCode]);
                    this._internal.scriptBeforeCallFunc = Function.apply(null,args);
                }
            }
            catch(e) {
                this._internal.scriptBeforeCallFunc = undefined;
                console.log('Error while parsing script (before call): ' +  e);
            }  
        }
    },
    afterCallScript: {
        group:'Scripts',
        displayName:'After Call',
        default:defaultAfterCallScript,
        type:{name:'string',codeeditor:'javascript'},
        set: function(scriptCode) {
            try {
                if(scriptCode !== undefined) {
                    var args = ['Result'].concat([scriptCode]);
                    this._internal.scriptAfterCallFunc = Function.apply(null,args);
                }
            }
            catch(e) {
                this._internal.scriptAfterCallFunc = undefined;
                console.log('Error while parsing script (after call): ' +  e);
            }  
        }
    },*/
    call: {
      type: 'signal',
      displayName: 'Call',
      group: 'Actions',
      valueChangedToTrue: function () {
        this.scheduleCall();
      }
    }
    /* convertArraysAndObjects:{
        group:'Advanced',
        displayName:'Convert Objects',
        type:'boolean',
        default:true,
        set: function(value) {
            this._internal.convertArraysAndObjects = value;
        } 
    }*/
  },
  outputs: {
    success: {
      type: 'signal',
      displayName: 'Success',
      group: 'Signals'
    },
    failure: {
      type: 'signal',
      displayName: 'Failure',
      group: 'Signals'
    },
    result: {
      type: '*',
      displayName: 'Result',
      group: 'Output',
      getter: function () {
        return this._internal.result;
      }
    }
  },
  methods: {
    /* getResultsValue:function(name) {
        return this._internal.resultsValues[name];
    },*/
    registerOutputIfNeeded: function (name) {
      if (this.hasOutput(name)) {
        return;
      }

      /*  if(name.startsWith('res-')) this.registerOutput(name, {
          getter: this.getResultsValue.bind(this, name.substring('res-'.length))
      });*/
    },
    setParamsValue: function (name, value) {
      this._internal.paramsValues[name] = value;
    },
    registerInputIfNeeded: function (name) {
      if (this.hasInput(name)) {
        return;
      }

      if (name.startsWith('pm-'))
        this.registerInput(name, {
          set: this.setParamsValue.bind(this, name.substring('pm-'.length))
        });
    },
    scheduleCall: function () {
      var internal = this._internal;
      if (!internal.hasScheduledCall) {
        internal.hasScheduledCall = true;
        this.scheduleAfterInputsHaveUpdated(this.doCall.bind(this));
      }
    },
    doCall: function () {
      this._internal.hasScheduledCall = false;

      const cloudServices = XgeniaRuntime.instance.getMetaData('cloudservices');
      if (cloudServices === undefined) {
        console.log('No cloud services defined in this project.');
        this._internal.lastCallResult = {
          status: 'failure',
          res: 'No active cloud services in this project'
        };

        this.sendSignalOnOutput('failure');
        return;
      }

      var appId = cloudServices.appId;
      var endpoint = cloudServices.endpoint;
      // Run before call script
      /*  if(this._internal.scriptBeforeCallFunc !== undefined) {
            this._internal.scriptBeforeCallFunc(this._internal.paramsValues);
        }*/

      _makeRequest('/functions/v1/' + encodeURIComponent(this._internal.functionName), {
        appId,
        endpoint,
        content: this._internal.paramsValues,
        method: 'POST',
        modelScope: this.nodeScope.modelScope,
        success: (res) => {
          var res = res.result; // Cloud functions always return "result"
          if (res === undefined) {
            this.sendSignalOnOutput('failure');
            return;
          }

          // Run after call script
          /* if(this._internal.scriptAfterCallFunc !== undefined) {
                    this._internal.scriptAfterCallFunc(res);
                }*/

          this._internal.result = CloudStore._deserializeJSON(res);
          this.flagOutputDirty('result');

          this._internal.lastCallResult = {
            status: 'success',
            result: this._internal.result
          };

          // Deserialize values into XGENIA arrays and objects
          /*  if(this._internal.convertArraysAndObjects) {
                    for(var key in res) {
                        if(res[key] !== undefined)
                            res[key] = CloudStore._fromJSON(res[key]);
                    }
                }*/

          /*this._internal.resultsValues = res;

                for(var key in res) {
                    if(this.hasOutput('res-'+key)) {
                        this.flagOutputDirty('res-'+key);
                    }
                }*/

          this.sendSignalOnOutput('success');
        },
        error: (res) => {
          this._internal.lastCallResult = {
            status: 'failure',
            res
          };

          this.sendSignalOnOutput('failure');
        }
      });
    }
  }
};

module.exports = {
  node: CloudFunctionNode,
  setup: function (context, graphModel) {
    if (!context.editorConnection || !context.editorConnection.isRunningLocally()) {
      return;
    }

    function _managePortsForNode(node) {
      function _updatePorts() {
        var ports = [];

        // Add results outputs
        /*    var results = node.parameters.results;
                if (results !== undefined) {
                    results = results.split(',');
                    for (var i in results) {
                        var p = results[i];

                        ports.push({
                            type: {
                                name: '*',
                            },
                            plug: 'output',
                            group: 'Results',
                            name: 'res-' + p,
                            displayName: p
                        });

                    }
                }*/

        // Add params inputs
        var params = node.parameters.params;
        if (params !== undefined) {
          params = params.split(',');
          for (var i in params) {
            var p = params[i];

            ports.push({
              type: '*',
              plug: 'input',
              group: 'Parameters',
              name: 'pm-' + p,
              displayName: p
            });
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

    graphModel.on('editorImportComplete', () => {
      graphModel.on('nodeAdded.Cloud Function', function (node) {
        _managePortsForNode(node);
      });

      for (const node of graphModel.getNodesWithType('Cloud Function')) {
        _managePortsForNode(node);
      }
    });
  }
};
