const XgeniaRuntime = require('@xgenia/runtime');
const CloudStore = require('@xgenia/runtime/src/api/cloudstore');

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

  xhr.setRequestHeader('X-Parse-Application-Id', options.appId);
  xhr.setRequestHeader('Content-Type', 'application/json');

  const cloudServices = XgeniaRuntime.instance.getMetaData('cloudservices');
  if (cloudServices && cloudServices.deployVersion) {
    xhr.setRequestHeader('x-xgenia-cloud-version', cloudServices.deployVersion);
  }

  // Check if this is a Supabase environment
  const isSupabaseEnvironment = cloudServices && cloudServices.supabase && cloudServices.supabase.enabled;

  if (isSupabaseEnvironment) {
    // For Supabase, try to get the JWT access token from the current session
    // Add null checks to prevent the TypeError
    if (XgeniaRuntime.instance && XgeniaRuntime.instance.Services && XgeniaRuntime.instance.Services.UserService) {
      const userService = XgeniaRuntime.instance.Services.UserService.forScope(options.modelScope);

      if (userService && userService.backendType === 'supabase' && userService.supabaseClient) {
        // Get current session and extract JWT token
        userService.supabaseClient.auth
          .getSession()
          .then(({ data: { session }, error }) => {
            if (error) {
              console.warn('[CloudFunctions API] Failed to get Supabase session:', error);
              // DISABLED: Continue without JWT token for testing
              console.log('[CloudFunctions API] No Authorization header set - testing without anon fallback');
            } else if (session?.access_token) {
              // Use JWT token for authenticated requests
              xhr.setRequestHeader('Authorization', `Bearer ${session.access_token}`);
              console.log('[CloudFunctions API] Using JWT access token for authentication');
            } else {
              console.log('[CloudFunctions API] No session available - testing without anon fallback');
            }

            // Check for current users (Parse Server style) - keep for compatibility
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
          })
          .catch((error) => {
            console.warn('[CloudFunctions API] Error getting Supabase session:', error);
            console.log('[CloudFunctions API] Error occurred - testing without anon fallback');

            // Check for current users (Parse Server style) - keep for compatibility
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
          });

        // Return early since we're handling the request asynchronously
        return;
      }
    }

    // UserService not available, try to get Supabase client directly from CloudStore
    console.log('[CloudFunctions API] UserService not available, trying direct Supabase client access...');

    // Try to get Supabase client directly from CloudStore
    if (CloudStore.instance && CloudStore.instance.supabaseClient) {
      console.log('[CloudFunctions API] Found Supabase client in CloudStore, attempting to get session...');

      CloudStore.instance.supabaseClient.auth
        .getSession()
        .then(({ data: { session }, error }) => {
          if (error) {
            console.warn('[CloudFunctions API] Failed to get Supabase session from CloudStore:', error);
            console.log('[CloudFunctions API] No Authorization header set - testing without anon fallback');
          } else if (session?.access_token) {
            xhr.setRequestHeader('Authorization', `Bearer ${session.access_token}`);
            console.log('[CloudFunctions API] Using JWT access token from CloudStore for authentication');
          } else {
            console.log('[CloudFunctions API] No session available from CloudStore - testing without anon fallback');
          }

          // Check for current users (Parse Server style) - keep for compatibility
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
        })
        .catch((error) => {
          console.warn('[CloudFunctions API] Error getting Supabase session from CloudStore:', error);
          console.log('[CloudFunctions API] Error occurred - testing without anon fallback');

          // Check for current users (Parse Server style) - keep for compatibility
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
        });
      return; // Exit early since we're handling the request asynchronously
    } else {
      console.log('[CloudFunctions API] No Supabase client available anywhere - testing without anon fallback');
    }
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

const cloudfunctions = {
  async run(functionName, params) {
    return new Promise((resolve, reject) => {
      const cloudServices = XgeniaRuntime.instance.getMetaData('cloudservices');
      if (cloudServices === undefined) {
        reject('No cloud services defined in this project.');
        return;
      }

      const appId = cloudServices.appId;
      const endpoint = cloudServices.endpoint;

      _makeRequest('/functions/' + encodeURIComponent(functionName), {
        appId,
        endpoint,
        content: params,
        method: 'POST',
        modelScope: XgeniaRuntime.instance.getModelScope(),
        success: (res) => {
          resolve(res ? res.result : undefined);
        },
        error: (err) => {
          reject(err);
        }
      });
    });
  }
};

module.exports = cloudfunctions;
