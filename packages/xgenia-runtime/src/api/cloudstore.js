const xgeniaRuntime = require('../../xgenia-runtime');
const Model = require('../model');
const Collection = require('../collection');
const CloudFile = require('./cloudfile');
const EventEmitter = require('../events');

const _protectedFields = {
  _common: ['_createdAt', '_updatedAt', 'objectId'],
  _User: ['_email_verify_token']
};

function _removeProtectedFields(data, className) {
  const _data = Object.assign({}, data);
  _protectedFields._common.forEach((f) => delete _data[f]);
  if (className && _protectedFields[className]) _protectedFields[className].forEach((f) => delete _data[f]);

  return _data;
}

class CloudStore {
  constructor(modelScope) {
    this._initCloudServices();

    this.events = new EventEmitter();
    this.events.setMaxListeners(10000);
    this.modelScope = modelScope;

    this._fromJSON = (item, collectionName) => CloudStore._fromJSON(item, collectionName, modelScope);
    this._deserializeJSON = (data, type) => CloudStore._deserializeJSON(data, type, modelScope);
    this._serializeObject = (data, collectionName) => CloudStore._serializeObject(data, collectionName, modelScope);

    // ENHANCED: Listen for metadata changes to re-initialize backends
    this._setupMetadataListeners();
  }

  static getApiKey() {
    const anonKey = xgeniaRuntime.instance ? xgeniaRuntime.instance.getMetaData('SupaBaseAnonKey') : null;
    console.log('[CloudStore] Retrieved Supabase Anon Key:', anonKey ? '***REDACTED***' : 'null');
    return anonKey ? anonKey : 'null';
  }

  // NEW METHOD: Cleanup listeners to prevent memory leaks
  dispose() {
    try {
      // Clean up EventDispatcher listener
      if (typeof window !== 'undefined' && window.EventDispatcher && window.EventDispatcher.instance) {
        window.EventDispatcher.instance.off('ProjectModel.instanceHasChanged', this);
      }

      // Clean up runtime listeners
      if (xgeniaRuntime.instance && typeof xgeniaRuntime.instance.off === 'function') {
        xgeniaRuntime.instance.off('metadataChanged.cloudservices', this);
      }

      // Clean up Supabase realtime subscriptions
      if (this.supabaseChannel) {
        this.supabaseChannel.unsubscribe();
        this.supabaseChannel = null;
      }

      console.log('[CloudStore] Disposed and cleaned up listeners');
    } catch (error) {
      console.warn('[CloudStore] Error during dispose:', error.message);
    }
  }

  // NEW METHOD: Setup listeners for metadata changes
  _setupMetadataListeners() {
    // Only setup listeners for the main instance to avoid duplicate event handling
    if (this.modelScope) return; // This is a scoped instance, don't setup global listeners

    try {
      // Listen for cloudservices metadata changes
      if (xgeniaRuntime.instance && typeof xgeniaRuntime.instance.on === 'function') {
        xgeniaRuntime.instance.on('metadataChanged.cloudservices', () => {
          console.log('[CloudStore] Metadata change detected, re-initializing backends...');
          this._initCloudServices();
        });
      }

      // CRITICAL FIX: Listen for ProjectModel instance changes (when switching projects)
      if (typeof window !== 'undefined' && window.EventDispatcher && window.EventDispatcher.instance) {
        window.EventDispatcher.instance.on(
          'ProjectModel.instanceHasChanged',
          () => {
            console.log('[CloudStore] ProjectModel instance changed, re-initializing backends...');
            // Small delay to ensure the new project is fully loaded
            setTimeout(() => {
              this._initCloudServices();
            }, 100);
          },
          this
        );
      }
    } catch (error) {
      console.warn('[CloudStore] Could not setup metadata listeners:', error.message);
    }
  }

  _initCloudServices() {
    _collections = undefined; // clear collection cache, so it's refetched

    // ENHANCED: Always get fresh metadata from current instance
    const cloudServices = xgeniaRuntime.instance ? xgeniaRuntime.instance.getMetaData('cloudservices') : null;

    console.log('[CloudStore] _initCloudServices called with cloudServices:', cloudServices);
    console.log('[CloudStore] Current runtime instance:', !!xgeniaRuntime.instance);
    console.log(
      '[CloudStore] Has Supabase config:',
      !!(cloudServices && cloudServices.supabase && cloudServices.supabase.enabled)
    );

    // EXISTING Parse Server initialization (unchanged for backward compatibility)
    if (cloudServices) {
      this.appId = cloudServices.appId;
      this.endpoint = cloudServices.endpoint;
    }

    const dbVersionMajor = xgeniaRuntime.instance ? xgeniaRuntime.instance.getMetaData('dbVersionMajor') : null;
    this.dbVersionMajor = dbVersionMajor;

    // NEW: Multi-backend support (only if explicitly configured)
    this._initializeBackends(cloudServices);
  }

  // NEW METHOD: Initialize multiple backends (zero breaking changes)
  _initializeBackends(cloudServices) {
    console.log('[CloudStore DEBUG] _initializeBackends called with:', cloudServices);

    this.backends = new Map();
    this.collectionRouting = { default: 'parse_server', collections: {} };

    // Initialize Parse Server backend (always available)
    if (cloudServices && (cloudServices.appId || cloudServices.instanceId)) {
      console.log('[CloudStore DEBUG] Initializing Parse Server backend');
      this.backends.set('parse_server', {
        type: 'parse_server',
        enabled: true,
        config: {
          endpoint: cloudServices.endpoint,
          appId: cloudServices.appId
        }
      });
    }

    // Enhanced logging for debugging Supabase configuration
    console.log('[CloudStore DEBUG] Checking for Supabase config...');
    console.log('[CloudStore DEBUG] cloudServices.supabase exists:', !!cloudServices?.supabase);
    console.log('[CloudStore DEBUG] cloudServices.supabase.enabled:', cloudServices?.supabase?.enabled);
    console.log('[CloudStore DEBUG] Full Supabase config:', JSON.stringify(cloudServices?.supabase, null, 2));
    console.log('[CloudStore DEBUG] cloudServices.routing exists:', !!cloudServices?.routing);
    console.log('[CloudStore DEBUG] cloudServices.routing.default:', cloudServices?.routing?.default);

    // NEW: Try to recover Supabase configuration from different possible locations
    let supabaseConfig = null;

    // Option 1: Standard location
    if (cloudServices && cloudServices.supabase && cloudServices.supabase.enabled) {
      supabaseConfig = cloudServices.supabase;
      console.log('[CloudStore DEBUG] Found Supabase config in standard location');
    }
    // Option 2: Look for Supabase properties at the root level (fallback)
    else if (cloudServices && cloudServices.supabaseUrl && cloudServices.anonKey) {
      console.log('[CloudStore DEBUG] Found Supabase properties at root level, constructing config');
      supabaseConfig = {
        enabled: true,
        url: cloudServices.supabaseUrl,
        anonKey: cloudServices.anonKey,
        serviceRoleKey: cloudServices.serviceRoleKey,
        enableRealtime: cloudServices.enableRealtime !== false
      };
    }

    // Initialize Supabase if we have a config
    if (supabaseConfig) {
      console.log('[CloudStore DEBUG] Initializing Supabase backend with config:', supabaseConfig);
      this.backends.set('supabase', {
        type: 'supabase',
        enabled: true,
        config: supabaseConfig
      });

      // Initialize Supabase client
      this._initSupabaseClient(supabaseConfig);

      // Use routing config if it exists
      if (cloudServices.routing) {
        console.log('[CloudStore DEBUG] Using custom routing config:', cloudServices.routing);
        this.collectionRouting = cloudServices.routing;
      } else {
        // Default to Supabase if available
        console.log('[CloudStore DEBUG] No routing config, defaulting to Supabase');
        this.collectionRouting.default = 'supabase';
      }
    } else {
      console.log('[CloudStore DEBUG] Supabase backend not initialized - missing or disabled configuration');
    }

    console.log(`[CloudStore DEBUG] Initialized ${this.backends.size} backend(s):`, Array.from(this.backends.keys()));
    console.log('[CloudStore DEBUG] Collection routing:', this.collectionRouting);

    // NEW: Log which backend will be used for queries
    console.log('[CloudStore DEBUG] Default backend for queries:', this.collectionRouting.default);
  }

  // NEW METHOD: Initialize Supabase client
  _initSupabaseClient(supabaseConfig) {
    try {
      // Try to import Supabase client dynamically
      let createClient;

      // Check for different availability patterns
      if (typeof window !== 'undefined' && window.supabase && window.supabase.createClient) {
        // Global window.supabase available (CDN or pre-loaded)
        createClient = window.supabase.createClient;
        console.log('[CloudStore] Using global window.supabase.createClient');
      } else if (typeof require !== 'undefined') {
        // Node.js environment or bundled environment
        try {
          // Try dynamic require for the Supabase package
          const supabase = require('@supabase/supabase-js');
          createClient = supabase.createClient;
          console.log('[CloudStore] Successfully required @supabase/supabase-js');
        } catch (requireError) {
          console.warn('[CloudStore] Could not require @supabase/supabase-js:', requireError.message);
          console.warn(
            '[CloudStore] Supabase functionality will be disabled. Install @supabase/supabase-js if needed.'
          );
        }
      } else if (typeof window !== 'undefined' && window.__SUPABASE_CLIENT__) {
        // Check for pre-initialized client
        this.supabaseClient = window.__SUPABASE_CLIENT__;
        console.log('[CloudStore] Using pre-initialized Supabase client');
        if (supabaseConfig.enableRealtime !== false) {
          this._setupSupabaseRealtime();
        }
        return;
      }

      if (!createClient) {
        console.warn('[CloudStore] Supabase createClient not available. Supabase backend will be disabled.');
        console.warn('[CloudStore] To use Supabase, either:');
        console.warn('[CloudStore] 1. Install @supabase/supabase-js package, or');
        console.warn('[CloudStore] 2. Load Supabase via CDN and ensure window.supabase is available, or');
        console.warn('[CloudStore] 3. Provide a pre-initialized client via window.__SUPABASE_CLIENT__');

        // Disable Supabase backend if initialization fails
        if (this.backends.has('supabase')) {
          this.backends.get('supabase').enabled = false;
        }
        return;
      }

      // ENHANCED: Create both anonymous and authenticated clients
      this.supabaseClient = createClient(supabaseConfig.url, supabaseConfig.anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true
        },
        realtime: {
          enabled: supabaseConfig.enableRealtime !== false
        }
      });

      // NEW: Create authenticated client if service role key is available
      if (supabaseConfig.serviceRoleKey) {
        this.supabaseAdminClient = createClient(supabaseConfig.url, supabaseConfig.serviceRoleKey, {
          auth: {
            persistSession: false,
            autoRefreshToken: false
          }
        });
        console.log('[CloudStore] Admin client created for elevated operations');
      }

      console.log('[CloudStore] =================== SUPABASE CLIENT INITIALIZED SUCCESSFULLY ===================');
      console.log('[CloudStore] Supabase URL:', supabaseConfig.url);
      console.log('[CloudStore] Client object:', !!this.supabaseClient);
      console.log('[CloudStore] Auth config:', this.supabaseClient.auth ? 'exists' : 'missing');
      console.log('[CloudStore] Has Admin Client:', !!this.supabaseAdminClient);
      console.log('[CloudStore] ===============================================================================');

      // Setup real-time subscriptions if enabled
      if (supabaseConfig.enableRealtime !== false) {
        this._setupSupabaseRealtime();
      }

      // NEW: Trigger automatic table discovery and registration
      try {
        console.log('[CloudStore] Starting automatic table discovery process');
        setTimeout(() => {
          console.log('[CloudStore] Triggering initial table discovery...');
          this._discoverAndRegisterSupabaseTables().catch((err) => {
            console.warn('[CloudStore] Error in initial table discovery:', err);
          });
        }, 1500); // Delayed after client initialization

        // NEW: Setup periodic table discovery to catch new tables
        this._setupPeriodicTableDiscovery();
      } catch (err) {
        console.warn('[CloudStore] Unable to schedule table discovery:', err);
      }
    } catch (error) {
      console.error('[CloudStore] Failed to initialize Supabase client:', error);
      // Disable Supabase backend if initialization fails
      if (this.backends.has('supabase')) {
        this.backends.get('supabase').enabled = false;
      }
    }
  }

  // NEW METHOD: Get the appropriate Supabase client (authenticated vs anonymous)
  _getSupabaseClient() {
    // Try to get authenticated session from UserService
    try {
      // Method 1: Try to access UserService instance directly (browser environment)
      if (typeof window !== 'undefined' && window.UserService) {
        const userService = window.UserService;
        if (userService && userService.backendType === 'supabase' && userService.supabaseClient) {
          console.log('[CloudStore] Using authenticated Supabase client from window.UserService');
          return userService.supabaseClient;
        }
      }

      // Method 2: Try to access global UserService instance
      if (typeof global !== 'undefined' && global.UserService) {
        const userService = global.UserService;
        if (userService && userService.backendType === 'supabase' && userService.supabaseClient) {
          console.log('[CloudStore] Using authenticated Supabase client from global.UserService');
          return userService.supabaseClient;
        }
      }

      // Method 3: Try to require and find UserService in the model scope
      if (this.modelScope && this.modelScope.UserService) {
        const userService = this.modelScope.UserService;
        if (userService && userService.backendType === 'supabase' && userService.supabaseClient) {
          console.log('[CloudStore] Using authenticated Supabase client from modelScope.UserService');
          return userService.supabaseClient;
        }
      }

      // Method 4: Try alternative UserService access patterns
      try {
        const UserServiceClass = require('../../../xgenia-viewer-react/src/nodes/std-library/user/userservice');
        if (UserServiceClass && UserServiceClass.instance) {
          const userService = UserServiceClass.instance;
          if (userService && userService.backendType === 'supabase' && userService.supabaseClient) {
            console.log('[CloudStore] Using authenticated Supabase client from UserService.instance');
            return userService.supabaseClient;
          }
        }
      } catch (requireError) {
        // Not available in this environment
      }

      // Method 5: Check if there's a UserService attached to the current scope or context
      if (this.context && this.context.userService) {
        const userService = this.context.userService;
        if (userService && userService.backendType === 'supabase' && userService.supabaseClient) {
          console.log('[CloudStore] Using authenticated Supabase client from context.userService');
          return userService.supabaseClient;
        }
      }

      console.log('[CloudStore] No authenticated UserService found, reasons:');
      console.log('  - window.UserService:', typeof window !== 'undefined' ? !!window.UserService : 'N/A (no window)');
      console.log('  - global.UserService:', typeof global !== 'undefined' ? !!global.UserService : 'N/A (no global)');
      console.log(
        '  - modelScope.UserService:',
        this.modelScope ? !!this.modelScope.UserService : 'N/A (no modelScope)'
      );
      console.log('  - context.userService:', this.context ? !!this.context.userService : 'N/A (no context)');
    } catch (error) {
      console.warn('[CloudStore] Could not get authenticated client from UserService:', error.message);
    }

    // Method 6: Fallback - check if the anonymous client has an authenticated session
    if (this.supabaseClient) {
      try {
        // This needs to be async - let's handle it properly
        this.supabaseClient.auth
          .getSession()
          .then(({ data: { session }, error }) => {
            if (!error && session && session.user) {
              console.log('[CloudStore] Anonymous client has authenticated session available');
            }
          })
          .catch(() => {
            // Silent fail for session check
          });

        // For now, just return the client - it might have an authenticated session
        console.log('[CloudStore] Using primary Supabase client (may be authenticated)');
        return this.supabaseClient;
      } catch (sessionError) {
        console.warn('[CloudStore] Could not check session on anonymous client:', sessionError.message);
      }
    }

    // Final fallback
    console.log('[CloudStore] Using default Supabase client');
    return this.supabaseClient;
  }

  // NEW METHOD: Get current user for RLS operations
  async _getCurrentSupabaseUser() {
    try {
      const client = this._getSupabaseClient();
      if (!client) return null;

      const {
        data: { user },
        error
      } = await client.auth.getUser();
      if (error) {
        console.warn('[CloudStore] Could not get current user:', error.message);
        return null;
      }

      return user;
    } catch (error) {
      console.warn('[CloudStore] Error getting current user:', error.message);
      return null;
    }
  }

  // NEW METHOD: Discover Supabase tables automatically using multiple approaches
  async discoverSupabaseTables() {
    if (!this.supabaseClient) {
      console.warn('[CloudStore] Cannot discover tables: Supabase client not initialized');
      return [];
    }

    try {
      console.log('[CloudStore] Starting comprehensive Supabase table discovery...');

      let discoveredTables = [];

      // Method 1: Try PostgREST OpenAPI endpoint
      try {
        console.log('[CloudStore] Attempting discovery via PostgREST OpenAPI...');
        const apiUrl = this.supabaseClient.supabaseUrl;
        const apiKey = this.supabaseClient.supabaseKey;

        // PostgREST provides an OpenAPI endpoint that lists all available tables
        const openApiResponse = await fetch(`${apiUrl}/rest/v1/?apikey=${apiKey}`, {
          headers: {
            Accept: 'application/openapi+json',
            apikey: apiKey
          }
        });

        if (openApiResponse.ok) {
          const openApiSpec = await openApiResponse.json();

          if (openApiSpec.paths) {
            const tablePaths = Object.keys(openApiSpec.paths)
              .filter((path) => path.match(/^\/[a-zA-Z_][a-zA-Z0-9_]*$/)) // Match table endpoints
              .map((path) => path.substring(1)); // Remove leading slash

            console.log(`[CloudStore] Found ${tablePaths.length} tables via OpenAPI:`, tablePaths);

            for (const tableName of tablePaths) {
              // Skip system tables
              if (!tableName.startsWith('_') && !tableName.includes('.')) {
                discoveredTables.push({
                  name: tableName,
                  schema: {
                    properties: {} // Will be enhanced later
                  },
                  _discoveryMethod: 'openapi'
                });
              }
            }
          }
        }
      } catch (openApiError) {
        console.warn('[CloudStore] OpenAPI discovery failed:', openApiError.message);
      }

      // Method 2: Try RPC function to query information_schema (if available)
      if (discoveredTables.length === 0) {
        try {
          console.log('[CloudStore] Attempting discovery via information_schema RPC...');

          // Try to create and use a function to get table names
          const { data: rpcData, error: rpcError } = await this.supabaseClient.rpc('get_public_tables').select('*');

          if (!rpcError && rpcData) {
            console.log(`[CloudStore] Found ${rpcData.length} tables via RPC:`, rpcData);
            discoveredTables = rpcData.map((table) => ({
              name: table.table_name || table.name,
              schema: {
                properties: {}
              },
              _discoveryMethod: 'rpc'
            }));
          }
        } catch (rpcError) {
          console.warn('[CloudStore] RPC discovery failed:', rpcError.message);
        }
      }

      // Method 3: Enhanced fallback with broader testing + common table names
      if (discoveredTables.length === 0) {
        console.log('[CloudStore] Using enhanced fallback table discovery...');

        // Start with known tables from CloudServiceModal and common patterns
        const testTableNames = [
          // Your existing test tables
          'testtable',
          'test',
          // Common table patterns
          'users',
          'user',
          'profiles',
          'profile',
          'posts',
          'post',
          'articles',
          'article',
          'data',
          'items',
          'item',
          'products',
          'product',
          'orders',
          'order',
          'customers',
          'customer',
          'accounts',
          'account',
          'companies',
          'company',
          'projects',
          'project',
          'tasks',
          'task',
          'events',
          'event',
          'messages',
          'message',
          'files',
          'file',
          'images',
          'image',
          'categories',
          'category',
          'tags',
          'tag',
          'comments',
          'comment',
          'reviews',
          'review',
          'settings',
          'config',
          'configurations',
          'logs',
          'log',
          'notifications',
          'notification',
          // Additional patterns that might be in your DB
          'todos',
          'todo',
          'notes',
          'note',
          'contacts',
          'contact',
          'appointments',
          'appointment',
          'transactions',
          'transaction',
          'invoices',
          'invoice'
        ];

        for (const tableName of testTableNames) {
          try {
            const { data, error } = await this.supabaseClient.from(tableName).select('*').limit(1);

            if (!error) {
              console.log(`[CloudStore] Found table via testing: ${tableName}`);
              discoveredTables.push({
                name: tableName,
                schema: {
                  properties: {} // Will be enhanced with column discovery
                },
                _discoveryMethod: 'testing'
              });
            }
          } catch (testError) {
            // Table doesn't exist or no access, continue
          }
        }
      }

      // Method 4: If all else fails, try to introspect from existing metadata
      if (discoveredTables.length === 0 && xgeniaRuntime.instance) {
        try {
          console.log('[CloudStore] Attempting to find tables from existing metadata...');
          const existingCollections = xgeniaRuntime.instance.getMetaData('dbCollections') || [];
          const supabaseTables = existingCollections.filter((c) => c._isSupabaseTable);

          if (supabaseTables.length > 0) {
            console.log(`[CloudStore] Found ${supabaseTables.length} tables from existing metadata`);
            return supabaseTables; // Return existing tables if we can't discover new ones
          }
        } catch (metadataError) {
          console.warn('[CloudStore] Failed to read existing metadata:', metadataError.message);
        }
      }

      if (discoveredTables.length > 0) {
        console.log(
          `[CloudStore] Successfully discovered ${discoveredTables.length} tables:`,
          discoveredTables.map((t) => `${t.name} (${t._discoveryMethod})`)
        );
        return discoveredTables;
      } else {
        console.warn('[CloudStore] No tables discovered through any method');
        return [];
      }
    } catch (error) {
      console.error('[CloudStore] Table discovery failed:', error);
      return [];
    }
  }

  // NEW METHOD: Enhanced table discovery with comprehensive column information
  async discoverSupabaseTablesWithSchema() {
    const tables = await this.discoverSupabaseTables();

    if (tables.length === 0) {
      return tables;
    }

    console.log(`[CloudStore] Enhancing ${tables.length} tables with comprehensive column information...`);

    // For each table, try to get detailed column information
    for (const table of tables) {
      try {
        console.log(`[CloudStore] Discovering schema for table: ${table.name}`);
        table.schema.properties = {};

        // Method 1: Try to get column info from information_schema (if accessible)
        try {
          const { data: columns, error: columnsError } = await this.supabaseClient
            .from('information_schema.columns')
            .select('column_name, data_type, is_nullable, column_default')
            .eq('table_name', table.name)
            .eq('table_schema', 'public');

          if (columnsError) {
            console.warn(`[CloudStore] ✗ information_schema REST API query ERROR for '${table.name}':`, {
              message: columnsError.message,
              code: columnsError.code,
              details: columnsError.details,
              hint: columnsError.hint,
              note:
                columnsError.code === 'PGRST205'
                  ? 'PostgREST does not expose information_schema via REST API (expected limitation)'
                  : 'Unknown REST API error'
            });
          } else if (!columns || columns.length === 0) {
            console.warn(
              `[CloudStore] ⚠ information_schema REST API query returned no columns for '${table.name}' (PostgREST limitation)`
            );
          } else {
            console.log(
              `[CloudStore] ✓ Got ${columns.length} columns from information_schema via REST API for ${table.name}`
            );
            console.log(
              `[CloudStore] Column details:`,
              columns.map((col) => ({
                name: col.column_name,
                type: col.data_type,
                nullable: col.is_nullable,
                hasDefault: !!col.column_default
              }))
            );

            columns.forEach((col) => {
              const fieldType = this._mapPostgresTypeToXgenia(col.data_type);
              table.schema.properties[col.column_name] = {
                type: fieldType,
                required: col.is_nullable === 'NO' && !col.column_default,
                _source: 'information_schema'
              };
            });

            console.log(
              `[CloudStore] ✓ Enhanced table ${table.name} with ${
                Object.keys(table.schema.properties).length
              } columns from information_schema (via REST API)`
            );
            console.log(
              `[CloudStore] ========== Schema Discovery complete for '${table.name}' (via information_schema REST API) ==========`
            );
            continue; // Success, move to next table
          }
        } catch (infoSchemaError) {
          console.warn(`[CloudStore] ✗ information_schema REST API EXCEPTION for ${table.name}:`, {
            message: infoSchemaError.message,
            note: 'PostgREST typically does not expose information_schema via REST API'
          });
        }

        // Method 2: Fallback to sample data inference if information_schema fails
        console.log(`[CloudStore] Attempting Method 2: Query sample data from table '${table.name}'...`);
        try {
          const { data: sampleData, error: sampleError } = await this.supabaseClient
            .from(table.name)
            .select('*')
            .limit(1);

          if (sampleError) {
            console.warn(`[CloudStore] ✗ Sample data query ERROR for '${table.name}':`, {
              message: sampleError.message,
              code: sampleError.code,
              details: sampleError.details,
              hint: sampleError.hint,
              possibleRLS:
                sampleError.message &&
                (sampleError.message.includes('permission') ||
                  sampleError.message.includes('denied') ||
                  sampleError.message.includes('RLS') ||
                  sampleError.message.includes('row-level security') ||
                  sampleError.message.includes('policy'))
                  ? 'RLS may be blocking SELECT access to table'
                  : 'Unknown error'
            });
            console.warn(
              `[CloudStore] ⚠ RLS Impact: If RLS is enabled and blocking SELECT, no properties will be discovered from sample data`
            );
          } else if (!sampleData || sampleData.length === 0) {
            console.warn(
              `[CloudStore] ⚠ Sample data query returned no rows for '${table.name}' (table may be empty or RLS blocking all rows)`
            );
          } else if (!sampleError && sampleData && sampleData.length > 0) {
            const sample = sampleData[0];

            Object.keys(sample).forEach((key) => {
              const value = sample[key];
              let type = 'String'; // Default to String for compatibility

              if (typeof value === 'number') {
                type = 'Number';
              } else if (typeof value === 'boolean') {
                type = 'Boolean';
              } else if (value instanceof Date || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value))) {
                type = 'Date';
              } else if (value !== null && typeof value === 'object') {
                type = 'Object';
              }

              table.schema.properties[key] = {
                type: type,
                required: false, // Can't determine from sample
                _source: 'sample_data'
              };
            });

            console.log(
              `[CloudStore] ✓ Enhanced table ${table.name} with ${
                Object.keys(table.schema.properties).length
              } columns from sample data`
            );
            console.log(
              `[CloudStore] ========== Schema Discovery complete for '${table.name}' (via sample data) ==========`
            );
            continue; // Success, move to next table
          }
        } catch (sampleException) {
          console.error(`[CloudStore] ✗ Sample data query EXCEPTION for ${table.name}:`, {
            message: sampleException.message,
            stack: sampleException.stack,
            possibleRLS:
              sampleException.message &&
              (sampleException.message.includes('permission') ||
                sampleException.message.includes('denied') ||
                sampleException.message.includes('RLS') ||
                sampleException.message.includes('row-level security'))
                ? 'RLS may be blocking SELECT access'
                : 'Unknown exception'
          });
        }

        // Method 3: Fallback - Create minimal schema if all methods failed
        if (Object.keys(table.schema.properties).length === 0) {
          console.warn(`[CloudStore] ⚠ No schema discovered for '${table.name}' - all methods failed`);
          console.warn(`[CloudStore] This may indicate:`);
          console.warn(`  - RLS is enabled and blocking access to both information_schema and table data`);
          console.warn(`  - Table does not exist`);
          console.warn(`  - Insufficient permissions`);
          console.warn(
            `  - RPC function 'get_table_columns' does not exist (create it to enable schema discovery for empty tables)`
          );
          console.log(`[CloudStore] → Using minimal schema fallback...`);
          console.log(`[CloudStore] No sample data available for ${table.name}, using minimal schema`);

          // Create a minimal schema with common fields
          table.schema.properties = {
            id: { type: 'Number', required: true },
            created_at: { type: 'Date', required: false },
            updated_at: { type: 'Date', required: false }
          };
          console.log(`[CloudStore] Using minimal fallback schema for ${table.name}`);
        }
      } catch (error) {
        console.warn(`[CloudStore] Failed to enhance table ${table.name}:`, error.message);

        // Ensure we have at least a basic schema
        if (!table.schema.properties || Object.keys(table.schema.properties).length === 0) {
          table.schema.properties = {
            id: { type: 'Number', required: true }
          };
        }
      }
    }

    return tables;
  }

  // NEW METHOD: Map PostgreSQL types to XGENIA types
  _mapPostgresTypeToXgenia(postgresType) {
    const typeMap = {
      // Numeric types
      integer: 'Number',
      bigint: 'Number',
      smallint: 'Number',
      decimal: 'Number',
      numeric: 'Number',
      real: 'Number',
      'double precision': 'Number',
      smallserial: 'Number',
      serial: 'Number',
      bigserial: 'Number',

      // Text types
      'character varying': 'String',
      varchar: 'String',
      character: 'String',
      char: 'String',
      text: 'String',
      citext: 'String',

      // Boolean type
      boolean: 'Boolean',

      // Date/Time types
      timestamp: 'Date',
      'timestamp with time zone': 'Date',
      'timestamp without time zone': 'Date',
      date: 'Date',
      time: 'Date',
      'time with time zone': 'Date',
      'time without time zone': 'Date',
      interval: 'String',

      // JSON types
      json: 'Object',
      jsonb: 'Object',

      // UUID type
      uuid: 'String',

      // Array types (simplified to Object)
      ARRAY: 'Object',

      // Other types default to String
      bytea: 'String',
      inet: 'String',
      cidr: 'String',
      macaddr: 'String',
      bit: 'String',
      'bit varying': 'String',
      point: 'Object',
      line: 'Object',
      lseg: 'Object',
      box: 'Object',
      path: 'Object',
      polygon: 'Object',
      circle: 'Object'
    };

    // Handle array types (e.g., "integer[]" -> "Object")
    if (postgresType && postgresType.includes('[]')) {
      return 'Object';
    }

    return typeMap[postgresType] || 'String';
  }

  // NEW METHOD: Update dbCollections metadata with discovered Supabase tables
  _updateDbCollectionsMetadata(supabaseTables) {
    if (!xgeniaRuntime.instance) {
      console.warn('[CloudStore] Cannot update metadata: xgeniaRuntime.instance not available');
      return;
    }

    try {
      console.log(`[CloudStore] Updating dbCollections metadata with ${supabaseTables.length} Supabase tables...`);

      // Get existing dbCollections
      const existingCollections = xgeniaRuntime.instance.getMetaData('dbCollections') || [];

      // Filter out old Supabase tables and add new ones
      const nonSupabaseCollections = existingCollections.filter((c) => !c._isSupabaseTable);
      const updatedCollections = nonSupabaseCollections.concat(
        supabaseTables.map((table) => ({
          ...table,
          _isSupabaseTable: true, // Mark as Supabase table
          _discoveredAt: new Date().toISOString()
        }))
      );

      // Update metadata using graphModel
      if (xgeniaRuntime.instance.graphModel && typeof xgeniaRuntime.instance.graphModel.setMetaData === 'function') {
        xgeniaRuntime.instance.graphModel.setMetaData('dbCollections', updatedCollections);
        console.log(
          `[CloudStore] Updated dbCollections metadata. Total collections: ${updatedCollections.length} (${supabaseTables.length} from Supabase)`
        );

        // ENHANCED: Store discovered tables in localStorage for persistence across sessions
        try {
          const supabaseMetadata = {
            tables: supabaseTables.map((t) => ({
              name: t.name,
              discoveredAt: t._discoveredAt,
              method: t._discoveryMethod,
              schema: t.schema
            })),
            lastUpdate: new Date().toISOString(),
            supabaseUrl: this.supabaseClient?.supabaseUrl
          };

          localStorage.setItem('xgenia_supabase_discovered_tables', JSON.stringify(supabaseMetadata));
          console.log('[CloudStore] Saved discovered tables to localStorage for persistence');
        } catch (storageError) {
          console.warn('[CloudStore] Failed to save tables to localStorage:', storageError);
        }
      } else {
        console.warn('[CloudStore] Cannot update metadata: graphModel.setMetaData not available');
        return;
      }

      // Invalidate collections cache to force refresh
      _collections = undefined;

      // Notify listeners that collections have changed
      if (xgeniaRuntime.instance.graphModel && typeof xgeniaRuntime.instance.graphModel.emit === 'function') {
        xgeniaRuntime.instance.graphModel.emit('metadataChanged.dbCollections', updatedCollections);

        // ENHANCED: Force refresh of all DbCollection2 nodes to update their dropdowns
        try {
          xgeniaRuntime.instance.graphModel.emit('forceNodePortsUpdate', { nodeType: 'DbCollection2' });

          // Also trigger a general collections update
          xgeniaRuntime.instance.graphModel.emit('collectionsUpdated', {
            type: 'supabase_discovery',
            collections: updatedCollections
          });

          console.log('[CloudStore] Emitted UI refresh events for table discovery');
        } catch (emitError) {
          console.warn('[CloudStore] Failed to emit UI refresh events:', emitError);
        }
      }
    } catch (error) {
      console.error('[CloudStore] Failed to update dbCollections metadata:', error);
    }
  }

  // NEW METHOD: Discover and register Supabase tables in metadata
  async _discoverAndRegisterSupabaseTables() {
    try {
      console.log('[CloudStore] Starting automatic Supabase table discovery and registration...');

      const discoveredTables = await this.discoverSupabaseTablesWithSchema();

      if (discoveredTables.length > 0) {
        // Update the project metadata with discovered tables
        this._updateDbCollectionsMetadata(discoveredTables);
        console.log(`[CloudStore] Successfully registered ${discoveredTables.length} Supabase tables in metadata`);
        return discoveredTables;
      } else {
        console.log('[CloudStore] No Supabase tables discovered to register');
        return [];
      }
    } catch (error) {
      console.warn('[CloudStore] Failed to auto-discover and register Supabase tables:', error);
      return [];
    }
  }

  // NEW METHOD: Setup periodic table discovery to catch new tables
  _setupPeriodicTableDiscovery() {
    if (!this.supabaseClient) {
      console.log('[CloudStore] Skipping periodic discovery setup - no Supabase client');
      return;
    }

    // Check for new tables every 2 minutes
    const discoveryInterval = 2 * 60 * 1000; // 2 minutes

    console.log(`[CloudStore] Setting up periodic table discovery every ${discoveryInterval / 1000} seconds`);

    this._discoveryInterval = setInterval(async () => {
      try {
        console.log('[CloudStore] Running periodic table discovery...');

        // Get current known Supabase tables
        const currentCollections = xgeniaRuntime.instance.getMetaData('dbCollections') || [];
        const currentSupabaseTables = currentCollections.filter((c) => c._isSupabaseTable);
        const currentTableNames = currentSupabaseTables.map((t) => t.name);

        console.log('[CloudStore] Current Supabase tables:', currentTableNames);

        // Discover current tables
        const discoveredTables = await this.discoverSupabaseTablesWithSchema();
        const discoveredTableNames = discoveredTables.map((t) => t.name);

        console.log('[CloudStore] Discovered tables:', discoveredTableNames);

        // Check for new tables
        const newTables = discoveredTables.filter((t) => !currentTableNames.includes(t.name));

        if (newTables.length > 0) {
          console.log(
            `[CloudStore] Found ${newTables.length} new Supabase tables:`,
            newTables.map((t) => t.name)
          );

          // Register new tables
          this._updateDbCollectionsMetadata(discoveredTables);
          console.log('[CloudStore] Updated metadata with new tables');
        } else {
          console.log('[CloudStore] No new tables found during periodic discovery');
        }
      } catch (error) {
        console.warn('[CloudStore] Error during periodic table discovery:', error);
      }
    }, discoveryInterval);

    // Store reference for cleanup
    this._periodicDiscoveryActive = true;

    console.log('[CloudStore] Periodic table discovery started');
  }

  // NEW METHOD: Test Supabase connection
  async testSupabaseConnection() {
    if (!this.backends || !this.backends.has('supabase')) {
      return {
        success: false,
        error: 'Supabase backend not initialized',
        details: 'No Supabase configuration found or backend disabled'
      };
    }

    const supabaseBackend = this.backends.get('supabase');
    if (!supabaseBackend.enabled) {
      return {
        success: false,
        error: 'Supabase backend disabled',
        details: 'Supabase backend exists but is marked as disabled'
      };
    }

    if (!this.supabaseClient) {
      return {
        success: false,
        error: 'Supabase client not available',
        details: 'Backend enabled but client initialization failed'
      };
    }

    try {
      // Test connection by trying to get current user (lightweight operation)
      const { data, error } = await this.supabaseClient.auth.getUser();

      // Even if user is null, if no error occurred, connection is working
      if (error && error.message && !error.message.includes('session_not_found')) {
        throw error;
      }

      return {
        success: true,
        message: 'Supabase connection successful',
        details: {
          url: this.backends.get('supabase').config.url,
          hasClient: !!this.supabaseClient,
          authStatus: data?.user ? 'authenticated' : 'anonymous',
          realtimeEnabled: this.backends.get('supabase').config.enableRealtime !== false
        }
      };
    } catch (error) {
      return {
        success: false,
        error: 'Supabase connection test failed',
        details: error.message || String(error)
      };
    }
  }

  // NEW METHOD: Select appropriate backend for operation
  _selectBackend(options = {}) {
    console.log('[CloudStore DEBUG] _selectBackend called with options:', options);
    console.log('[CloudStore DEBUG] _selectBackend called from:', new Error().stack?.split('\n')[1]?.trim());
    console.log('[CloudStore DEBUG] Data object details:', {
      data: options.data,
      dataType: typeof options.data,
      dataKeys: options.data ? Object.keys(options.data) : 'null/undefined',
      dataValues: options.data ? Object.values(options.data) : 'null/undefined'
    });
    console.log(
      '[CloudStore DEBUG] Available backends:',
      this.backends ? Array.from(this.backends.keys()) : ['parse_server']
    );
    console.log('[CloudStore DEBUG] Collection routing:', this.collectionRouting);

    // Fallback to parse_server if backends not initialized
    if (!this.backends || this.backends.size === 0) {
      console.log('[CloudStore DEBUG] No backends initialized, defaulting to parse_server');
      return 'parse_server';
    }

    // If backend explicitly specified in options, use it
    if (options.backend && this.backends.has(options.backend)) {
      const backend = this.backends.get(options.backend);
      if (backend.enabled) {
        console.log(`[CloudStore DEBUG] Using explicitly specified backend: ${options.backend}`);
        return backend.type;
      } else {
        console.warn(`[CloudStore] Requested backend '${options.backend}' is disabled, falling back to default`);
      }
    }

    // Collection-specific routing
    if (options.collection && this.collectionRouting.collections[options.collection]) {
      const backendType = this.collectionRouting.collections[options.collection];
      if (this.backends.has(backendType) && this.backends.get(backendType).enabled) {
        console.log(`[CloudStore DEBUG] Using collection-specific backend for ${options.collection}: ${backendType}`);
        return backendType;
      }
    }

    // IMPROVED: Check if Supabase is available and enabled before defaulting to parse_server
    if (this.backends.has('supabase') && this.backends.get('supabase').enabled) {
      console.log(`[CloudStore DEBUG] Supabase backend is available and enabled, using as default`);
      return 'supabase';
    }

    // Default backend routing
    const defaultBackend = this.collectionRouting.default || 'parse_server';
    console.log(`[CloudStore DEBUG] Using default backend: ${defaultBackend}`);

    return defaultBackend;
  }

  on() {
    this.events.on.apply(this.events, arguments);
  }

  off() {
    this.events.off.apply(this.events, arguments);
  }

  // ENHANCED: _makeRequest with backend routing (maintains exact same interface)
  _makeRequest(path, options) {
    const backend = this._selectBackend(options);

    switch (backend) {
      case 'supabase':
        return this._makeSupabaseRequest(path, options);
      case 'parse_server':
      default:
        return this._makeParseServerRequest(path, options);
    }
  }

  // EXTRACTED: Original Parse Server logic (unchanged)
  _makeParseServerRequest(path, options) {
    if (typeof _xgenia_cloud_runtime_version === 'undefined') {
      // Running in browser
      var xhr = new XMLHttpRequest();

      xhr.onreadystatechange = function () {
        if (xhr.readyState === 4) {
          var json;
          try {
            // In SSR, we dont have xhr.response
            json = JSON.parse(xhr.response || xhr.responseText);
          } catch (e) {}

          if (xhr.status === 200 || xhr.status === 201) {
            options.success(json);
          } else options.error(json || { error: xhr.responseText, status: xhr.status });
        }
      };

      xhr.open(options.method || 'GET', this.endpoint + path, true);

      xhr.setRequestHeader('X-Parse-Application-Id', this.appId);
      if (typeof _xgenia_cloudservices !== 'undefined') {
        xhr.setRequestHeader('X-Parse-Master-Key', _xgenia_cloudservices.masterKey);
      }

      // Check for current users
      var _cu = localStorage['Parse/' + this.appId + '/currentUser'];
      if (_cu !== undefined) {
        try {
          const currentUser = JSON.parse(_cu);
          xhr.setRequestHeader('X-Parse-Session-Token', currentUser.sessionToken);
        } catch (e) {
          // Failed to extract session token
        }
      }

      if (options.onUploadProgress) {
        xhr.upload.onprogress = (pe) => options.onUploadProgress(pe);
      }

      if (options.content instanceof File) {
        xhr.send(options.content);
      } else {
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(JSON.stringify(options.content));
      }
    } else {
      // Running in cloud runtime
      const endpoint = typeof _xgenia_cloudservices !== 'undefined' ? _xgenia_cloudservices.endpoint : this.endpoint;
      const appId = typeof _xgenia_cloudservices !== 'undefined' ? _xgenia_cloudservices.appId : this.appId;
      const masterKey = typeof _xgenia_cloudservices !== 'undefined' ? _xgenia_cloudservices.masterKey : undefined;

      fetch(endpoint + path, {
        method: options.method || 'GET',
        headers: {
          'X-Parse-Application-Id': appId,
          'X-Parse-Master-Key': masterKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(options.content)
      })
        .then((r) => {
          if (r.status === 200 || r.status === 201) {
            if (options.method === 'DELETE') {
              options.success(undefined);
            } else {
              r.json()
                .then((json) => options.success(json))
                .catch((e) =>
                  options.error({
                    error: 'CloudStore: Failed to get json result.'
                  })
                );
            }
          } else {
            if (options.method === 'DELETE') {
              options.error({ error: 'Failed to delete.' });
            } else {
              r.json()
                .then((json) => options.error(json))
                .catch((e) => options.error({ error: 'Failed to fetch.' }));
            }
          }
        })
        .catch((e) => {
          options.error({ error: e.message });
        });
    }
  }

  // NEW METHOD: Handle Supabase requests
  async _makeSupabaseRequest(path, options) {
    if (!this.supabaseClient) {
      console.error('[CloudStore] Supabase client not initialized, falling back to Parse Server');
      return this._makeParseServerRequest(path, options);
    }

    try {
      // Parse the path to determine operation and collection
      const pathInfo = this._parseSupabasePath(path, options);

      switch (pathInfo.operation) {
        case 'query':
          return await this._supabaseQuery(pathInfo, options);
        case 'fetch':
          return await this._supabaseFetch(pathInfo, options);
        case 'create':
          return await this._supabaseCreate(pathInfo, options);
        case 'update':
          return await this._supabaseUpdate(pathInfo, options);
        case 'delete':
          return await this._supabaseDelete(pathInfo, options);
        case 'count':
          return await this._supabaseCount(pathInfo, options);
        case 'aggregate':
          return await this._supabaseAggregate(pathInfo, options);
        default:
          console.warn(
            `[CloudStore] Unsupported Supabase operation: ${pathInfo.operation}, falling back to Parse Server`
          );
          return this._makeParseServerRequest(path, options);
      }
    } catch (error) {
      console.error('[CloudStore] Supabase request failed:', error);
      console.log('[CloudStore] Falling back to Parse Server for this request');
      // Fallback to Parse Server if Supabase fails
      return this._makeParseServerRequest(path, options);
    }
  }

  // NEW METHOD: Parse Parse Server path format to Supabase operations
  _parseSupabasePath(path, options) {
    // Examples:
    // "/classes/Users" -> { operation: 'query', collection: 'Users' }
    // "/classes/Users/abc123" -> { operation: 'fetch', collection: 'Users', objectId: 'abc123' }
    // "/aggregate/Users" -> { operation: 'aggregate', collection: 'Users' }

    const parts = path.split('/').filter((p) => p);

    if (parts[0] === 'classes') {
      const collection = parts[1];
      const objectId = parts[2];

      // Determine operation based on method and content
      let operation = 'query';
      if (objectId) {
        operation = options.method === 'DELETE' ? 'delete' : options.method === 'PUT' ? 'update' : 'fetch';
      } else if (options.method === 'POST') {
        // Check if it's a query (with _method: GET) or create
        if (options.content && options.content._method === 'GET') {
          operation = options.content.count ? 'count' : 'query';
        } else {
          operation = 'create';
        }
      }

      return {
        operation: operation,
        collection: collection,
        objectId: objectId
      };
    } else if (parts[0] === 'aggregate') {
      return {
        operation: 'aggregate',
        collection: parts[1]
      };
    }

    return { operation: 'unknown', collection: null };
  }

  // NEW METHOD: Map Parse Server query to Supabase query
  async _supabaseQuery(pathInfo, options) {
    const { collection } = pathInfo;
    const content = options.content || {};

    // Use authenticated client
    const supabaseClient = this._getSupabaseClient();
    if (!supabaseClient) {
      console.error(`[CloudStore] No Supabase client available for query`);
      options.error({ error: 'Supabase client not initialized' });
      return;
    }

    let query = supabaseClient.from(collection).select('*', { count: 'exact' });

    // Apply filters (Parse Server format to Supabase format)
    if (content.where) {
      query = this._applySupabaseFilters(query, content.where);
    }

    // Apply sorting
    if (content.order) {
      console.log('[CloudStore DEBUG] Applying sorting:', content.order);
      const sortFields = Array.isArray(content.order) ? content.order : [content.order];
      sortFields.forEach((field) => {
        if (typeof field === 'string') {
          const ascending = !field.startsWith('-');
          const fieldName = field.startsWith('-') ? field.substring(1) : field;
          console.log(`[CloudStore DEBUG] Sorting by: ${fieldName}, ascending: ${ascending}`);
          query = query.order(fieldName, { ascending });
        }
      });
    }

    // Apply pagination
    if (content.limit && content.skip) {
      query = query.range(content.skip, content.skip + content.limit - 1);
    } else if (content.limit) {
      query = query.limit(content.limit);
    }

    // Execute query
    const { data, error, count } = await query;

    if (error) {
      console.error('[CloudStore] Supabase query error:', error);
      options.error({ error: error.message });
    } else {
      // Convert Supabase response to Parse Server format
      const parseResults = data.map((item) => this._convertSupabaseToParseFormat(item));
      options.success(parseResults, count);
    }
  }

  // NEW METHOD: Fetch single record from Supabase
  async _supabaseFetch(pathInfo, options) {
    const { collection, objectId } = pathInfo;

    // Use authenticated client
    const supabaseClient = this._getSupabaseClient();
    if (!supabaseClient) {
      console.error(`[CloudStore] No Supabase client available for fetch`);
      options.error({ error: 'Supabase client not initialized' });
      return;
    }

    const { data, error } = await supabaseClient.from(collection).select('*').eq('id', objectId).single();

    if (error) {
      options.error({ error: error.message });
    } else {
      const parseResult = this._convertSupabaseToParseFormat(data);
      options.success(parseResult);

      // Emit event for compatibility
      this.events.emit('fetch', {
        type: 'fetch',
        objectId: objectId,
        object: parseResult,
        collection: collection
      });
    }
  }

  // NEW METHOD: Create new record in Supabase
  async _supabaseCreate(pathInfo, options) {
    console.log(`[CloudStore] _supabaseCreate called with:`, { pathInfo, options });

    // Use authenticated client
    const supabaseClient = this._getSupabaseClient();
    if (!supabaseClient) {
      console.error(`[CloudStore] No Supabase client available, cannot create record`);
      options.error({ error: 'Supabase client not initialized' });
      return;
    }

    const { collection } = pathInfo;
    const originalData = options.content || options.data || {};

    // Get current user for user tracking
    const currentUser = await this._getCurrentSupabaseUser();

    console.log(`[CloudStore] Supabase CREATE operation:`);
    console.log(`  Collection: ${collection}`);
    console.log(`  Original data:`, originalData);
    console.log(`  Current user:`, currentUser?.id || 'anonymous');
    console.log(`  Using authenticated client:`, supabaseClient !== this.supabaseClient);

    // Convert to Supabase format
    let data = this._convertParseToSupabaseFormat(originalData);
    console.log(`  After Parse->Supabase conversion:`, data);

    // ENHANCED: Add user tracking fields for RLS
    if (currentUser) {
      data.created_by = currentUser.id;
      data.user_id = currentUser.id;
      console.log(`  Added user tracking fields for RLS`);
    }

    // ENHANCED: Filter out fields that don't exist in the current table schema, but be more permissive
    const filteredData = this._filterValidFields(data, collection);
    if (Object.keys(filteredData).length === 0 && Object.keys(data).length > 0) {
      console.warn(`[CloudStore] All fields were filtered out, using original data`);
      data = data; // Use original converted data if filtering removes everything
    } else {
      data = filteredData;
    }

    console.log(`  Final data to insert:`, data);

    try {
      const { data: result, error } = await supabaseClient.from(collection).insert(data).select().single();

      if (error) {
        console.error(`[CloudStore] Supabase CREATE error:`, error);
        console.error(`[CloudStore] Error details:`, {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint
        });
        options.error({ error: error.message, details: error });
      } else {
        console.log(`[CloudStore] Supabase CREATE success:`, result);
        const parseResult = this._convertSupabaseToParseFormat(result);
        console.log(`[CloudStore] Converted result:`, parseResult);
        options.success(parseResult);

        // Emit event for real-time updates
        this.events.emit('create', {
          type: 'create',
          objectId: parseResult.objectId,
          object: parseResult,
          collection: collection
        });
      }
    } catch (catchError) {
      console.error(`[CloudStore] Exception in _supabaseCreate:`, catchError);
      options.error({ error: catchError.message || 'Unknown error occurred' });
    }
  }

  // NEW METHOD: Update existing record in Supabase
  async _supabaseUpdate(pathInfo, options) {
    const { collection, objectId } = pathInfo;

    // Use authenticated client
    const supabaseClient = this._getSupabaseClient();
    if (!supabaseClient) {
      console.error(`[CloudStore] No Supabase client available for update`);
      options.error({ error: 'Supabase client not initialized' });
      return;
    }

    // Get current user for user tracking
    const currentUser = await this._getCurrentSupabaseUser();

    let data = this._convertParseToSupabaseFormat(options.content || {});

    // ENHANCED: Add updated_by field for audit trail
    if (currentUser) {
      data.updated_by = currentUser.id;
      console.log(`[CloudStore] Added updated_by field for user tracking`);
    }

    // ENHANCED: Filter out fields that don't exist in the current table schema
    data = this._filterValidFields(data, collection);

    const { data: result, error } = await supabaseClient
      .from(collection)
      .update(data)
      .eq('id', objectId)
      .select()
      .single();

    if (error) {
      options.error({ error: error.message });
    } else {
      const parseResult = this._convertSupabaseToParseFormat(result);
      options.success(parseResult);

      // Emit event for real-time updates
      this.events.emit('save', {
        type: 'save',
        objectId: objectId,
        object: parseResult,
        collection: collection
      });
    }
  }

  // NEW METHOD: Delete record from Supabase
  async _supabaseDelete(pathInfo, options) {
    const { collection, objectId } = pathInfo;

    // Use authenticated client
    const supabaseClient = this._getSupabaseClient();
    if (!supabaseClient) {
      console.error(`[CloudStore] No Supabase client available for delete`);
      options.error({ error: 'Supabase client not initialized' });
      return;
    }

    const { error } = await supabaseClient.from(collection).delete().eq('id', objectId);

    if (error) {
      options.error({ error: error.message });
    } else {
      options.success();

      // Emit event for real-time updates
      this.events.emit('delete', {
        type: 'delete',
        objectId: objectId,
        collection: collection
      });
    }
  }

  // NEW METHOD: Count records in Supabase
  async _supabaseCount(pathInfo, options) {
    const { collection } = pathInfo;
    const content = options.content || {};

    // Use authenticated client
    const supabaseClient = this._getSupabaseClient();
    if (!supabaseClient) {
      console.error(`[CloudStore] No Supabase client available for count`);
      options.error({ error: 'Supabase client not initialized' });
      return;
    }

    let query = supabaseClient.from(collection).select('*', { count: 'exact', head: true });

    // Apply filters
    if (content.where) {
      query = this._applySupabaseFilters(query, content.where);
    }

    const { count, error } = await query;

    if (error) {
      options.error({ error: error.message });
    } else {
      options.success(count);
    }
  }

  // NEW METHOD: Handle aggregation queries (basic implementation)
  async _supabaseAggregate(pathInfo, options) {
    // Note: Supabase doesn't have direct aggregation like Parse Server
    // This is a basic implementation - may need enhancement for complex aggregations
    console.warn('[CloudStore] Supabase aggregation is limited. Consider using Parse Server for complex aggregations.');

    // Fallback to Parse Server for aggregation queries
    return this._makeParseServerRequest(pathInfo.originalPath || '/aggregate/' + pathInfo.collection, options);
  }

  // NEW METHOD: Convert Parse Server filters to Supabase filters
  _applySupabaseFilters(query, where) {
    console.log('[CloudStore DEBUG] Applying Supabase filters:', JSON.stringify(where, null, 2));

    if (!where || typeof where !== 'object') {
      return query;
    }

    Object.keys(where).forEach((key) => {
      const value = where[key];
      console.log(`[CloudStore DEBUG] Processing filter key: ${key}, value:`, value);

      // Handle logical operators first
      if (key === '$and') {
        if (Array.isArray(value)) {
          value.forEach((condition) => {
            query = this._applySupabaseFilters(query, condition);
          });
        }
        return;
      }

      if (key === '$or') {
        if (Array.isArray(value) && value.length > 0) {
          // For $or, we need to use Supabase's .or() method
          // Build the OR condition string
          const orConditions = [];
          value.forEach((condition) => {
            const orCondition = this._buildSupabaseConditionString(condition);
            if (orCondition) {
              orConditions.push(orCondition);
            }
          });

          if (orConditions.length > 0) {
            const orString = orConditions.join(',');
            console.log('[CloudStore DEBUG] Applying OR condition:', orString);
            query = query.or(orString);
          }
        }
        return;
      }

      // Handle field-specific filters
      if (typeof value === 'object' && value !== null) {
        // Handle Parse Server operators
        Object.keys(value).forEach((operator) => {
          const operatorValue = value[operator];
          console.log(`[CloudStore DEBUG] Applying operator ${operator} with value:`, operatorValue);

          switch (operator) {
            case '$eq':
              query = query.eq(key, operatorValue);
              break;
            case '$ne':
              query = query.neq(key, operatorValue);
              break;
            case '$gt':
              query = query.gt(key, operatorValue);
              break;
            case '$gte':
              query = query.gte(key, operatorValue);
              break;
            case '$lt':
              query = query.lt(key, operatorValue);
              break;
            case '$lte':
              query = query.lte(key, operatorValue);
              break;
            case '$in':
              if (Array.isArray(operatorValue)) {
                query = query.in(key, operatorValue);
              }
              break;
            case '$nin':
              if (Array.isArray(operatorValue)) {
                query = query.not(key, 'in', operatorValue);
              }
              break;
            case '$regex':
              // Convert regex to LIKE pattern (simplified)
              let pattern = operatorValue;
              if (typeof pattern === 'string') {
                pattern = pattern.replace(/\.\*/g, '%').replace(/\./g, '_');
                query = query.like(key, pattern);
              }
              break;
            case '$exists':
              if (operatorValue) {
                query = query.not(key, 'is', null);
              } else {
                query = query.is(key, null);
              }
              break;
            case '$relatedTo':
              // Handle relatedTo queries (might need more work for complex relations)
              console.warn('[CloudStore] $relatedTo queries not fully supported in Supabase mode');
              break;
            default:
              console.warn(`[CloudStore] Unsupported operator: ${operator}`);
          }
        });
      } else {
        // Simple equality
        console.log(`[CloudStore DEBUG] Applying simple equality: ${key} = ${value}`);
        query = query.eq(key, value);
      }
    });

    console.log('[CloudStore DEBUG] Filter application completed');
    return query;
  }

  // NEW METHOD: Build condition string for Supabase OR queries
  _buildSupabaseConditionString(condition) {
    if (!condition || typeof condition !== 'object') {
      return null;
    }

    const conditionParts = [];

    Object.keys(condition).forEach((key) => {
      const value = condition[key];

      if (typeof value === 'object' && value !== null) {
        Object.keys(value).forEach((operator) => {
          const operatorValue = value[operator];

          switch (operator) {
            case '$eq':
              conditionParts.push(`${key}.eq.${operatorValue}`);
              break;
            case '$ne':
              conditionParts.push(`${key}.neq.${operatorValue}`);
              break;
            case '$gt':
              conditionParts.push(`${key}.gt.${operatorValue}`);
              break;
            case '$gte':
              conditionParts.push(`${key}.gte.${operatorValue}`);
              break;
            case '$lt':
              conditionParts.push(`${key}.lt.${operatorValue}`);
              break;
            case '$lte':
              conditionParts.push(`${key}.lte.${operatorValue}`);
              break;
            case '$in':
              if (Array.isArray(operatorValue)) {
                conditionParts.push(`${key}.in.(${operatorValue.join(',')})`);
              }
              break;
            case '$exists':
              if (operatorValue) {
                conditionParts.push(`${key}.not.is.null`);
              } else {
                conditionParts.push(`${key}.is.null`);
              }
              break;
          }
        });
      } else {
        // Simple equality
        conditionParts.push(`${key}.eq.${value}`);
      }
    });

    return conditionParts.join(',');
  }

  // NEW METHOD: Convert Supabase record to Parse Server format
  _convertSupabaseToParseFormat(supabaseRecord) {
    if (!supabaseRecord) return null;

    const parseRecord = { ...supabaseRecord };

    // Map Supabase 'id' to Parse Server 'objectId'
    if (parseRecord.id && !parseRecord.objectId) {
      parseRecord.objectId = parseRecord.id.toString();
      delete parseRecord.id;
    }

    // Convert timestamps
    if (parseRecord.created_at) {
      parseRecord.createdAt = parseRecord.created_at;
      delete parseRecord.created_at;
    }

    if (parseRecord.updated_at) {
      parseRecord.updatedAt = parseRecord.updated_at;
      delete parseRecord.updated_at;
    }

    return parseRecord;
  }

  // NEW METHOD: Convert Parse Server record to Supabase format
  _convertParseToSupabaseFormat(parseRecord) {
    if (!parseRecord) return null;

    const supabaseRecord = { ...parseRecord };

    // Map Parse Server 'objectId' to Supabase 'id'
    if (supabaseRecord.objectId && !supabaseRecord.id) {
      supabaseRecord.id = supabaseRecord.objectId;
      delete supabaseRecord.objectId;
    }

    // Convert timestamps
    if (supabaseRecord.createdAt) {
      supabaseRecord.created_at = supabaseRecord.createdAt;
      delete supabaseRecord.createdAt;
    }

    if (supabaseRecord.updatedAt) {
      supabaseRecord.updated_at = supabaseRecord.updatedAt;
      delete supabaseRecord.updatedAt;
    }

    // Remove Parse Server specific fields
    delete supabaseRecord.ACL;

    return supabaseRecord;
  }

  // NEW METHOD: Filter out fields that don't exist in the table schema
  _filterValidFields(data, collection) {
    if (!data || typeof data !== 'object') return data;

    // Get cached table metadata
    const dbCollections = this.modelScope?.getMetaData('dbCollections') || [];
    const tableInfo = dbCollections.find((table) => table.name === collection);

    if (!tableInfo || !tableInfo.schema || !tableInfo.schema.properties) {
      console.warn(`[CloudStore] No schema information found for table '${collection}', allowing all fields`);
      return data;
    }

    const validFields = Object.keys(tableInfo.schema.properties);
    const filteredData = {};
    const removedFields = [];

    // Filter data to only include fields that exist in the schema
    Object.keys(data).forEach((fieldName) => {
      if (
        validFields.includes(fieldName) ||
        fieldName === 'id' ||
        fieldName === 'created_at' ||
        fieldName === 'updated_at'
      ) {
        filteredData[fieldName] = data[fieldName];
      } else {
        removedFields.push(fieldName);
      }
    });

    if (removedFields.length > 0) {
      console.warn(
        `[CloudStore] Filtered out ${removedFields.length} invalid field(s) for table '${collection}':`,
        removedFields
      );
      console.log(
        `[CloudStore] These fields were likely from a previous table selection and are not valid for '${collection}'`
      );
      console.log(`[CloudStore] Valid fields for '${collection}' (${validFields.length}):`, validFields);
      console.log(
        `[CloudStore] Final filtered data contains ${Object.keys(filteredData).length} field(s):`,
        Object.keys(filteredData)
      );
    }

    return filteredData;
  }

  // NEW METHOD: Setup real-time subscriptions for Supabase
  _setupSupabaseRealtime() {
    if (!this.supabaseClient) return;

    try {
      // Subscribe to all table changes
      this.supabaseChannel = this.supabaseClient
        .channel('db-changes')
        .on('postgres_changes', { event: '*', schema: 'public' }, (payload) => {
          this._handleSupabaseRealtimeEvent(payload);
        })
        .subscribe();

      console.log('[CloudStore] Supabase real-time subscriptions enabled');
    } catch (error) {
      console.warn('[CloudStore] Failed to setup Supabase real-time subscriptions:', error);
    }
  }

  // NEW METHOD: Handle Supabase real-time events
  _handleSupabaseRealtimeEvent(payload) {
    const { eventType, table, new: newRecord, old: oldRecord } = payload;

    let cloudStoreEvent;

    switch (eventType) {
      case 'INSERT':
        cloudStoreEvent = {
          type: 'create',
          collection: table,
          objectId: newRecord.id,
          object: this._convertSupabaseToParseFormat(newRecord)
        };
        break;

      case 'UPDATE':
        cloudStoreEvent = {
          type: 'save',
          collection: table,
          objectId: newRecord.id,
          object: this._convertSupabaseToParseFormat(newRecord)
        };
        break;

      case 'DELETE':
        cloudStoreEvent = {
          type: 'delete',
          collection: table,
          objectId: oldRecord.id
        };
        break;
    }

    if (cloudStoreEvent) {
      this.events.emit(cloudStoreEvent.type, cloudStoreEvent);
    }
  }

  query(options) {
    console.log('[CloudStore DEBUG] query() called with options:', options);

    // NEW: Use multi-backend routing
    const backend = this._selectBackend(options);
    console.log('[CloudStore DEBUG] Selected backend for query:', backend);

    if (backend === 'supabase') {
      console.log('[CloudStore DEBUG] Routing to Supabase backend');
      console.log('[CloudStore DEBUG] Query options:', JSON.stringify(options, null, 2));
      const pathInfo = this._parseSupabasePath('/classes/' + options.collection, options);
      this._supabaseQuery(pathInfo, {
        ...options,
        content: {
          where: options.where,
          limit: options.limit,
          skip: options.skip,
          order: Array.isArray(options.sort) ? options.sort.join(',') : options.sort,
          count: options.count
        },
        success: function (response) {
          console.log('[CloudStore DEBUG] Supabase query success:', response);
          options.success(response.results || response, response.count);
        },
        error: function (error) {
          console.error('[CloudStore DEBUG] Supabase query error:', error);
          options.error(error);
        }
      });
    } else {
      console.log('[CloudStore DEBUG] Routing to Parse Server backend');
      // Parse Server implementation (unchanged)
      this._makeParseServerRequest('/classes/' + options.collection, {
        method: 'POST',
        content: {
          _method: 'GET',
          where: options.where,
          limit: options.limit,
          skip: options.skip,
          include: Array.isArray(options.include) ? options.include.join(',') : options.include,
          keys: Array.isArray(options.select) ? options.select.join(',') : options.select,
          order: Array.isArray(options.sort) ? options.sort.join(',') : options.sort,
          count: options.count
        },
        success: function (response) {
          console.log('[CloudStore DEBUG] Parse Server query success:', response);
          options.success(response.results, response.count);
        },
        error: function () {
          console.error('[CloudStore DEBUG] Parse Server query error');
          options.error();
        }
      });
    }
  }

  aggregate(options) {
    // NEW: Use multi-backend routing
    const backend = this._selectBackend(options);
    if (backend === 'supabase') {
      const pathInfo = this._parseSupabasePath('/aggregate/' + options.collection, options);
      this._supabaseAggregate(pathInfo, options);
    } else {
      // Parse Server implementation (unchanged)
      const args = [];

      if (!options.group) {
        options.error('You need to provide group option.');
        return;
      }

      if (options.limit) args.push('limit=' + options.limit);
      if (options.skip) args.push('skip=' + options.skip);

      const grouping = {};

      Object.keys(options.group).forEach((k) => {
        const _g = {};
        const group = options.group[k];
        if (group['avg'] !== undefined) _g['$avg'] = '$' + group['avg'];
        else if (group['sum'] !== undefined) _g['$sum'] = '$' + group['sum'];
        else if (group['max'] !== undefined) _g['$max'] = '$' + group['max'];
        else if (group['min'] !== undefined) _g['$min'] = '$' + group['min'];
        else if (group['distinct'] !== undefined) _g['$addToSet'] = '$' + group['distinct'];

        grouping[k] = _g;
      });

      // I don't know which version the API was changed, lets just say above 4 for now.
      if (this.dbVersionMajor && this.dbVersionMajor > 4) {
        grouping._id = null;

        if (options.where) args.push('$match=' + encodeURIComponent(JSON.stringify(options.where)));

        args.push('$group=' + JSON.stringify(grouping));
      } else {
        grouping.objectId = null;

        if (options.where) args.push('match=' + encodeURIComponent(JSON.stringify(options.where)));

        args.push('group=' + JSON.stringify(grouping));
      }

      this._makeParseServerRequest('/aggregate/' + options.collection + (args.length > 0 ? '?' + args.join('&') : ''), {
        success: function (response) {
          const res = {};

          if (!response.results || response.results.length !== 1) {
            options.success({}); // No result
            return;
          }

          Object.keys(options.group).forEach((k) => {
            res[k] = response.results[0][k];
          });

          options.success(res);
        },
        error: function () {
          options.error();
        }
      });
    }
  }

  count(options) {
    // NEW: Use multi-backend routing
    const backend = this._selectBackend(options);
    if (backend === 'supabase') {
      const pathInfo = this._parseSupabasePath('/classes/' + options.collection, options);
      this._supabaseCount(pathInfo, options);
    } else {
      // Parse Server implementation (unchanged)
      const args = [];

      if (options.where) args.push('where=' + encodeURIComponent(JSON.stringify(options.where)));
      args.push('limit=0');
      args.push('count=1');

      this._makeParseServerRequest('/classes/' + options.collection + (args.length > 0 ? '?' + args.join('&') : ''), {
        success: function (response) {
          options.success(response.count);
        },
        error: function () {
          options.error();
        }
      });
    }
  }

  distinct(options) {
    // NEW: Use multi-backend routing
    const backend = this._selectBackend(options);
    if (backend === 'supabase') {
      // For Supabase, we need to implement distinct using a regular query
      const modifiedOptions = {
        ...options,
        success: function (results) {
          // Extract distinct values from the property
          const distinctValues = [...new Set(results.map((item) => item[options.property]))];
          options.success(distinctValues);
        }
      };

      const pathInfo = this._parseSupabasePath('/classes/' + options.collection, modifiedOptions);
      this._supabaseQuery(pathInfo, modifiedOptions);
    } else {
      // Parse Server implementation (unchanged)
      const args = [];

      if (options.where) args.push('where=' + encodeURIComponent(JSON.stringify(options.where)));
      args.push('distinct=' + options.property);

      this._makeParseServerRequest('/aggregate/' + options.collection + (args.length > 0 ? '?' + args.join('&') : ''), {
        success: function (response) {
          options.success(response.results);
        },
        error: function () {
          options.error();
        }
      });
    }
  }

  /**
   *
   * @param {{
   *    objectId: string;
   *    collection: string;
   *    keys?: string[] | string;
   *    include?: string[] | string;
   *    excludeKeys?: string[] | string;
   *    success: (data: unknown) => void;
   *    error: (error: unknown) => void;
   * }} options
   */
  fetch(options) {
    // NEW: Use multi-backend routing
    const backend = this._selectBackend(options);
    if (backend === 'supabase') {
      const pathInfo = this._parseSupabasePath('/classes/' + options.collection + '/' + options.objectId, options);
      this._supabaseFetch(pathInfo, {
        ...options,
        success: (response) => {
          options.success(response);
          this.events.emit('fetch', {
            type: 'fetch',
            objectId: options.objectId,
            object: response,
            collection: options.collection
          });
        }
      });
    } else {
      // Parse Server implementation (unchanged)
      const args = [];

      if (options.include) {
        args.push('include=' + (Array.isArray(options.include) ? options.include.join(',') : options.include));
      }

      if (options.keys) {
        args.push('keys=' + (Array.isArray(options.keys) ? options.keys.join(',') : options.keys));
      }

      if (options.excludeKeys) {
        args.push(
          'excludeKeys=' + (Array.isArray(options.excludeKeys) ? options.excludeKeys.join(',') : options.excludeKeys)
        );
      }

      this._makeParseServerRequest(
        '/classes/' + options.collection + '/' + options.objectId + (args.length > 0 ? '?' + args.join('&') : ''),
        {
          method: 'GET',
          success: (response) => {
            options.success(response);
            this.events.emit('fetch', {
              type: 'fetch',
              objectId: options.objectId,
              object: response,
              collection: options.collection
            });
          },
          error: function (res) {
            options.error(res.error);
          }
        }
      );
    }
  }

  create(options) {
    console.log(`[CloudStore] CREATE method called:`);
    console.log(`  collection: ${options.collection}`);
    console.log(`  data:`, options.data);
    console.log(`  data type:`, typeof options.data);
    console.log(`  data keys:`, options.data ? Object.keys(options.data) : 'null/undefined');
    console.log(`  full options:`, options);

    // NEW: Use multi-backend routing
    const backend = this._selectBackend(options);
    console.log(`  using backend: ${backend}`);

    if (backend === 'supabase') {
      const pathInfo = this._parseSupabasePath('/classes/' + options.collection, options);
      this._supabaseCreate(pathInfo, {
        ...options,
        content: options.data, // Make sure data is passed as content
        success: (response) => {
          console.log(`[CloudStore] Supabase create success, response:`, response);
          const _obj = Object.assign({}, options.data, response);
          options.success(_obj);
          this.events.emit('create', {
            type: 'create',
            objectId: response.objectId || response.id,
            object: _obj,
            collection: options.collection
          });
        },
        error: (error) => {
          console.error(`[CloudStore] Supabase create error:`, error);
          options.error(error.error || error);
        }
      });
    } else {
      // Parse Server implementation (unchanged)
      this._makeParseServerRequest('/classes/' + options.collection, {
        method: 'POST',
        content: Object.assign(
          _removeProtectedFields(_serializeObject(options.data, options.collection), options.collection),
          { ACL: options.acl }
        ),
        success: (response) => {
          const _obj = Object.assign({}, options.data, response);
          options.success(_obj);
          this.events.emit('create', {
            type: 'create',
            objectId: options.objectId,
            object: _obj,
            collection: options.collection
          });
        },
        error: function (res) {
          options.error(res.error);
        }
      });
    }
  }

  increment(options) {
    // NEW: Use multi-backend routing
    const backend = this._selectBackend(options);
    if (backend === 'supabase') {
      // For Supabase, implement increment via update
      const data = {};
      for (let key in options.properties) {
        data[key] = options.properties[key]; // Direct increment for now
      }

      const pathInfo = this._parseSupabasePath('/classes/' + options.collection + '/' + options.objectId, options);
      this._supabaseUpdate(pathInfo, {
        ...options,
        data: data
      });
    } else {
      // Parse Server implementation (unchanged)
      const data = {};

      for (let key in options.properties) {
        data[key] = { __op: 'Increment', amount: options.properties[key] };
      }

      this._makeParseServerRequest('/classes/' + options.collection + '/' + options.objectId, {
        method: 'PUT',
        content: data,
        success: (response) => {
          options.success(response);
        },
        error: function (res) {
          options.error(res.error);
        }
      });
    }
  }

  save(options) {
    // NEW: Use multi-backend routing
    const backend = this._selectBackend(options);
    if (backend === 'supabase') {
      const _data = Object.assign({}, options.data);
      delete _data.createdAt;
      delete _data.updatedAt;
      delete _data.created_at;
      delete _data.updated_at;

      const pathInfo = this._parseSupabasePath('/classes/' + options.collection + '/' + options.objectId, options);
      this._supabaseUpdate(pathInfo, {
        ...options,
        content: _data,
        success: (response) => {
          options.success(response);
          this.events.emit('save', {
            type: 'save',
            objectId: options.objectId,
            object: Object.assign({}, options.data, response),
            collection: options.collection
          });
        },
        error: function (res) {
          options.error(res.error);
        }
      });
    } else {
      // Parse Server implementation (unchanged)
      const _data = Object.assign({}, options.data);
      delete _data.createdAt;
      delete _data.updatedAt;

      this._makeParseServerRequest('/classes/' + options.collection + '/' + options.objectId, {
        method: 'PUT',
        content: Object.assign(
          _removeProtectedFields(_serializeObject(_data, options.collection), options.collection),
          {
            ACL: options.acl
          }
        ),
        success: (response) => {
          options.success(response);
          this.events.emit('save', {
            type: 'save',
            objectId: options.objectId,
            object: Object.assign({}, options.data, response),
            collection: options.collection
          });
        },
        error: function (res) {
          options.error(res.error);
        }
      });
    }
  }

  delete(options) {
    console.log('[CloudStore] DELETE method called with options:', options);
    console.log('[CloudStore] DELETE options details:', {
      collection: options.collection,
      objectId: options.objectId,
      hasCollection: !!options.collection,
      hasObjectId: !!options.objectId
    });
    // NEW: Use multi-backend routing
    const backend = this._selectBackend(options);
    console.log('[CloudStore] DELETE routing to backend:', backend);
    if (backend === 'supabase') {
      const pathInfo = this._parseSupabasePath('/classes/' + options.collection + '/' + options.objectId, options);
      this._supabaseDelete(pathInfo, {
        ...options,
        success: () => {
          options.success();
          this.events.emit('delete', {
            type: 'delete',
            objectId: options.objectId,
            collection: options.collection
          });
        }
      });
    } else {
      // Parse Server implementation (unchanged)
      console.log(
        '[CloudStore] DELETE using Parse Server fallback for collection:',
        options.collection,
        'objectId:',
        options.objectId
      );
      this._makeParseServerRequest('/classes/' + options.collection + '/' + options.objectId, {
        method: 'DELETE',
        success: () => {
          options.success();
          this.events.emit('delete', {
            type: 'delete',
            objectId: options.objectId,
            collection: options.collection
          });
        },
        error: function (res) {
          options.error(res.error);
        }
      });
    }
  }

  addRelation(options) {
    // NEW: Use multi-backend routing
    const backend = this._selectBackend(options);
    if (backend === 'supabase') {
      // For Supabase, relations would need to be handled differently
      // This is a complex feature that might need table design considerations
      console.warn('[CloudStore] addRelation not fully implemented for Supabase backend yet');
      options.error('Relations not yet supported for Supabase backend');
    } else {
      // Parse Server implementation (unchanged)
      const _content = {};
      _content[options.key] = {
        __op: 'AddRelation',
        objects: [
          {
            __type: 'Pointer',
            objectId: options.targetObjectId,
            className: options.targetClass
          }
        ]
      };
      this._makeParseServerRequest('/classes/' + options.collection + '/' + options.objectId, {
        method: 'PUT',
        content: _content,
        success: function (response) {
          options.success(response);
        },
        error: function (res) {
          options.error(res.error);
        }
      });
    }
  }

  removeRelation(options) {
    // NEW: Use multi-backend routing
    const backend = this._selectBackend(options);
    if (backend === 'supabase') {
      // For Supabase, relations would need to be handled differently
      console.warn('[CloudStore] removeRelation not fully implemented for Supabase backend yet');
      options.error('Relations not yet supported for Supabase backend');
    } else {
      // Parse Server implementation (unchanged)
      const _content = {};
      _content[options.key] = {
        __op: 'RemoveRelation',
        objects: [
          {
            __type: 'Pointer',
            objectId: options.targetObjectId,
            className: options.targetClass
          }
        ]
      };
      this._makeParseServerRequest('/classes/' + options.collection + '/' + options.objectId, {
        method: 'PUT',
        content: _content,
        success: function (response) {
          options.success(response);
        },
        error: function (res) {
          options.error(res.error);
        }
      });
    }
  }

  uploadFile(options) {
    const backend = this._selectBackend(options);

    if (backend === 'supabase' && this.supabaseClient) {
      this._uploadFileSupabase(options);
    } else {
      // Fallback to Parse Server
      this._uploadFileParseServer(options);
    }
  }

  _uploadFileParseServer(options) {
    this._makeParseServerRequest('/files/' + options.file.name, {
      method: 'POST',
      content: options.file,
      contentType: options.file.type,
      success: (response) => options.success(Object.assign({}, options.data, response)),
      error: (err) => options.error(err),
      onUploadProgress: options.onUploadProgress
    });
  }

  async _uploadFileSupabase(options) {
    console.log(`[CloudStore] _uploadFileSupabase called at ${new Date().toISOString()}`);

    if (!this.supabaseClient) {
      console.error('[CloudStore] Supabase client not initialized, falling back to Parse Server');
      this._uploadFileParseServer(options);
      return;
    }

    console.log(`[CloudStore] Supabase client is available, proceeding with upload at ${new Date().toISOString()}`);

    try {
      const file = options.file;
      const fileName = file.name;

      console.log('[CloudStore] File details:', {
        fileName: fileName,
        fileType: file.type,
        fileSize: file.size
      });

      console.log('[CloudStore] Supabase upload - file object:', {
        constructor: file.constructor.name,
        keys: Object.keys(file),
        hasArrayBuffer: typeof file.arrayBuffer === 'function',
        hasBase64: !!file.base64,
        hasData: !!file.data,
        dataType: file.data ? typeof file.data : 'undefined',
        dataConstructor: file.data ? file.data.constructor.name : 'undefined'
      });

      // Get Supabase storage configuration
      const storageConfig = this._getSupabaseStorageConfig();
      const bucket = storageConfig.bucket || 'uploads';
      const folder = storageConfig.folder || 'files';

      console.log('[CloudStore] Supabase upload config:', {
        bucket: bucket,
        folder: folder,
        supabaseUrl: this.supabaseClient.supabaseUrl,
        supabaseKey: this.supabaseClient.supabaseKey ? 'Present' : 'Missing'
      });

      // First, let's test if we can list buckets to verify connection
      try {
        console.log('[CloudStore] Testing Supabase Storage connection...');
        const { data: buckets, error: listError } = await this.supabaseClient.storage.listBuckets();
        console.log('[CloudStore] Available buckets:', buckets);
        if (listError) {
          console.error('[CloudStore] Error listing buckets:', listError);
        }
      } catch (listErr) {
        console.error('[CloudStore] Failed to list buckets:', listErr);
      }

      // Create unique file path
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const uniqueFileName = `${timestamp}_${fileName}`;
      const filePath = folder ? `${folder}/${uniqueFileName}` : uniqueFileName;

      // Convert file to ArrayBuffer - enhanced detection
      let fileData;

      if (file instanceof File || file instanceof Blob) {
        console.log('[CloudStore] Converting File/Blob to ArrayBuffer');
        fileData = await file.arrayBuffer();
      } else if (typeof file === 'string') {
        console.log('[CloudStore] File is a string (likely file path), need to read file data');
        // If it's a string, it might be a file path. We need to fallback to Parse Server
        // or ask the user to implement file reading for local files
        throw new Error(
          'File paths are not supported for Supabase upload. Please ensure the Open File Picker is properly connected and outputting a File object, not a file path.'
        );
      } else if (file.data) {
        if (file.data instanceof ArrayBuffer) {
          console.log('[CloudStore] Using file.data as ArrayBuffer');
          fileData = file.data;
        } else if (file.data instanceof Uint8Array) {
          console.log('[CloudStore] Converting Uint8Array to ArrayBuffer');
          fileData = file.data.buffer;
        } else if (typeof file.data === 'string') {
          console.log('[CloudStore] Converting string data to ArrayBuffer');
          // Assume it's base64 or text data
          try {
            const binaryString = atob(file.data);
            fileData = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              fileData[i] = binaryString.charCodeAt(i);
            }
          } catch (base64Error) {
            // If not base64, treat as text
            const encoder = new TextEncoder();
            fileData = encoder.encode(file.data);
          }
        } else {
          console.log('[CloudStore] Unknown file.data type, trying to convert');
          fileData = new Uint8Array(file.data);
        }
      } else if (file.base64) {
        console.log('[CloudStore] Converting base64 to ArrayBuffer');
        const binaryString = atob(file.base64);
        fileData = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          fileData[i] = binaryString.charCodeAt(i);
        }
      } else if (typeof file.arrayBuffer === 'function') {
        console.log('[CloudStore] Using file.arrayBuffer() method');
        fileData = await file.arrayBuffer();
      } else {
        console.error('[CloudStore] Unsupported file format details:', {
          fileType: typeof file,
          constructor: file.constructor.name,
          hasData: !!file.data,
          hasBase64: !!file.base64,
          hasArrayBuffer: typeof file.arrayBuffer,
          keys: Object.keys(file)
        });
        throw new Error(
          'Unsupported file format for Supabase upload. Please ensure the file input contains actual file data, not just a file path.'
        );
      }

      // Upload to Supabase Storage
      const { data, error } = await this.supabaseClient.storage.from(bucket).upload(filePath, fileData, {
        contentType: file.type || 'application/octet-stream',
        cacheControl: '3600',
        upsert: false
      });

      if (error) {
        console.error('[CloudStore] Supabase upload error:', error);

        // Provide helpful error messages for common issues
        let errorMessage = error.message;
        if (error.message === 'Bucket not found' || error.statusCode === '404') {
          errorMessage = `Supabase Storage bucket "${bucket}" not found. Please create the bucket in your Supabase Dashboard under Storage, or configure a different bucket name in your metadata.`;
        } else if (error.statusCode === '401' || error.statusCode === '403') {
          errorMessage = `Access denied to Supabase Storage bucket "${bucket}". Please check your bucket policies and authentication.`;
        }

        options.error({ error: errorMessage, code: error.code || error.statusCode || 500 });
        return;
      }

      // Get public URL
      const { data: urlData } = this.supabaseClient.storage.from(bucket).getPublicUrl(filePath);

      // Format response to match Parse Server format
      const response = {
        name: uniqueFileName,
        url: urlData.publicUrl,
        __type: 'File'
      };

      console.log('[CloudStore] Supabase upload successful, response:', response);
      console.log('[CloudStore] URL should be:', urlData.publicUrl);

      options.success(Object.assign({}, options.data, response));
    } catch (error) {
      console.error('[CloudStore] Supabase upload failed:', error);
      options.error({ error: error.message || 'Upload failed', code: 500 });
    }
  }

  _getSupabaseStorageConfig() {
    // Get storage configuration from metadata or use defaults
    try {
      const metadata = window.xgeniaRuntime?.instance?.graphModel?.getMetaData?.();
      const cloudServices = metadata?.xgenia?.cloudServices;

      if (cloudServices?.supabase?.storage) {
        return cloudServices.supabase.storage;
      }
    } catch (error) {
      console.warn('[CloudStore] Could not get storage config from metadata:', error.message);
    }

    // Return default configuration
    return {
      bucket: 'uploads',
      folder: 'files'
    };
  }

  /**
   * Users holding the master key are allowed to delete files
   *
   * @param {{
   *    file: {
   *      name: string;
   *    }
   *    success: (data: unknown) => void;
   *    error: (error: unknown) => void;
   * }} options
   */
  deleteFile(options) {
    const backend = this._selectBackend(options);

    if (backend === 'supabase' && this.supabaseClient) {
      this._deleteFileSupabase(options);
    } else {
      // Fallback to Parse Server
      this._deleteFileParseServer(options);
    }
  }

  _deleteFileParseServer(options) {
    this._makeParseServerRequest('/files/' + options.file.name, {
      method: 'DELETE',
      success: (response) => options.success(Object.assign({}, options.data, response)),
      error: (err) => options.error(err)
    });
  }

  async _deleteFileSupabase(options) {
    if (!this.supabaseClient) {
      console.error('[CloudStore] Supabase client not initialized, falling back to Parse Server');
      this._deleteFileParseServer(options);
      return;
    }

    try {
      const fileName = options.file.name;
      const storageConfig = this._getSupabaseStorageConfig();
      const bucket = storageConfig.bucket || 'uploads';
      const folder = storageConfig.folder || 'files';

      // Construct file path
      const filePath = folder ? `${folder}/${fileName}` : fileName;

      // Delete from Supabase Storage
      const { data, error } = await this.supabaseClient.storage.from(bucket).remove([filePath]);

      if (error) {
        console.error('[CloudStore] Supabase delete error:', error);
        options.error({ error: error.message, code: error.code || 500 });
        return;
      }

      // Format success response
      const response = {
        name: fileName,
        deleted: true
      };

      options.success(Object.assign({}, options.data, response));
    } catch (error) {
      console.error('[CloudStore] Supabase delete failed:', error);
      options.error({ error: error.message || 'Delete failed', code: 500 });
    }
  }

  /**
   * Test Supabase connection with provided configuration (for UI testing)
   * @param {Object} config - Configuration object with supabase settings
   * @returns {Promise<Object>} Test result object
   */
  static async testSupabaseConnectionWithConfig(config) {
    const testStartTime = Date.now();
    console.log('[CloudStore] === SUPABASE CONNECTION TEST STARTED ===');
    console.log('[CloudStore] Test config received:', {
      hasSupabaseConfig: !!config.supabase,
      enabled: config.supabase?.enabled,
      hasUrl: !!config.supabase?.url,
      hasAnonKey: !!config.supabase?.anonKey,
      hasServiceRoleKey: !!config.supabase?.serviceRoleKey,
      enableRealtime: config.supabase?.enableRealtime
    });

    try {
      // Step 1: Validate configuration
      if (!config.supabase || !config.supabase.enabled) {
        return {
          success: false,
          error: 'Supabase not enabled in configuration',
          details: 'Configuration does not have Supabase enabled',
          testDuration: Date.now() - testStartTime
        };
      }

      const { url, anonKey, serviceRoleKey } = config.supabase;

      if (!url || !anonKey) {
        return {
          success: false,
          error: 'Missing required Supabase configuration',
          details: 'URL and Anonymous Key are required',
          testDuration: Date.now() - testStartTime
        };
      }

      // Step 2: Validate URL format
      try {
        const urlObj = new URL(url);
        if (!urlObj.hostname.includes('supabase.co') && !urlObj.hostname.includes('supabase.net')) {
          console.warn('[CloudStore] URL does not appear to be a Supabase URL:', url);
        }
      } catch (urlError) {
        return {
          success: false,
          error: 'Invalid Supabase URL format',
          details: `URL "${url}" is not a valid URL`,
          testDuration: Date.now() - testStartTime
        };
      }

      // Step 3: Import Supabase client
      console.log('[CloudStore] Attempting to import Supabase client...');
      let createClient;

      try {
        // Try direct require first
        const supabaseModule = require('@supabase/supabase-js');
        createClient = supabaseModule.createClient;
        console.log('[CloudStore] Successfully imported @supabase/supabase-js via require()');
      } catch (requireError) {
        console.warn('[CloudStore] Direct require failed:', requireError.message);

        // Try window.supabase if available
        if (typeof window !== 'undefined' && window.supabase && window.supabase.createClient) {
          createClient = window.supabase.createClient;
          console.log('[CloudStore] Using window.supabase.createClient');
        } else {
          return {
            success: false,
            error: 'Supabase client not available',
            details: '@supabase/supabase-js package not found. Please install: npm install @supabase/supabase-js',
            requireError: requireError.message,
            testDuration: Date.now() - testStartTime
          };
        }
      }

      // Step 4: Create test client with minimal configuration
      console.log('[CloudStore] Creating Supabase test client...');
      let testClient;

      try {
        testClient = createClient(url, anonKey, {
          auth: {
            persistSession: false, // Don't persist for test
            autoRefreshToken: false // Don't auto-refresh for test
          },
          realtime: {
            enabled: false // Disable realtime for connection test to avoid _realtime table queries
          },
          global: {
            headers: {
              'x-client-info': 'xgenia-test-client' // Identify our test requests
            }
          }
        });
        console.log('[CloudStore] Test client created successfully');
      } catch (clientError) {
        return {
          success: false,
          error: 'Failed to create Supabase client',
          details: clientError.message || String(clientError),
          testDuration: Date.now() - testStartTime
        };
      }

      // Step 5: Test connection with the most basic possible operation
      console.log('[CloudStore] Testing connection with auth.getUser()...');

      try {
        const authTest = await Promise.race([
          testClient.auth.getUser(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Auth test timeout after 10 seconds')), 10000))
        ]);

        console.log('[CloudStore] Auth test completed successfully');

        return {
          success: true,
          message: 'Supabase connection test successful',
          details: 'Successfully connected to Supabase using auth endpoint',
          endpoint: url,
          authStatus: authTest.data?.user ? 'authenticated' : 'anonymous',
          hasServiceRole: !!serviceRoleKey,
          realtimeConfigured: config.supabase.enableRealtime !== false,
          testDuration: Date.now() - testStartTime,
          testMethod: 'auth.getUser'
        };
      } catch (authError) {
        console.warn('[CloudStore] Auth test failed, trying REST API test...', authError.message);

        // Step 6: Fallback to direct REST API test
        try {
          const restUrl = `${url}/rest/v1/`;
          console.log('[CloudStore] Testing REST API endpoint:', restUrl);

          const restTest = await Promise.race([
            fetch(restUrl, {
              method: 'GET',
              headers: {
                apikey: anonKey,
                Authorization: `Bearer ${anonKey}`,
                'Content-Type': 'application/json'
              }
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('REST test timeout after 10 seconds')), 10000))
          ]);

          console.log('[CloudStore] REST API test response status:', restTest.status);

          // Any response (even 404) means we can reach the server
          if (restTest.status < 500) {
            return {
              success: true,
              message: 'Supabase connection test successful',
              details: 'Successfully connected to Supabase REST API endpoint',
              endpoint: url,
              authStatus: 'anonymous',
              hasServiceRole: !!serviceRoleKey,
              realtimeConfigured: config.supabase.enableRealtime !== false,
              testDuration: Date.now() - testStartTime,
              testMethod: 'rest-api',
              restStatus: restTest.status
            };
          } else {
            throw new Error(`REST API returned server error: ${restTest.status}`);
          }
        } catch (restError) {
          console.error('[CloudStore] Both auth and REST tests failed:', restError.message);

          // Step 7: Last resort - validate client creation only
          if (testClient && typeof testClient.from === 'function') {
            return {
              success: true,
              message: 'Supabase client validation successful',
              details: 'Client created successfully but could not verify server connectivity',
              endpoint: url,
              authStatus: 'unknown',
              hasServiceRole: !!serviceRoleKey,
              realtimeConfigured: config.supabase.enableRealtime !== false,
              testDuration: Date.now() - testStartTime,
              testMethod: 'client-validation-only',
              warning:
                'Could not verify server connectivity - check your internet connection and Supabase project status'
            };
          } else {
            return {
              success: false,
              error: 'Complete connection test failure',
              details: 'Could not create valid Supabase client or connect to server',
              authError: authError.message,
              restError: restError.message,
              testDuration: Date.now() - testStartTime
            };
          }
        }
      }
    } catch (error) {
      console.error('[CloudStore] Unexpected error during connection test:', error);
      return {
        success: false,
        error: 'Unexpected connection test failure',
        details: error.message || String(error),
        stack: error.stack,
        testDuration: Date.now() - testStartTime
      };
    } finally {
      console.log(`[CloudStore] === SUPABASE CONNECTION TEST COMPLETED in ${Date.now() - testStartTime}ms ===`);
    }
  }

  // NEW METHOD: Restore tables from localStorage if they were lost
  _restoreTablesFromStorage() {
    try {
      const storedData = localStorage.getItem('xgenia_supabase_discovered_tables');
      if (!storedData) {
        console.log('[CloudStore] No stored tables found in localStorage');
        return [];
      }

      const metadata = JSON.parse(storedData);

      // Check if stored tables are for the current Supabase instance
      if (metadata.supabaseUrl && metadata.supabaseUrl !== this.supabaseClient?.supabaseUrl) {
        console.log('[CloudStore] Stored tables are for different Supabase instance, ignoring');
        return [];
      }

      // Check if stored data is recent (within last 24 hours)
      const lastUpdate = new Date(metadata.lastUpdate);
      const now = new Date();
      const hoursSinceUpdate = (now.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60);

      if (hoursSinceUpdate > 24) {
        console.log('[CloudStore] Stored tables are too old (>24h), will refresh');
        return [];
      }

      console.log(`[CloudStore] Restoring ${metadata.tables.length} tables from localStorage`);

      // Convert stored data back to table format
      return metadata.tables.map((t) => ({
        name: t.name,
        schema: t.schema,
        _isSupabaseTable: true,
        _discoveredAt: t.discoveredAt,
        _discoveryMethod: t.method || 'localStorage_restore'
      }));
    } catch (error) {
      console.warn('[CloudStore] Failed to restore tables from localStorage:', error);
      return [];
    }
  }

  // NEW METHOD: Manual table discovery refresh (can be called from UI)
  async forceTableDiscovery() {
    console.log('[CloudStore] Manual table discovery requested...');

    if (!this.supabaseClient) {
      console.warn('[CloudStore] Cannot discover tables: Supabase client not initialized');
      return { success: false, error: 'Supabase client not initialized' };
    }

    try {
      const startTime = Date.now();

      // Force discovery of tables with schema
      const discoveredTables = await this.discoverSupabaseTablesWithSchema();

      const duration = Date.now() - startTime;

      if (discoveredTables.length > 0) {
        // Update metadata immediately
        this._updateDbCollectionsMetadata(discoveredTables);

        console.log(
          `[CloudStore] Manual discovery completed in ${duration}ms. Found ${discoveredTables.length} tables:`,
          discoveredTables.map((t) => t.name)
        );

        // Force UI refresh by emitting events
        if (xgeniaRuntime.instance && xgeniaRuntime.instance.graphModel) {
          xgeniaRuntime.instance.graphModel.emit(
            'metadataChanged.dbCollections',
            xgeniaRuntime.instance.getMetaData('dbCollections')
          );
          xgeniaRuntime.instance.graphModel.emit('collectionsUpdated', {
            type: 'supabase_discovery',
            tables: discoveredTables
          });
        }

        return {
          success: true,
          tablesFound: discoveredTables.length,
          tables: discoveredTables.map((t) => ({ name: t.name, method: t._discoveryMethod })),
          duration: duration
        };
      } else {
        console.warn('[CloudStore] Manual discovery found no tables');
        return {
          success: false,
          error: 'No tables found',
          suggestions: [
            'Check that tables exist in your Supabase database',
            'Verify API key permissions',
            'Ensure tables are in the public schema',
            'Check Row Level Security settings'
          ]
        };
      }
    } catch (error) {
      console.error('[CloudStore] Manual table discovery failed:', error);
      return {
        success: false,
        error: error.message || 'Discovery failed',
        details: error.stack
      };
    }
  }

  // NEW METHOD: Get current table discovery status
  getTableDiscoveryStatus() {
    if (!xgeniaRuntime.instance) {
      return { status: 'unavailable', error: 'Runtime not available' };
    }

    const dbCollections = xgeniaRuntime.instance.getMetaData('dbCollections') || [];
    const supabaseTables = dbCollections.filter((c) => c._isSupabaseTable);

    return {
      status: 'available',
      totalCollections: dbCollections.length,
      supabaseTables: supabaseTables.length,
      tables: supabaseTables.map((t) => ({
        name: t.name,
        discoveredAt: t._discoveredAt,
        method: t._discoveryMethod
      })),
      lastDiscovery:
        supabaseTables.length > 0
          ? Math.max(...supabaseTables.map((t) => new Date(t._discoveredAt || 0).getTime()))
          : null
    };
  }

  // NEW METHOD: Manual refresh for when users add new tables
  async refreshTableDiscovery() {
    console.log('[CloudStore] Manual table discovery refresh requested...');

    if (!this.supabaseClient) {
      console.warn('[CloudStore] Cannot refresh - Supabase client not available');
      return false;
    }

    try {
      // Force fresh discovery by clearing cache first
      if (xgeniaRuntime.instance) {
        console.log('[CloudStore] Clearing existing table cache...');
        const currentCollections = xgeniaRuntime.instance.getMetaData('dbCollections') || [];
        const nonSupabaseCollections = currentCollections.filter((c) => !c._isSupabaseTable);
        xgeniaRuntime.instance.graphModel.setMetaData('dbCollections', nonSupabaseCollections);
      }

      // Run fresh discovery
      const discoveredTables = await this.discoverSupabaseTablesWithSchema();

      if (discoveredTables.length > 0) {
        console.log(`[CloudStore] Manual refresh discovered ${discoveredTables.length} tables`);
        this._updateDbCollectionsMetadata(discoveredTables);

        // Force immediate UI refresh by invalidating cache and emitting events
        _collections = undefined;

        if (xgeniaRuntime.instance && xgeniaRuntime.instance.graphModel) {
          // Force refresh of all DbCollection2 nodes
          xgeniaRuntime.instance.graphModel.emit(
            'metadataChanged.dbCollections',
            xgeniaRuntime.instance.getMetaData('dbCollections')
          );
          xgeniaRuntime.instance.graphModel.emit('forceNodePortsUpdate');
          xgeniaRuntime.instance.graphModel.emit('collectionsUpdated', {
            type: 'manual_refresh',
            timestamp: new Date().toISOString(),
            tablesFound: discoveredTables.length
          });
        }

        return true;
      } else {
        console.log('[CloudStore] Manual refresh found no new tables');
        return false;
      }
    } catch (error) {
      console.error('[CloudStore] Manual refresh failed:', error);
      return false;
    }
  }

  // NEW METHOD: Test authentication and RLS setup
  async testAuthenticationAndRLS(tableName) {
    console.log('🔍 Testing Authentication and RLS for table:', tableName);
    console.log('==========================================');

    // Test 1: Check CloudStore authentication
    const client = this._getSupabaseClient();
    const isAuthenticatedClient = client !== this.supabaseClient;
    console.log('1. Using authenticated client:', isAuthenticatedClient);

    // Test 2: Check current user
    const currentUser = await this._getCurrentSupabaseUser();
    console.log('2. Current user:', currentUser?.id || 'Not authenticated');

    // Test 3: Check session directly
    try {
      const {
        data: { session },
        error
      } = await client.auth.getSession();
      console.log('3. Session valid:', !!session?.user);
      console.log('   User ID:', session?.user?.id || 'None');
    } catch (sessionError) {
      console.log('3. Session check failed:', sessionError.message);
    }

    // Test 4: Test table access
    try {
      console.log('4. Testing table access...');
      const { data, error } = await client.from(tableName).select('*').limit(1);
      if (error) {
        console.log('   ❌ Table access failed:', error.message);
        console.log('   Error details:', error);
      } else {
        console.log('   ✅ Table access successful');
        console.log('   Records found:', data?.length || 0);
      }
    } catch (tableError) {
      console.log('   ❌ Table access error:', tableError.message);
    }

    // Test 5: Check RLS policies
    try {
      console.log('5. Checking RLS policies...');
      const { data: policies, error: policyError } = await client
        .from('pg_policies')
        .select('*')
        .eq('tablename', tableName);

      if (policyError) {
        console.log('   ❌ Could not check policies:', policyError.message);
      } else {
        console.log('   ✅ RLS policies found:', policies?.length || 0);
        policies?.forEach((policy) => {
          console.log(`     - ${policy.policyname}: ${policy.cmd}`);
        });
      }
    } catch (policyError) {
      console.log('   ❌ Policy check error:', policyError.message);
    }

    console.log('==========================================');

    return {
      authenticatedClient: isAuthenticatedClient,
      currentUser: currentUser?.id,
      hasSession: !!currentUser,
      tableAccessible: !!(await this._testTableAccess(tableName, client))
    };
  }

  async _testTableAccess(tableName, client) {
    try {
      const { data, error } = await client.from(tableName).select('*').limit(1);
      return !error;
    } catch (error) {
      return false;
    }
  }
}

function _isArrayOfObjects(a) {
  if (!Array.isArray(a)) {
    return false;
  }

  for (let i = 0; i < a.length; i++) {
    if (typeof a[i] !== 'object' || a[i] === null) {
      return false;
    }
  }

  return true;
}

function _toJSON(obj) {
  if (obj instanceof Model) {
    var res = {};
    for (var key in obj.data) {
      res[key] = _toJSON(obj.data[key]);
    }
    return res;
  } else if (obj instanceof Collection) {
    var res = [];
    obj.items.forEach((m) => {
      res.push(_toJSON(m));
    });
    return res;
  }
  return obj;
}

function _serializeObject(data, collectionName, modelScope) {
  if (CloudStore._collections[collectionName]) var schema = CloudStore._collections[collectionName].schema;

  for (var key in data) {
    var _type = schema && schema.properties && schema.properties[key] ? schema.properties[key].type : undefined;

    if (data[key] === undefined || data[key] === null) {
      // Keep null and undefined as is
    } else if (_type === 'Pointer' && typeof data[key] === 'string') {
      // This is a string pointer to an object
      data[key] = {
        __type: 'Pointer',
        className: schema.properties[key].targetClass,
        objectId: data[key]
      };
    } else if (_type === 'Pointer' && typeof data[key] === 'object' && (modelScope || Model).instanceOf(data[key])) {
      // This is an embedded object that should be stored as pointer
      data[key] = {
        __type: 'Pointer',
        className: schema.properties[key].targetClass,
        objectId: data[key].getId()
      };
    } else if (_type === 'Date' && (typeof data[key] === 'string' || data[key] instanceof Date)) {
      data[key] = {
        __type: 'Date',
        iso: data[key] instanceof Date ? data[key].toISOString() : data[key]
      };
    } else if (_type === 'File' && data[key] instanceof CloudFile) {
      const cloudFile = data[key];
      data[key] = {
        __type: 'File',
        url: cloudFile.getUrl(),
        name: cloudFile.getName()
      };
    } else if (_type === 'Array' && typeof data[key] === 'string' && Collection.exists(data[key])) {
      data[key] = _toJSON(Collection.get(data[key]));
    } else if (_type === 'Object' && typeof data[key] === 'string' && (modelScope || Model).exists(data[key])) {
      data[key] = _toJSON((modelScope || Model).get(data[key]));
    } else if (_type === 'GeoPoint' && typeof data[key] === 'object') {
      data[key] = {
        __type: 'GeoPoint',
        latitude: Number(data[key].latitude),
        longitude: Number(data[key].longitude)
      };
    } else data[key] = _toJSON(data[key]);
  }

  return data;
}

/**
 *
 * @param {unknown} data
 * @param {string} type
 * @param {*} modelScope
 * @returns
 */
function _deserializeJSON(data, type, modelScope) {
  if (data === undefined) return undefined;
  if (data === null) return null;

  if (type === 'Relation' && data.__type === 'Relation') {
    return undefined; // Ignore relation fields
  }

  // This is a pointer type, resolve into id
  if (type === 'Pointer' && data.__type === 'Pointer') {
    return data.objectId;
  }

  if (type === 'Date' && data.__type === 'Date') {
    return new Date(data.iso);
  }

  if (type === 'Date' && typeof data === 'string') {
    return new Date(data);
  }

  if (type === 'File' && data.__type === 'File') {
    return new CloudFile(data);
  }

  if (type === 'GeoPoint' && data.__type === 'GeoPoint') {
    return {
      latitude: data.latitude,
      longitude: data.longitude
    };
  }

  if (_isArrayOfObjects(data)) {
    const a = [];
    for (let i = 0; i < data.length; i++) {
      a.push(_deserializeJSON(data[i], undefined, modelScope));
    }
    const c = Collection.get();
    c.set(a);
    return c;
  }

  // An array with mixed types
  if (Array.isArray(data)) {
    return data;
  }

  // This is an array with mixed data, just return it
  if (data && data.__type === 'Object' && data.className !== undefined && data.objectId !== undefined) {
    const _data = Object.assign({}, data);
    delete _data.className;
    delete _data.__type;
    return _fromJSON(_data, data.className, modelScope);
  }

  if (typeof data === 'object' && data !== null) {
    // Try to get the model by id, if it is defined, otherwise we create a new unique id.
    const model = (modelScope || Model).get(data.id);
    for (const key in data) {
      const nestedValue = _deserializeJSON(data[key], undefined, modelScope);
      model.set(key, nestedValue);
    }
    return model;
  }

  return data;
}

function _fromJSON(item, collectionName, modelScope) {
  const modelStore = modelScope || Model;

  // Try to get the model by the object id (record) or id, otherwise we create a new unique id.
  const model = modelStore.get(item.objectId || item.id);
  model._class = collectionName;

  let schema = undefined;
  if (collectionName !== undefined && CloudStore._collections[collectionName] !== undefined) {
    schema = CloudStore._collections[collectionName].schema;
  }

  for (const key in item) {
    if (key === 'objectId' || key === 'ACL') {
      continue;
    }

    const _type = schema && schema.properties && schema.properties[key] ? schema.properties[key].type : undefined;
    const nestedValue = _deserializeJSON(item[key], _type, modelScope);
    model.set(key, nestedValue);
  }

  return model;
}

CloudStore._fromJSON = _fromJSON;
CloudStore._deserializeJSON = _deserializeJSON;
CloudStore._serializeObject = _serializeObject;

CloudStore.forScope = (modelScope) => {
  if (modelScope === undefined) return CloudStore.instance;
  if (modelScope._cloudStore) return modelScope._cloudStore;

  modelScope._cloudStore = new CloudStore(modelScope);
  return modelScope._cloudStore;
};

var _instance;
Object.defineProperty(CloudStore, 'instance', {
  get: function () {
    if (_instance === undefined) _instance = new CloudStore();
    return _instance;
  }
});

var _collections;
Object.defineProperty(CloudStore, '_collections', {
  get: function () {
    if (_collections === undefined) {
      _collections = {};
      const dbCollections = xgeniaRuntime.instance.getMetaData('dbCollections') || [];
      dbCollections.forEach((c) => {
        _collections[c.name] = c;
      });

      const systemCollections = xgeniaRuntime.instance.getMetaData('systemCollections') || [];
      systemCollections.forEach((c) => {
        _collections[c.name] = c;
      });
    }
    return _collections;
  }
});

CloudStore.invalidateCollections = () => {
  _collections = undefined;
};

// Global helper function for manual table refresh
if (typeof window !== 'undefined') {
  window.refreshSupabaseTables = async function () {
    console.log('🔄 Refreshing Supabase table discovery...');

    try {
      let cloudStore = null;

      // Try multiple ways to access CloudStore
      if (CloudStore && CloudStore.instance) {
        cloudStore = CloudStore.instance;
      } else if (typeof xgeniaRuntime !== 'undefined' && xgeniaRuntime.instance && xgeniaRuntime.instance.cloudStore) {
        cloudStore = xgeniaRuntime.instance.cloudStore;
      } else if (
        typeof window.XGENIA !== 'undefined' &&
        window.XGENIA.Navigation &&
        window.XGENIA.Navigation._xgeniaRuntime &&
        window.XGENIA.Navigation._xgeniaRuntime.cloudStore
      ) {
        cloudStore = window.XGENIA.Navigation._xgeniaRuntime.cloudStore;
      }

      if (!cloudStore) {
        console.error('❌ CloudStore not available. Make sure you have a Supabase connection configured.');
        return false;
      }

      const success = await cloudStore.refreshTableDiscovery();

      if (success) {
        console.log(
          '✅ Table discovery refreshed successfully! New tables should now appear in Query Records node dropdowns.'
        );
        console.log(
          '💡 If you still don\'t see your tables, make sure they exist in the "public" schema and have proper permissions.'
        );
      } else {
        console.log('⚠️ No new tables found. Make sure your new tables are in the "public" schema.');
      }

      return success;
    } catch (error) {
      console.error('❌ Failed to refresh table discovery:', error);
      return false;
    }
  };

  console.log('📋 XGENIA Table Refresh Helper loaded!');
  console.log('💡 After adding new tables to your Supabase database, run: window.refreshSupabaseTables()');
  console.log('🔍 To test authentication and RLS, run: window.testAuthAndRLS("your_table_name")');

  window.refreshSupabaseTables = async function () {
    console.log('🔄 Forcing Supabase table discovery...');
    try {
      const cloudStore = CloudStore.instance;
      if (cloudStore) {
        const result = await cloudStore.forceTableDiscovery();
        console.log('✅ Table discovery completed:', result);

        // Trigger UI update
        if (cloudStore.modelScope && cloudStore.modelScope.getMetaData) {
          console.log('🔄 Triggering metadata update...');
          const event = new CustomEvent('xgenia:metadata-changed', {
            detail: { type: 'dbCollections' }
          });
          window.dispatchEvent(event);
        }
      } else {
        console.log('❌ CloudStore not available');
      }
    } catch (error) {
      console.error('❌ Table discovery failed:', error);
    }
  };

  window.testAuthAndRLS = async function (tableName) {
    if (!tableName) {
      console.error('❌ Please provide a table name: testAuthAndRLS("your_table_name")');
      return;
    }

    try {
      const cloudStore = CloudStore.instance;
      if (cloudStore && cloudStore.testAuthenticationAndRLS) {
        return await cloudStore.testAuthenticationAndRLS(tableName);
      } else {
        console.error('❌ Authentication test not available');
      }
    } catch (error) {
      console.error('❌ Authentication test failed:', error);
    }
  };
}

module.exports = CloudStore;
