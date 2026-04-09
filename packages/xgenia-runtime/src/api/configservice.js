const xgeniaRuntime = require('../../../xgenia-runtime');

/**
 * Supabase secret object returned by the API
 * @typedef {Object} SupabaseSecret
 * @property {string} name - The name of the secret
 * @property {string} value - The value of the secret
 */

class ConfigService {
  constructor() {
    this.cacheDuration = 15 * 60 * 1000; // 15 min cache
  }

  /**
   * Extracts project ID (project ref) from Supabase URL
   * Supabase URLs are typically: https://<project-ref>.supabase.co
   * @param {string} url - The Supabase URL
   * @returns {string|null} The project ID/ref or null if not found
   */
  _extractProjectIdFromUrl(url) {
    if (!url) return null;
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;
      // Extract project ref from hostname (e.g., "abc123xyz.supabase.co" -> "abc123xyz")
      const match = hostname.match(/^([^.]+)\.supabase\.co$/);
      return match ? match[1] : null;
    } catch (error) {
      console.warn('[ConfigService] Failed to extract project ID from URL:', error);
      return null;
    }
  }

  /**
   * Fetches all custom environment variables (secrets) for a Supabase project.
   * @param {string} projectId - The reference ID of your Supabase project.
   * @param {string} accessToken - Your Supabase personal access token (PAT).
   * @returns {Promise<SupabaseSecret[]>} A promise that resolves to an array of secret objects.
   */
  async _getSupabaseSecrets(projectId, accessToken) {
    if (!projectId || !accessToken) {
      console.warn('[ConfigService] Missing projectId or accessToken for Supabase secrets');
      return [];
    }

    const apiUrl = `https://api.supabase.com/v1/projects/${projectId}/secrets`;

    try {
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        // If the response is not successful, throw an error with details
        const errorData = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(
          `Failed to fetch Supabase secrets: ${response.status} ${response.statusText}. Details: ${JSON.stringify(
            errorData
          )}`
        );
      }

      // Parse the JSON response
      const secrets = await response.json();
      return secrets;
    } catch (error) {
      console.error('[ConfigService] An error occurred while fetching Supabase secrets:', error);
      // Return empty array instead of throwing to allow fallback to regular config
      return [];
    }
  }

  _makeRequest(path, options) {
    if (typeof _xgenia_cloud_runtime_version === 'undefined') {
      // Running in browser
      var xhr = new XMLHttpRequest();

      xhr.onreadystatechange = function () {
        if (xhr.readyState === 4) {
          var json;
          try {
            json = JSON.parse(xhr.response);
          } catch (e) {
            console.warn('[ConfigService] Failed to parse response as JSON for path:', path);
            console.warn(
              '[ConfigService] Response was:',
              typeof xhr.response === 'string' ? xhr.response.substring(0, 200) + '...' : xhr.response
            );
          }

          if (xhr.status === 200 || xhr.status === 201) {
            if (json) {
              options.success(json);
            } else {
              // If we can't parse JSON but got 200, treat it as an error
              console.error('[ConfigService] Received non-JSON response with status 200 for path:', path);
              options.error({
                error: 'Invalid JSON response',
                status: xhr.status,
                responseType: typeof xhr.response,
                isHTML: typeof xhr.response === 'string' && xhr.response.includes('<html>')
              });
            }
          } else {
            options.error(json || { error: xhr.responseText, status: xhr.status });
          }
        }
      };

      const cloudServices = xgeniaRuntime.instance.getMetaData('cloudservices');
      if (!cloudServices || !cloudServices.endpoint) {
        console.warn('[ConfigService] No cloud services configured, skipping config request');
        options.error({ error: 'No cloud services configured' });
        return;
      }

      const appId = cloudServices.appId;
      const endpoint = cloudServices.endpoint;

      xhr.open('GET', endpoint + path, true);
      xhr.setRequestHeader('X-Parse-Application-Id', appId);
      xhr.send();
    } else {
      // Running in cloud runtime
      const endpoint = typeof _xgenia_cloudservices !== 'undefined' ? _xgenia_cloudservices.endpoint : this.endpoint;
      const appId = typeof _xgenia_cloudservices !== 'undefined' ? _xgenia_cloudservices.appId : this.appId;
      const masterKey = typeof _xgenia_cloudservices !== 'undefined' ? _xgenia_cloudservices.masterKey : undefined;

      fetch(endpoint + path, {
        method: 'GET',
        headers: {
          'X-Parse-Application-Id': appId,
          'X-Parse-Master-Key': masterKey
        }
      })
        .then((r) => {
          if (r.status === 200 || r.status === 201) {
            r.json()
              .then((json) => options.success(json))
              .catch((e) =>
                options.error({
                  error: 'Config: Failed to get json result.'
                })
              );
          } else {
            r.json()
              .then((json) => options.error(json))
              .catch((e) => options.error({ error: 'Failed to fetch.' }));
          }
        })
        .catch((e) => {
          options.error({ error: e.message });
        });
    }
  }

  async _getConfig() {
    // First, try to get config from Parse Server endpoint (existing behavior)
    const parseConfigPromise = new Promise((resolve, reject) => {
      this._makeRequest('/config', {
        success: (config) => {
          resolve(config.params || {});
        },
        error: (err) => {
          // Don't reject immediately - try Supabase secrets as fallback
          resolve({});
        }
      });
    });

    // Try to fetch Supabase secrets in parallel
    let supabaseSecrets = {};
    try {
      const cloudServices = xgeniaRuntime.instance ? xgeniaRuntime.instance.getMetaData('cloudservices') : null;

      if (cloudServices && cloudServices.supabase && cloudServices.supabase.enabled) {
        const supabaseConfig = cloudServices.supabase;

        // Extract project ID from URL or use provided projectId
        let projectId = supabaseConfig.projectId;
        if (!projectId && supabaseConfig.url) {
          projectId = this._extractProjectIdFromUrl(supabaseConfig.url);
        }

        // Get access token (PAT) from config
        // Check multiple possible field names for the PAT
        const accessToken =
          supabaseConfig.accessToken || supabaseConfig.personalAccessToken || supabaseConfig.supabaseAccessToken;

        if (projectId && accessToken) {
          const secrets = await this._getSupabaseSecrets(projectId, accessToken);

          // Convert secrets array to object for easier access
          // Format: { SECRET_NAME: secret_value, ... }
          secrets.forEach((secret) => {
            supabaseSecrets[secret.name] = secret.value;
          });
        } else {
          console.warn('[ConfigService] Missing projectId or accessToken for Supabase secrets:', {
            hasProjectId: !!projectId,
            hasAccessToken: !!accessToken,
            url: supabaseConfig.url
          });
        }
      }
    } catch (error) {
      console.warn('[ConfigService] Error fetching Supabase secrets (non-fatal):', error);
      // Continue with regular config even if Supabase secrets fail
    }

    // Merge Parse Server config with Supabase secrets
    // Supabase secrets take precedence if there are conflicts
    const parseConfig = await parseConfigPromise;
    const mergedConfig = {
      ...parseConfig,
      ...supabaseSecrets
    };

    return mergedConfig;
  }

  async getConfig() {
    if (this.configCachePending) return this.configCachePending;

    if (!this.configCache) {
      this.configCachePending = this._getConfig();

      this.configCache = await this.configCachePending;
      delete this.configCachePending;
      this.ttl = Date.now() + this.cacheDuration;
      return this.configCache;
    } else {
      // Update cache if ttl has passed
      if (Date.now() > this.ttl) {
        this._getConfig().then((config) => {
          this.configCache = config;
          this.ttl = Date.now() + this.cacheDuration;
        });
      }

      // But return currently cached
      return this.configCache;
    }
  }

  clearCache() {
    delete this.configCache;
  }
}

ConfigService.instance = new ConfigService();

module.exports = ConfigService;
