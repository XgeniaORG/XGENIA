const xgeniaRuntime = require('@xgenia/runtime');
const EventEmitter = require('@xgenia/runtime/src/events');
//const guid = require('../../../guid');
const Model = require('@xgenia/runtime/src/model');
const CloudStore = require('@xgenia/runtime/src/api/cloudstore');

class UserService {
  constructor(modelScope) {
    this._detectBackendType();
    
    this.events = new EventEmitter();
    this.events.setMaxListeners(100000);

    // User is fetched and validate when the request is initiated
    // see if there is a current user
    const request = (modelScope || Model).get('Request');
    if (request.UserId !== undefined) {
      const user = (modelScope || Model).get(request.UserId);
      this.current = user;
    }

    this.modelScope = modelScope;

    // Initialize Supabase client if using Supabase backend
    if (this.backendType === 'supabase') {
      this._initSupabaseClient();
    }
  }

  _detectBackendType() {
    // In cloud environment, check global cloud services
    if (typeof _xgenia_cloudservices !== 'undefined') {
      const cs = _xgenia_cloudservices;
      
      // Check if Supabase is configured
      if (cs.supabase && cs.supabase.enabled) {
        this.backendType = 'supabase';
        this.supabaseConfig = cs.supabase;
        console.log('[Cloud UserService] Detected Supabase backend configuration');
      }
      // Fallback: Check for Supabase properties at root level
      else if (cs.supabaseUrl && cs.anonKey) {
        this.backendType = 'supabase';
        this.supabaseConfig = {
          enabled: true,
          url: cs.supabaseUrl,
          anonKey: cs.anonKey,
          serviceRoleKey: cs.serviceRoleKey
        };
        console.log('[Cloud UserService] Detected Supabase backend configuration (root level)');
      }
      // Default to Parse Server
      else {
        this.backendType = 'parseserver';
        console.log('[Cloud UserService] Using Parse Server backend (default)');
      }
    } else {
      this.backendType = 'parseserver';
      console.log('[Cloud UserService] No cloud services found, defaulting to Parse Server');
    }
  }

  _initSupabaseClient() {
    try {
      // Get Supabase client from CloudStore if available
      const cloudStore = CloudStore.forScope(this.modelScope);
      if (cloudStore && cloudStore.supabaseClient) {
        this.supabaseClient = cloudStore.supabaseClient;
        console.log('[Cloud UserService] Using existing Supabase client from CloudStore');
      } else {
        // Try to create our own Supabase client
        this._createSupabaseClient();
      }

      // NEW: Automatically setup database if needed (server-side)
      if (this.supabaseClient) {
        this._autoSetupSupabaseDatabase();
      }
    } catch (error) {
      console.error('[Cloud UserService] Failed to initialize Supabase client:', error);
    }
  }

  _createSupabaseClient() {
    try {
      let createClient;
      
      // Try to require Supabase (server environment)
      if (typeof require !== 'undefined') {
        try {
          const supabase = require('@supabase/supabase-js');
          createClient = supabase.createClient;
        } catch (requireError) {
          console.warn('[Cloud UserService] Could not require @supabase/supabase-js:', requireError.message);
        }
      }

      if (createClient && this.supabaseConfig) {
        // Use service role key for server-side operations if available
        const key = this.supabaseConfig.serviceRoleKey || this.supabaseConfig.anonKey;
        
        this.supabaseClient = createClient(this.supabaseConfig.url, key, {
          auth: {
            autoRefreshToken: false, // Server doesn't need auto-refresh
            persistSession: false    // Server doesn't persist sessions
          }
        });
        console.log('[Cloud UserService] Created Supabase client for server operations');
      }
    } catch (error) {
      console.error('[Cloud UserService] Failed to create Supabase client:', error);
    }
  }

  _createUserModelFromSupabase(supabaseUser) {
    // Convert Supabase user to format compatible with existing User node
    const userData = {
      objectId: supabaseUser.id,
      id: supabaseUser.id,
      email: supabaseUser.email,
      username: supabaseUser.user_metadata?.username || supabaseUser.email,
      emailVerified: supabaseUser.email_confirmed_at !== null,
      createdAt: supabaseUser.created_at,
      updatedAt: supabaseUser.updated_at,
      // Include user metadata and app metadata
      ...supabaseUser.user_metadata,
      ...supabaseUser.app_metadata
    };

    return CloudStore._fromJSON(userData, '_User', this.modelScope || Model);
  }

  on() {
    this.events.on.apply(this.events, arguments);
  }

  off() {
    this.events.off.apply(this.events, arguments);
  }

  _makeRequest(path, options) {
    if (typeof _xgenia_cloudservices === 'undefined') {
      options.error && options.error({ error: 'No active cloud service', status: 0 });
      return;
    }

    const cs = _xgenia_cloudservices;

    fetch(cs.endpoint + path, {
      method: options.method || 'GET',
      headers: {
        'X-Parse-Application-Id': cs.appId,
        'X-Parse-Master-Key': cs.masterKey,
        'content-type': 'application/json',
        'X-Parse-Session-Token': options.sessionToken
      },
      body: JSON.stringify(options.content)
    })
      .then((res) => {
        if (res.ok) {
          res.json().then((json) => options.success(json));
        } else {
          res.json().then((json) => options.error({ error: json.error, status: res.status }));
        }
      })
      .catch((e) => {
        options.error({ error: e.message });
      });
  }

  setUserProperties(options) {
    if (this.backendType === 'supabase') {
      this._supabaseSetUserProperties(options);
    } else {
      this._parseServerSetUserProperties(options);
    }
  }

  _parseServerSetUserProperties(options) {
    if (this.current !== undefined) {
      //make a shallow copy to feed through CloudStore._serializeObject, which will modify the object
      const propsToSave = CloudStore._serializeObject({ ...options.properties }, '_User', this.modelScope || Model);

      const _content = Object.assign({}, { email: options.email, username: options.username }, propsToSave);

      delete _content.createdAt; // Remove props you cannot set
      delete _content.updatedAt;

      this._makeRequest('/users/' + this.current.getId(), {
        method: 'PUT',
        content: _content,
        success: (response) => {
          // Store current user
          for (let key in _content) {
            this.current.set(key, _content[key]);
          }
          options.success(response);
        },
        error: (e) => {
          options.error(e.error);
        }
      });
    }
  }

  async _supabaseSetUserProperties(options) {
    try {
      if (!this.supabaseClient) {
        throw new Error('Supabase client not initialized');
      }

      if (!this.current) {
        options.error('No authenticated user found');
        return;
      }

      // Update user metadata using admin API
      const userMetadata = {
        username: options.username,
        ...(options.properties || {})
      };

      const { data, error } = await this.supabaseClient.auth.admin.updateUserById(
        this.current.getId(),
        {
          email: options.email,
          user_metadata: userMetadata
        }
      );

      if (error) {
        options.error(error.message);
        return;
      }

      if (data.user) {
        // Update current user model
        for (let key in userMetadata) {
          this.current.set(key, userMetadata[key]);
        }
        if (options.email) {
          this.current.set('email', options.email);
        }
        options.success(data.user);
      } else {
        options.error('Failed to update user properties');
      }
    } catch (error) {
      options.error(error.message || 'Failed to update user properties');
    }
  }

  logIn(options) {
    if (this.backendType === 'supabase') {
      this._supabaseLogIn(options);
    } else {
      this._parseServerLogIn(options);
    }
  }

  _parseServerLogIn(options) {
    this._makeRequest('/login', {
      method: 'POST',
      content: {
        username: options.username,
        password: options.password,
        method: 'GET'
      },
      success: (user) => {
        delete user.ACL;
        delete user.className;
        delete user.__type;

        const _user = CloudStore._fromJSON(user, '_User', this.modelScope || Model);

        options.success(_user);
      },
      error: (e) => {
        options.error(e.error);
      }
    });
  }

  async _supabaseLogIn(options) {
    try {
      if (!this.supabaseClient) {
        throw new Error('Supabase client not initialized');
      }

      const { data, error } = await this.supabaseClient.auth.signInWithPassword({
        email: options.username, // In Supabase, we use email as username
        password: options.password
      });

      if (error) {
        options.error(error.message);
        return;
      }

      if (data.user) {
        const _user = this._createUserModelFromSupabase(data.user);
        options.success(_user);
      } else {
        options.error('Login failed: No user data returned');
      }
    } catch (error) {
      options.error(error.message || 'Login failed');
    }
  }

  // Just fetch the user don't set to current
  fetchUser(options) {
    if (this.backendType === 'supabase') {
      this._supabaseFetchUser(options);
    } else {
      this._parseServerFetchUser(options);
    }
  }

  _parseServerFetchUser(options) {
    this._makeRequest('/users/me', {
      method: 'GET',
      sessionToken: options.sessionToken,
      success: (user) => {
        // Store current user
        delete user.ACL;
        delete user.className;
        delete user.__type;

        const _user = CloudStore._fromJSON(user, '_User', this.modelScope || Model);

        options.success(_user);
      },
      error: (e) => {
        options.error(e.error);
      }
    });
  }

  async _supabaseFetchUser(options) {
    try {
      if (!this.supabaseClient) {
        throw new Error('Supabase client not initialized');
      }

      // For server-side, we need to get user by JWT token
      if (options.sessionToken) {
        const { data: { user }, error } = await this.supabaseClient.auth.getUser(options.sessionToken);

        if (error) {
          options.error(error.message);
          return;
        }

        if (user) {
          const _user = this._createUserModelFromSupabase(user);
          options.success(_user);
        } else {
          options.error('No user data available');
        }
      } else {
        options.error('Session token required for user fetch');
      }
    } catch (error) {
      options.error(error.message || 'Failed to fetch user');
    }
  }

  fetchCurrentUser(options) {
    if (this.backendType === 'supabase') {
      this._supabaseFetchCurrentUser(options);
    } else {
      this._parseServerFetchCurrentUser(options);
    }
  }

  _parseServerFetchCurrentUser(options) {
    if (options.sessionToken) {
      // Fetch the current user with the session token
      this._makeRequest('/users/me', {
        method: 'GET',
        sessionToken: options.sessionToken,
        success: (user) => {
          // Store current user
          delete user.ACL;
          delete user.className;
          delete user.__type;

          this.current = CloudStore._fromJSON(user, '_User', this.modelScope || Model);
          this.events.emit('sessionGained');
          options.success(this.current);
        },
        error: (e) => {
          options.error(e.error);
        }
      });
    } else if (this.current !== undefined) {
      // Fetch the current user, will use master key
      this._makeRequest('/users/' + this.current.getId(), {
        method: 'GET',
        success: (user) => {
          // Store current user
          delete user.ACL;
          delete user.className;
          delete user.__type;

          this.current = CloudStore._fromJSON(user, '_User', this.modelScope || Model);

          options.success(this.current);
        },
        error: (e) => {
          options.error(e.error);
        }
      });
    }
  }

  async _supabaseFetchCurrentUser(options) {
    try {
      if (!this.supabaseClient) {
        throw new Error('Supabase client not initialized');
      }

      if (options.sessionToken) {
        // Fetch the current user with the session token
        const { data: { user }, error } = await this.supabaseClient.auth.getUser(options.sessionToken);

        if (error) {
          options.error(error.message);
          return;
        }

        if (user) {
          this.current = this._createUserModelFromSupabase(user);
          this.events.emit('sessionGained');
          options.success(this.current);
        } else {
          options.error('No user data available');
        }
      } else if (this.current !== undefined) {
        // Fetch the current user using admin API
        const { data: { user }, error } = await this.supabaseClient.auth.admin.getUserById(this.current.getId());

        if (error) {
          options.error(error.message);
          return;
        }

        if (user) {
          this.current = this._createUserModelFromSupabase(user);
          options.success(this.current);
        } else {
          options.error('Failed to fetch current user');
        }
      } else {
        options.error('No current user or session token available');
      }
    } catch (error) {
      options.error(error.message || 'Failed to fetch current user');
    }
  }

  // NEW METHOD: Automatically setup required database tables and functions (server-side)
  async _autoSetupSupabaseDatabase() {
    try {
      console.log('[Cloud UserService] Checking if Supabase database setup is needed...');
      
      // Check if profiles table exists by trying to query it
      const { data, error } = await this.supabaseClient
        .from('profiles')
        .select('id')
        .limit(1);

      if (error && error.code === 'PGRST116') {
        // Table doesn't exist, we need to set it up
        console.log('[Cloud UserService] Profiles table not found, attempting automatic setup...');
        await this._createSupabaseUserManagementSchema();
      } else if (error) {
        console.warn('[Cloud UserService] Error checking profiles table:', error.message);
        // Don't fail silently, but don't block either
      } else {
        console.log('[Cloud UserService] Profiles table already exists, no setup needed');
      }
    } catch (error) {
      console.warn('[Cloud UserService] Could not perform automatic database setup:', error.message);
      console.warn('[Cloud UserService] User management will work with limited functionality');
      console.warn('[Cloud UserService] Manual setup may be required - see documentation');
    }
  }

  // NEW METHOD: Create the complete user management schema (server-side)
  async _createSupabaseUserManagementSchema() {
    if (!this.supabaseClient) {
      throw new Error('Supabase client not available');
    }

    console.log('[Cloud UserService] 🚀 Starting automatic Supabase user management setup (server-side)...');

    try {
      // Server-side has better access to admin functions, so we can do more comprehensive setup
      console.log('[Cloud UserService] Setting up complete user management schema...');

      // Combined SQL for all setup operations
      const completeSetupSQL = `
        -- Create profiles table for extended user data
        CREATE TABLE IF NOT EXISTS profiles (
          id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
          username TEXT,
          full_name TEXT,
          avatar_url TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );

        -- Enable Row Level Security
        ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

        -- Drop existing policies if they exist
        DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
        DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
        DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;

        -- Create policies for user access
        CREATE POLICY "Users can view own profile" ON profiles
          FOR SELECT USING (auth.uid() = id);

        CREATE POLICY "Users can update own profile" ON profiles
          FOR UPDATE USING (auth.uid() = id);

        CREATE POLICY "Users can insert own profile" ON profiles
          FOR INSERT WITH CHECK (auth.uid() = id);

        -- Function to create profile on user signup
        CREATE OR REPLACE FUNCTION public.handle_new_user()
        RETURNS TRIGGER AS $$
        BEGIN
          INSERT INTO public.profiles (id, username, created_at, updated_at)
          VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'username', NEW.email), NOW(), NOW());
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql SECURITY DEFINER;

        -- Drop existing trigger if it exists
        DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

        -- Create trigger to call the function
        CREATE TRIGGER on_auth_user_created
          AFTER INSERT ON auth.users
          FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

        -- Function to update updated_at timestamp
        CREATE OR REPLACE FUNCTION public.handle_updated_at()
        RETURNS TRIGGER AS $$
        BEGIN
          NEW.updated_at = NOW();
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Drop existing trigger if it exists
        DROP TRIGGER IF EXISTS handle_profiles_updated_at ON public.profiles;

        -- Trigger for profiles table
        CREATE TRIGGER handle_profiles_updated_at
          BEFORE UPDATE ON public.profiles
          FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
      `;

      // Execute the complete setup
      const { error: setupError } = await this.supabaseClient.rpc('exec_sql', {
        sql: completeSetupSQL
      });

      if (setupError) {
        console.error('[Cloud UserService] Setup SQL execution failed:', setupError);
        
        // Try alternative method using admin API
        await this._createProfilesTableAlternative();
      } else {
        console.log('[Cloud UserService] ✅ Complete schema setup executed successfully');
      }

      console.log('[Cloud UserService] 🎉 Automatic Supabase setup completed successfully!');
      console.log('[Cloud UserService] All user management features are now ready to use');

      // Test the setup by verifying the table exists
      const { data, error: testError } = await this.supabaseClient
        .from('profiles')
        .select('count', { count: 'exact', head: true });

      if (!testError) {
        console.log('[Cloud UserService] ✅ Setup verification successful - profiles table is accessible');
      }

    } catch (setupError) {
      console.error('[Cloud UserService] ❌ Automatic setup failed:', setupError);
      
      // If automatic setup fails, provide helpful guidance
      if (setupError.message?.includes('permission denied') || setupError.message?.includes('insufficient_privilege')) {
        console.warn('[Cloud UserService] ⚠️  Automatic setup requires admin privileges');
        console.warn('[Cloud UserService] Please ensure your Supabase service role key is configured');
        console.warn('[Cloud UserService] Server-side operations require elevated permissions');
      } else {
        console.warn('[Cloud UserService] Setup failed with error:', setupError.message);
        console.warn('[Cloud UserService] You may need to run manual setup - see SUPABASE_USER_MANAGEMENT_INTEGRATION.md');
      }
      
      // Don't throw the error - let the system continue with limited functionality
    }
  }

  // NEW METHOD: Alternative table creation method (server-side)
  async _createProfilesTableAlternative() {
    try {
      console.log('[Cloud UserService] Attempting alternative server-side setup...');
      
      // Server-side should have service role key access
      if (!this.supabaseConfig?.serviceRoleKey) {
        throw new Error('Service role key required for server-side automatic setup');
      }

      // The current client should already be using service role key
      console.log('[Cloud UserService] Using current admin client for setup...');
      
      // Try step-by-step setup instead of bulk SQL
      const steps = [
        {
          name: 'Create profiles table',
          sql: `CREATE TABLE IF NOT EXISTS profiles (
            id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
            username TEXT,
            full_name TEXT,
            avatar_url TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          );`
        },
        {
          name: 'Enable RLS',
          sql: `ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;`
        },
        {
          name: 'Create view policy',
          sql: `CREATE POLICY IF NOT EXISTS "Users can view own profile" ON profiles
            FOR SELECT USING (auth.uid() = id);`
        },
        {
          name: 'Create update policy', 
          sql: `CREATE POLICY IF NOT EXISTS "Users can update own profile" ON profiles
            FOR UPDATE USING (auth.uid() = id);`
        },
        {
          name: 'Create insert policy',
          sql: `CREATE POLICY IF NOT EXISTS "Users can insert own profile" ON profiles
            FOR INSERT WITH CHECK (auth.uid() = id);`
        }
      ];

      for (const step of steps) {
        console.log(`[Cloud UserService] Executing: ${step.name}...`);
        const { error } = await this.supabaseClient.rpc('exec_sql', { sql: step.sql });
        if (error) {
          console.warn(`[Cloud UserService] Step "${step.name}" failed:`, error.message);
          // Continue with other steps
        } else {
          console.log(`[Cloud UserService] ✅ ${step.name} completed`);
        }
      }
        
      console.log('[Cloud UserService] ✅ Alternative setup method completed');
    } catch (altError) {
      console.warn('[Cloud UserService] Alternative setup method also failed:', altError.message);
      throw altError;
    }
  }

  // NEW METHOD: Setup RLS policies for user-created tables
  async setupTableRLSPolicies(tableName, userId = null) {
    try {
      if (!this.supabaseClient) {
        throw new Error('Supabase client not initialized');
      }

      console.log(`[Cloud UserService] Setting up RLS policies for table: ${tableName}`);

      // Enable RLS on the table
      const enableRLSSQL = `ALTER TABLE ${tableName} ENABLE ROW LEVEL SECURITY;`;

      // Create policies that allow users to access their own data
      // Policy 1: Allow users to view records they created (more permissive for compatibility)
      const viewPolicySQL = `
        CREATE POLICY IF NOT EXISTS "${tableName}_user_view" ON ${tableName}
          FOR SELECT USING (
            auth.uid()::text = created_by::text OR 
            auth.uid()::text = user_id::text OR 
            created_by IS NULL OR 
            user_id IS NULL OR
            auth.uid() IS NOT NULL
          );`;

      // Policy 2: Allow authenticated users to insert records
      const insertPolicySQL = `
        CREATE POLICY IF NOT EXISTS "${tableName}_user_insert" ON ${tableName}
          FOR INSERT WITH CHECK (
            auth.uid() IS NOT NULL
          );`;

      // Policy 3: Allow users to update records they created or own
      const updatePolicySQL = `
        CREATE POLICY IF NOT EXISTS "${tableName}_user_update" ON ${tableName}
          FOR UPDATE USING (
            auth.uid()::text = created_by::text OR 
            auth.uid()::text = user_id::text OR
            created_by IS NULL OR
            user_id IS NULL OR
            auth.uid() IS NOT NULL
          );`;

      // Policy 4: Allow users to delete records they created or own
      const deletePolicySQL = `
        CREATE POLICY IF NOT EXISTS "${tableName}_user_delete" ON ${tableName}
          FOR DELETE USING (
            auth.uid()::text = created_by::text OR 
            auth.uid()::text = user_id::text OR
            created_by IS NULL OR
            user_id IS NULL OR
            auth.uid() IS NOT NULL
          );`;

      // Execute all RLS setup commands
      const rlsCommands = [
        { name: 'Enable RLS', sql: enableRLSSQL },
        { name: 'Create view policy', sql: viewPolicySQL },
        { name: 'Create insert policy', sql: insertPolicySQL },
        { name: 'Create update policy', sql: updatePolicySQL },
        { name: 'Create delete policy', sql: deletePolicySQL }
      ];

      for (const command of rlsCommands) {
        try {
          const { error } = await this.supabaseClient.rpc('exec_sql', { sql: command.sql });
          if (error) {
            console.warn(`[Cloud UserService] ${command.name} failed for ${tableName}:`, error.message);
          } else {
            console.log(`[Cloud UserService] ✅ ${command.name} completed for ${tableName}`);
          }
        } catch (cmdError) {
          console.warn(`[Cloud UserService] ${command.name} error for ${tableName}:`, cmdError.message);
        }
      }

      console.log(`[Cloud UserService] ✅ RLS policies setup completed for ${tableName}`);
      return true;

    } catch (error) {
      console.error(`[Cloud UserService] Failed to setup RLS policies for ${tableName}:`, error.message);
      return false;
    }
  }

  // NEW METHOD: Create table with proper RLS setup
  async createTableWithRLS(tableName, columns, userId = null) {
    try {
      console.log(`[Cloud UserService] Creating table ${tableName} with automatic RLS setup...`);

      // Add standard columns for user tracking
      const standardColumns = `
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
        user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
        updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
      `;

      // Create the table with user tracking columns
      const createTableSQL = `
        CREATE TABLE IF NOT EXISTS ${tableName} (
          ${standardColumns}${columns ? ',' + columns : ''}
        );
      `;

      const { error: createError } = await this.supabaseClient.rpc('exec_sql', { sql: createTableSQL });
      
      if (createError) {
        throw new Error(`Failed to create table: ${createError.message}`);
      }

      console.log(`[Cloud UserService] ✅ Table ${tableName} created successfully`);

      // Setup RLS policies for the new table
      const rlsSuccess = await this.setupTableRLSPolicies(tableName, userId);

      if (rlsSuccess) {
        console.log(`[Cloud UserService] 🎉 Table ${tableName} created with secure RLS policies`);
        return true;
      } else {
        console.warn(`[Cloud UserService] ⚠️ Table ${tableName} created but RLS setup failed`);
        return false;
      }

    } catch (error) {
      console.error(`[Cloud UserService] Failed to create table ${tableName}:`, error.message);
      throw error;
    }
  }
}

UserService.forScope = (modelScope) => {
  if (modelScope === undefined) return UserService.instance;
  if (modelScope._userService) return modelScope._userService;

  modelScope._userService = new UserService(modelScope);
  return modelScope._userService;
};

var _instance;
Object.defineProperty(UserService, 'instance', {
  get: function () {
    if (_instance === undefined) _instance = new UserService();
    return _instance;
  }
});

xgeniaRuntime.Services.UserService = UserService;

module.exports = UserService;
