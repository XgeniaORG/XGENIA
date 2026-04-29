const XgeniaRuntime = require('@xgenia/runtime');
const CloudStore = require('@xgenia/runtime/src/api/cloudstore');

('use strict');

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
      } else options.error(json ? Object.assign({}, json, { status: xhr.status }) : { status: xhr.status });
    }
  };

  xhr.open(options.method || 'GET', options.endpoint + path, true);

  // Get cloud services metadata
  const cloudServices = XgeniaRuntime.instance.getMetaData('cloudservices');

  // Check if this is a Supabase environment
  const isSupabaseEnvironment = cloudServices && cloudServices.supabase && cloudServices.supabase.enabled;

  if (isSupabaseEnvironment) {
    if (XgeniaRuntime.instance && XgeniaRuntime.instance.Services && XgeniaRuntime.instance.Services.UserService) {
      const userService = XgeniaRuntime.instance.Services.UserService.forScope(options.modelScope);

      if (userService && userService.backendType === 'supabase' && userService.supabaseClient) {
        // Get current session and extract JWT token
        userService.supabaseClient.auth
          .getSession()
          .then(({ data: { session }, error }) => {
            if (error) {
              console.warn('[CloudFunction2] Failed to get Supabase session:', error);
              // DISABLED: Fallback to anon key for testing
              // xhr.setRequestHeader('Authorization', `Bearer ${cloudServices.supabase.anonKey}`);
              console.log('[CloudFunction2] No Authorization header set - testing without anon fallback');
            } else if (session?.access_token) {
              // Use JWT token for authenticated requests
              xhr.setRequestHeader('Authorization', `Bearer ${session.access_token}`);
            }

            // Set content type and send request
            xhr.setRequestHeader('Content-Type', 'application/json');

            // Add version header if available
            if (cloudServices && cloudServices.deployVersion) {
              xhr.setRequestHeader('x-xgenia-cloud-version', cloudServices.deployVersion);
            }

            xhr.send(JSON.stringify(options.content));
          })
          .catch((error) => {
            xhr.setRequestHeader('Content-Type', 'application/json');

            if (cloudServices && cloudServices.deployVersion) {
              xhr.setRequestHeader('x-xgenia-cloud-version', cloudServices.deployVersion);
            }

            xhr.send(JSON.stringify(options.content));
          });

        // Return early since we're handling the request asynchronously
        return;
      }
    }
    xhr.setRequestHeader('Content-Type', 'application/json');
    if (cloudServices && cloudServices.deployVersion) {
      xhr.setRequestHeader('x-xgenia-cloud-version', cloudServices.deployVersion);
    }
    xhr.send(JSON.stringify(options.content));
    return;
  } else {
    // For Parse Server, use the old method
    xhr.setRequestHeader('Authorization', 'Bearer ' + CloudStore.getApiKey());
  }

  xhr.setRequestHeader('Content-Type', 'application/json');

  if (cloudServices && cloudServices.deployVersion) {
    xhr.setRequestHeader('x-xgenia-cloud-version', cloudServices.deployVersion);
  }

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
  name: 'CloudFunction2',
  displayName: 'Cloud Function',
  category: 'Cloud Services',
  color: 'data',
  usePortAsLabel: 'function',
  docs: 'https://docsapp.xgenia.com/nodes/data/cloud-data/cloud-function',
  initialize: function () {
    this._internal.paramsValues = {};
    this._internal.resultsValues = {};
  },
  getInspectInfo() {
    const result = this._internal.lastCallResult;
    if (!result) return '[Not executed yet]';

    return [{ type: 'value', value: result }];
  },
  inputs: {
    call: {
      type: 'signal',
      displayName: 'Call',
      group: 'Actions',
      valueChangedToTrue: function () {
        this.scheduleCall();
      }
    }
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
    error: {
      type: 'string',
      displayName: 'Error',
      group: 'Error',
      getter: function () {
        return this._internal.error;
      }
    }
  },
  methods: {
    setError: function (err) {
      this._internal.error = err;
      this.flagOutputDirty('error');
      this.sendSignalOnOutput('failure');
    },
    getResultsValue: function (name) {
      return this._internal.resultsValues[name];
    },
    registerOutputIfNeeded: function (name) {
      if (this.hasOutput(name)) {
        return;
      }

      if (name.startsWith('out-'))
        this.registerOutput(name, {
          getter: this.getResultsValue.bind(this, name.substring('out-'.length))
        });
    },
    setParamsValue: function (name, value) {
      this._internal.paramsValues[name] = value;
    },
    setFunctionName: function (value) {
      this._internal.functionName = value;
    },
    registerInputIfNeeded: function (name) {
      if (this.hasInput(name)) {
        return;
      }

      if (name === 'function')
        this.registerInput(name, {
          set: this.setFunctionName.bind(this)
        });

      if (name.startsWith('in-'))
        this.registerInput(name, {
          set: this.setParamsValue.bind(this, name.substring('in-'.length))
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
      if (this.context.editorConnection) {
        if (cloudServices === undefined || cloudServices.endpoint === undefined) {
          this.context.editorConnection.sendWarning(this.nodeScope.componentOwner.name, this.id, 'cloud-function-2', {
            message: 'No cloud services defined in this project.'
          });
        } else if (this._internal.functionName === undefined) {
          this.context.editorConnection.sendWarning(this.nodeScope.componentOwner.name, this.id, 'cloud-function-2', {
            message: 'No function specified'
          });
        } else {
          this.context.editorConnection.clearWarning(this.nodeScope.componentOwner.name, this.id, 'cloud-function-2');
        }
      }

      const appId = cloudServices.appId;
      const endpoint = cloudServices.endpoint;

      // Map functionName to Supabase function slug when using Supabase backend
      const isSupabaseEnvironment = cloudServices && cloudServices.supabase && cloudServices.supabase.enabled;
      let functionSlug = this._internal.functionName;
      if (isSupabaseEnvironment) {
        functionSlug = this.convertToSupabaseSlug(this._internal.functionName);
      }

      _makeRequest('/functions/v1/' + encodeURIComponent(functionSlug), {
        appId,
        endpoint,
        content: this._internal.paramsValues,
        method: 'POST',
        modelScope: this.nodeScope.modelScope,
        success: (res) => {
          if (res === undefined || res === null) {
            // No result, still success
            this._internal.lastCallResult = {
              status: 'success',
              parameters: this._internal.paramsValues,
              results: 'empty'
            };
          } else {
            // Buat penampung hasil baru
            const results = {};

            // Fungsi bantu untuk extract nilai tanpa flattening struktur
            const extractValues = (obj, prefix = '', results = {}) => {
              if (Array.isArray(obj)) {
                // Untuk array, simpan sebagai array utuh
                if (prefix) {
                  results[prefix] = obj;
                }
                // Tidak extract individual array items - hanya simpan struktur asli
              } else if (typeof obj === 'object' && obj !== null) {
                // Untuk object, simpan sebagai object utuh
                if (prefix) {
                  results[prefix] = obj;
                }
                // Untuk root object, simpan semua properties tanpa flattening
                if (!prefix) {
                  for (let key in obj) {
                    results[key] = obj[key];
                  }
                }
              } else {
                // Primitive values
                if (prefix) {
                  results[prefix] = obj;
                }
              }
            };

            // Ambil semua key dari res (bukan hanya res.result)
            extractValues(res, '', results);

            // Simpan semua hasil ke internal storage
            for (let key in results) {
              this._internal.resultsValues[key] = results[key];
              if (this.hasOutput('out-' + key)) {
                this.flagOutputDirty('out-' + key);
              }
            }

            this._internal.lastCallResult = {
              status: 'success',
              parameters: this._internal.paramsValues,
              results: this._internal.resultsValues
            };
          }

          this.sendSignalOnOutput('success');
        },
        error: (e) => {
          const status = typeof e === 'object' ? e.status : undefined;
          let error = typeof e === 'string' ? e : e && (e.error || e.message);
          if (!error) {
            if (status === 401) {
              error =
                'Unauthorized (401). Please sign in to obtain an access token or enable Allow Unauthenticated for this function.';
            } else if (status === 404) {
              error = `Function not found (404). The function \"${functionSlug}\" is not deployed/exported to Supabase Edge Functions. Please export/deploy it and try again.`;
            } else if (status === 403) {
              error = 'Forbidden (403). Authentication or proper permissions are required to call this function.';
            } else {
              error = 'Failed running cloud function.';
            }
          }
          this._internal.lastCallResult = {
            status: 'failure',
            error
          };

          this.setError(error);
        }
      });
    },
    convertToSupabaseSlug: function (functionName) {
      // Remove any existing xgenia_ prefix if present
      let slug = (functionName || '').replace(/^xgenia_?/, '');

      // Replace spaces and folder separators with underscores
      slug = slug.replace(/[\s/]+/g, '_');

      // Remove any other invalid characters for Supabase slugs (keep only alphanumeric, underscore, hyphen)
      slug = slug.replace(/[^a-zA-Z0-9_-]/g, '');

      // Replace multiple consecutive underscores with single underscore
      slug = slug.replace(/_+/g, '_');

      // Remove leading/trailing underscores
      slug = slug.replace(/^_+|_+$/g, '');

      // Ensure it starts with a letter or underscore
      if (/^[0-9]/.test(slug)) {
        slug = '_' + slug;
      }

      // Ensure it's not empty
      if (!slug) {
        slug = 'xgenia_function';
      }

      // Add xgenia_ prefix for Supabase Edge Functions
      return 'xgenia_' + slug;
    }
  }
};

module.exports = {
  node: CloudFunctionNode,
  setup: function (context, graphModel) {
    // Handled in editor adapter
  }
};
