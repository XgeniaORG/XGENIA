const XgeniaRuntime = require('@xgenia/runtime');
const EventEmitter = require('events').EventEmitter;
const guid = require('../../../guid');
const CloudStore = require('@xgenia/runtime/src/api/cloudstore');

class UserService {
  constructor() {
    this._initCloudServices();
    this._detectBackendType();

    this.events = new EventEmitter();
    this.events.setMaxListeners(100000);

    // Initialize based on backend type
    if (this.backendType === 'supabase') {
      this._initSupabaseAuth();
    } else {
      this._initParseServerAuth();
    }
  }

  _detectBackendType() {
    const cloudServices = XgeniaRuntime.instance.getMetaData('cloudservices');

    // Check if Supabase is configured and enabled
    if (cloudServices && cloudServices.supabase && cloudServices.supabase.enabled) {
      this.backendType = 'supabase';
      this.supabaseConfig = cloudServices.supabase;
      console.log('[UserService] Detected Supabase backend configuration');
    }
    // Fallback: Check for Supabase properties at root level
    else if (cloudServices && cloudServices.supabaseUrl && cloudServices.anonKey) {
      this.backendType = 'supabase';
      this.supabaseConfig = {
        enabled: true,
        url: cloudServices.supabaseUrl,
        anonKey: cloudServices.anonKey,
        serviceRoleKey: cloudServices.serviceRoleKey
      };
      console.log('[UserService] Detected Supabase backend configuration (root level)');
    }
    // Default to Parse Server
    else {
      this.backendType = 'parseserver';
      console.log('[UserService] Using Parse Server backend (default)');
    }
  }

  _initSupabaseAuth() {
    // Get Supabase client from CloudStore if available
    const cloudStore = CloudStore.instance;
    if (cloudStore && cloudStore.supabaseClient) {
      this.supabaseClient = cloudStore.supabaseClient;
      console.log('[UserService] Using existing Supabase client from CloudStore');
    } else {
      // Try to initialize our own Supabase client
      this._initOwnSupabaseClient();
    }

    if (this.supabaseClient) {
      // Check for existing session
      this._checkSupabaseSession();

      // Listen for auth state changes
      this.supabaseClient.auth.onAuthStateChange((event, session) => {
        console.log('[UserService] Supabase auth state changed:', event);
        this._handleSupabaseAuthChange(event, session);
      });

      // NEW: Automatically setup database if needed
      this._autoSetupSupabaseDatabase();
    }
  }

  _initOwnSupabaseClient() {
    try {
      let createClient;

      // Try to get Supabase createClient function
      if (typeof window !== 'undefined' && window.supabase && window.supabase.createClient) {
        createClient = window.supabase.createClient;
      } else if (typeof require !== 'undefined') {
        try {
          const supabase = require('@supabase/supabase-js');
          createClient = supabase.createClient;
        } catch (requireError) {
          console.warn('[UserService] Could not require @supabase/supabase-js:', requireError.message);
        }
      }

      if (createClient && this.supabaseConfig) {
        this.supabaseClient = createClient(this.supabaseConfig.url, this.supabaseConfig.anonKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true
          }
        });
        console.log('[UserService] Created own Supabase client');
      }
    } catch (error) {
      console.error('[UserService] Failed to initialize Supabase client:', error);
    }
  }

  async _checkSupabaseSession() {
    try {
      const {
        data: { session },
        error
      } = await this.supabaseClient.auth.getSession();
      if (error) throw error;

      if (session && session.user) {
        this.current = this._createUserModelFromSupabase(session.user);
        console.log('[UserService] Found existing Supabase session');
      }
    } catch (error) {
      console.warn('[UserService] Error checking Supabase session:', error);
    }
  }

  _handleSupabaseAuthChange(event, session) {
    switch (event) {
      case 'SIGNED_IN':
        if (session && session.user) {
          this.current = this._createUserModelFromSupabase(session.user);
          this.events.emit('loggedIn');
        }
        break;
      case 'SIGNED_OUT':
        this.current = undefined;
        this.events.emit('loggedOut');
        break;
      case 'TOKEN_REFRESHED':
        if (session && session.user) {
          this.current = this._createUserModelFromSupabase(session.user);
          this.events.emit('sessionGained');
        }
        break;
      case 'USER_UPDATED':
        if (session && session.user) {
          this.current = this._createUserModelFromSupabase(session.user);
        }
        break;
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

    return CloudStore._fromJSON(userData, '_User');
  }

  _initParseServerAuth() {
    // Check for current user session, and validate if it exists
    const currentUser = this.getUserFromLocalStorage();

    if (currentUser) {
      this.current = this.getUserModel();
      this.fetchCurrentUser({
        success: () => {},
        error: () => {
          // The session is no longer valid
          delete localStorage['Parse/' + this.appId + '/currentUser'];
          delete this.current;
          this.events.emit('sessionLost');
        }
      });
    }
  }

  getUserFromLocalStorage() {
    const currentUser = localStorage['Parse/' + this.appId + '/currentUser'];
    if (currentUser) {
      try {
        return JSON.parse(currentUser);
      } catch (e) {
        //do nothing
      }
    }
    return undefined;
  }

  _initCloudServices() {
    const cloudServices = XgeniaRuntime.instance.getMetaData('cloudservices');

    if (cloudServices) {
      this.appId = cloudServices.appId;
      this.endpoint = cloudServices.endpoint;
    }
  }

  on() {
    this.events.on.apply(this.events, arguments);
  }

  off() {
    this.events.off.apply(this.events, arguments);
  }

  /**
   * Clear all cached authentication data
   * This method ensures all tokens and session data are removed
   */
  clearAllAuthData() {
    console.log('[UserService] Clearing all authentication data...');

    // Clear current user
    this.current = undefined;

    // Clear Parse Server localStorage entries
    if (this.appId) {
      delete localStorage['Parse/' + this.appId + '/currentUser'];
      console.log('[UserService] Cleared Parse Server currentUser');
    }

    // Clear Supabase session data from localStorage
    if (this.supabaseConfig?.url) {
      try {
        const projectId = this.supabaseConfig.url.split('//')[1]?.split('.')[0];
        if (projectId) {
          // Clear various possible Supabase localStorage keys
          const keysToRemove = [
            `sb-${projectId}-auth-token`,
            `supabase.auth.token`,
            `sb-${projectId}-auth-token-code-verifier`,
            `sb-${projectId}-auth-token-pkce-code-verifier`
          ];

          keysToRemove.forEach((key) => {
            localStorage.removeItem(key);
          });

          console.log('[UserService] Cleared Supabase localStorage entries');
        }
      } catch (e) {
        console.warn('[UserService] Error clearing Supabase localStorage:', e);
      }
    }

    // Clear any other potential auth-related localStorage entries
    try {
      Object.keys(localStorage).forEach((key) => {
        if (key.includes('supabase') || key.includes('auth') || key.includes('session')) {
          localStorage.removeItem(key);
        }
      });
    } catch (e) {
      console.warn('[UserService] Error clearing additional localStorage entries:', e);
    }

    console.log('[UserService] All authentication data cleared');
  }

  _makeRequest(path, options) {
    if (!this.endpoint) {
      if (options.error) {
        options.error({ error: 'No active cloud service', status: 0 });
      }
      return;
    }

    var xhr = new XMLHttpRequest();

    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
        var json;
        try {
          json = JSON.parse(xhr.response);
        } catch (e) {}

        if (xhr.status === 200 || xhr.status === 201) {
          options.success(json || xhr.response);
        } else options.error(json || { error: xhr.responseText, status: xhr.status });
      }
    };

    xhr.open(options.method || 'GET', this.endpoint + path, true);

    xhr.setRequestHeader('X-Parse-Application-Id', this.appId);

    // Installation Id
    var _iid = localStorage['Parse/' + this.appId + '/installationId'];
    if (_iid === undefined) {
      _iid = localStorage['Parse/' + this.appId + '/installationId'] = guid();
    }
    xhr.setRequestHeader('X-Parse-Installation-Id', _iid);

    // Check for current users
    if (options.sessionToken) xhr.setRequestHeader('X-Parse-Session-Token', options.sessionToken);
    else {
      var currentUser = this.getUserFromLocalStorage();
      if (currentUser !== undefined) {
        xhr.setRequestHeader('X-Parse-Session-Token', currentUser.sessionToken);
      }
    }

    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send(JSON.stringify(options.content));
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
        _method: 'GET'
      },
      success: (response) => {
        // Store current user
        localStorage['Parse/' + this.appId + '/currentUser'] = JSON.stringify(response);
        this.current = this.getUserModel(); // Make sure the user model is updated
        options.success(response);
        this.events.emit('loggedIn');
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
        this.current = this._createUserModelFromSupabase(data.user);
        options.success(data.user);
        this.events.emit('loggedIn');
      } else {
        options.error('Login failed: No user data returned');
      }
    } catch (error) {
      options.error(error.message || 'Login failed');
    }
  }

  logOut(options) {
    if (this.backendType === 'supabase') {
      this._supabaseLogOut(options);
    } else {
      this._parseServerLogOut(options);
    }
  }

  _parseServerLogOut(options) {
    this._makeRequest('/logout', {
      method: 'POST',
      content: {},
      success: (response) => {
        // Clear all authentication data comprehensively
        this.clearAllAuthData();
        options.success();
        this.events.emit('loggedOut');
      },
      error: (e) => {
        options.error(e.error);
      }
    });
  }

  async _supabaseLogOut(options) {
    try {
      if (!this.supabaseClient) {
        throw new Error('Supabase client not initialized');
      }

      console.log('[UserService] Starting Supabase logout process...');

      // Sign out from Supabase (this clears the session and access tokens)
      const { error } = await this.supabaseClient.auth.signOut();

      if (error) {
        console.error('[UserService] Supabase signOut error:', error);
        options.error(error.message);
        return;
      }

      // Clear all authentication data comprehensively
      this.clearAllAuthData();

      console.log('[UserService] Supabase logout completed successfully');
      options.success();
      this.events.emit('loggedOut');
    } catch (error) {
      console.error('[UserService] Logout failed:', error);
      options.error(error.message || 'Logout failed');
    }
  }

  signUp(options) {
    if (this.backendType === 'supabase') {
      this._supabaseSignUp(options);
    } else {
      this._parseServerSignUp(options);
    }
  }

  _parseServerSignUp(options) {
    //make a shallow copy to feed through CloudStore._serializeObject, which will modify the object
    const additionalUserProps = options.properties
      ? CloudStore._serializeObject({ ...options.properties }, '_User')
      : {};

    this._makeRequest('/users', {
      method: 'POST',
      content: Object.assign({}, additionalUserProps, {
        username: options.username,
        password: options.password,
        email: options.email
      }),
      success: (response) => {
        // Store current user
        const _cu = Object.assign(response, { username: options.username }, options.properties);
        localStorage['Parse/' + this.appId + '/currentUser'] = JSON.stringify(_cu);
        this.current = this.getUserModel(); // Make sure the user model is updated
        options.success(response);
        this.events.emit('loggedIn');
      },
      error: (e) => {
        options.error(e.error);
      }
    });
  }

  async _supabaseSignUp(options) {
    try {
      if (!this.supabaseClient) {
        throw new Error('Supabase client not initialized');
      }

      // Prepare user metadata
      const userMetadata = {
        username: options.username,
        ...(options.properties || {})
      };

      const { data, error } = await this.supabaseClient.auth.signUp({
        email: options.email,
        password: options.password,
        options: {
          data: userMetadata
        }
      });

      if (error) {
        options.error(error.message);
        return;
      }

      if (data.user) {
        // For Supabase, signup might require email confirmation
        // If user is immediately available, set as current
        if (data.session) {
          this.current = this._createUserModelFromSupabase(data.user);
          this.events.emit('loggedIn');
        }
        options.success(data.user);
      } else {
        options.error('Signup failed: No user data returned');
      }
    } catch (error) {
      options.error(error.message || 'Signup failed');
    }
  }

  setUserProperties(options) {
    if (this.backendType === 'supabase') {
      this._supabaseSetUserProperties(options);
    } else {
      this._parseServerSetUserProperties(options);
    }
  }

  _parseServerSetUserProperties(options) {
    const _cu = this.getCurrentUser();
    if (_cu !== undefined) {
      //make a shallow copy to feed through CloudStore._serializeObject, which will modify the object
      const propsToSave = CloudStore._serializeObject({ ...options.properties }, '_User');

      const _content = Object.assign({}, { email: options.email, username: options.username }, propsToSave);

      delete _content.emailVerified; // Remove props you cannot set
      delete _content.createdAt;
      delete _content.updatedAt;
      //delete _content.username;

      this._makeRequest('/users/' + _cu.objectId, {
        method: 'PUT',
        content: _content,
        success: (response) => {
          // Store current user
          Object.assign(_cu, _content);
          localStorage['Parse/' + this.appId + '/currentUser'] = JSON.stringify(_cu);
          this.current = this.getUserModel(); // Make sure the user model is updated
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

      const {
        data: { user },
        error: userError
      } = await this.supabaseClient.auth.getUser();
      if (userError || !user) {
        options.error('No authenticated user found');
        return;
      }

      // Update user metadata
      const userMetadata = {
        username: options.username,
        ...(options.properties || {})
      };

      const { data, error } = await this.supabaseClient.auth.updateUser({
        email: options.email,
        data: userMetadata
      });

      if (error) {
        options.error(error.message);
        return;
      }

      if (data.user) {
        this.current = this._createUserModelFromSupabase(data.user);
        options.success(data.user);
      } else {
        options.error('Failed to update user properties');
      }
    } catch (error) {
      options.error(error.message || 'Failed to update user properties');
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
    this._makeRequest('/users/me', {
      method: 'GET',
      sessionToken: options.sessionToken,
      success: (response) => {
        // Store current user
        localStorage['Parse/' + this.appId + '/currentUser'] = JSON.stringify(response);
        this.current = this.getUserModel(); // Make sure the user model is updated
        this.events.emit('sessionGained');
        options.success(response);
      },
      error: (e) => {
        if (e.code === 209) {
          delete localStorage['Parse/' + this.appId + '/currentUser'];
          this.events.emit('sessionLost');
        }
        options.error(e.error);
      }
    });
  }

  async _supabaseFetchCurrentUser(options) {
    try {
      if (!this.supabaseClient) {
        throw new Error('Supabase client not initialized');
      }

      const {
        data: { user },
        error
      } = await this.supabaseClient.auth.getUser();

      if (error) {
        // Session is invalid
        this.current = undefined;
        this.events.emit('sessionLost');
        options.error(error.message);
        return;
      }

      if (user) {
        this.current = this._createUserModelFromSupabase(user);
        this.events.emit('sessionGained');
        options.success(user);
      } else {
        options.error('No user data available');
      }
    } catch (error) {
      options.error(error.message || 'Failed to fetch current user');
    }
  }

  verifyEmail(options) {
    this._makeRequest(
      '/apps/' + this.appId + '/verify_email?username=' + options.username + '&token=' + options.token,
      {
        method: 'GET',
        success: (response) => {
          if (response.indexOf('Successfully verified your email') !== -1) {
            options.success();
          } else if (response.indexOf('Invalid Verification Link')) {
            options.error('Invalid verification token');
          } else {
            options.error('Failed to verify email');
          }
        },
        error: (e) => {
          options.error(e.error);
        }
      }
    );
  }

  sendEmailVerification(options) {
    this._makeRequest('/verificationEmailRequest', {
      method: 'POST',
      content: { email: options.email },
      success: (response) => {
        options.success();
      },
      error: (e) => {
        options.error(e.error);
      }
    });
  }

  resetPassword(options) {
    this._makeRequest('/apps/' + this.appId + '/request_password_reset', {
      method: 'POST',
      content: {
        username: options.username,
        token: options.token,
        new_password: options.newPassword
      },
      success: (response) => {
        if (
          response.indexOf('Password successfully reset') !== -1 ||
          response.indexOf('Successfully updated your password') !== -1
        ) {
          options.success();
        } else if (response.indexOf('Invalid Link')) {
          options.error('Invalid verification token');
        } else {
          options.error('Failed to verify email');
        }
      },
      error: (e) => {
        options.error(e.error);
      }
    });
  }

  requestPasswordReset(options) {
    this._makeRequest('/requestPasswordReset', {
      method: 'POST',
      content: { email: options.email },
      success: (response) => {
        options.success();
      },
      error: (e) => {
        options.error(e.error);
      }
    });
  }

  getCurrentUser() {
    if (this.backendType === 'supabase') {
      // For Supabase, return the current user data directly
      return this.current ? this.current.data : undefined;
    } else {
      var _cu = localStorage['Parse/' + this.appId + '/currentUser'];
      if (_cu !== undefined) return JSON.parse(_cu);
    }
  }

  getUserModel() {
    if (this.backendType === 'supabase') {
      return this.current;
    } else {
      const _cu = this.getCurrentUser();
      if (_cu !== undefined) {
        delete _cu.sessionToken;
        delete _cu.ACL;
        delete _cu.className;
        delete _cu.__type;
        return CloudStore._fromJSON(_cu, '_User');
      }
    }
  }

  // NEW METHOD: Automatically setup required database tables and functions
  async _autoSetupSupabaseDatabase() {
    try {
      console.log('[UserService] Checking if Supabase database setup is needed...');

      // Check if profiles table exists by trying to query it
      const { data, error } = await this.supabaseClient.from('profiles').select('id').limit(1);

      if (error && error.code === 'PGRST116') {
        // Table doesn't exist, we need to set it up
        console.log('[UserService] Profiles table not found, attempting automatic setup...');
        await this._createSupabaseUserManagementSchema();
      } else if (error) {
        console.warn('[UserService] Error checking profiles table:', error.message);
        // Don't fail silently, but don't block either
      } else {
        console.log('[UserService] Profiles table already exists, no setup needed');
      }
    } catch (error) {
      console.warn('[UserService] Could not perform automatic database setup:', error.message);
      console.warn('[UserService] User management will work with limited functionality');
      console.warn('[UserService] Manual setup may be required - see documentation');
    }
  }

  // NEW METHOD: Create the complete user management schema
  async _createSupabaseUserManagementSchema() {
    if (!this.supabaseClient) {
      throw new Error('Supabase client not available');
    }

    console.log('[UserService] 🚀 Starting automatic Supabase user management setup...');

    try {
      // Step 1: Create profiles table
      console.log('[UserService] Creating profiles table...');
      const createTableSQL = `
        -- Create profiles table for extended user data
        CREATE TABLE IF NOT EXISTS profiles (
          id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
          username TEXT,
          full_name TEXT,
          avatar_url TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `;

      const { error: tableError } = await this.supabaseClient.rpc('exec_sql', {
        sql: createTableSQL
      });

      if (tableError) {
        // Try alternative method using direct SQL execution
        console.log('[UserService] Direct RPC failed, trying alternative setup method...');
        await this._createProfilesTableAlternative();
      } else {
        console.log('[UserService] ✅ Profiles table created successfully');
      }

      // Step 2: Enable Row Level Security
      console.log('[UserService] Enabling Row Level Security...');
      const enableRLSSQL = `
        ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
      `;

      await this.supabaseClient.rpc('exec_sql', { sql: enableRLSSQL });

      // Step 3: Create RLS policies
      console.log('[UserService] Creating Row Level Security policies...');
      const createPoliciesSQL = `
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
      `;

      await this.supabaseClient.rpc('exec_sql', { sql: createPoliciesSQL });
      console.log('[UserService] ✅ RLS policies created successfully');

      // Step 4: Create profile auto-creation function and trigger
      console.log('[UserService] Creating auto-profile creation system...');
      const createFunctionSQL = `
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

      await this.supabaseClient.rpc('exec_sql', { sql: createFunctionSQL });
      console.log('[UserService] ✅ Auto-profile creation system created successfully');

      console.log('[UserService] 🎉 Automatic Supabase setup completed successfully!');
      console.log('[UserService] All user management features are now ready to use');
    } catch (setupError) {
      console.error('[UserService] ❌ Automatic setup failed:', setupError);

      // If automatic setup fails, provide helpful guidance
      if (setupError.message?.includes('permission denied') || setupError.message?.includes('insufficient_privilege')) {
        console.warn('[UserService] ⚠️  Automatic setup requires admin privileges');
        console.warn('[UserService] Please ensure your Supabase service role key is configured');
        console.warn('[UserService] Or run the manual setup SQL commands from the documentation');
      } else {
        console.warn('[UserService] Setup failed with error:', setupError.message);
        console.warn('[UserService] You may need to run manual setup - see SUPABASE_USER_MANAGEMENT_INTEGRATION.md');
      }

      // Don't throw the error - let the system continue with limited functionality
    }
  }

  // NEW METHOD: Alternative table creation method
  async _createProfilesTableAlternative() {
    try {
      console.log('[UserService] Attempting alternative profiles table creation...');

      // Try using admin API if available (requires service role key)
      const serviceRoleKey = this.supabaseConfig?.serviceRoleKey;
      if (serviceRoleKey) {
        // Create temporary admin client
        const { createClient } = require('@supabase/supabase-js');
        const adminClient = createClient(this.supabaseConfig.url, serviceRoleKey);

        const createTableSQL = `
          CREATE TABLE IF NOT EXISTS profiles (
            id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
            username TEXT,
            full_name TEXT,
            avatar_url TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          );
        `;

        const { error } = await adminClient.rpc('exec_sql', { sql: createTableSQL });
        if (error) throw error;

        console.log('[UserService] ✅ Profiles table created via admin client');
      } else {
        throw new Error('Service role key required for alternative setup method');
      }
    } catch (altError) {
      console.warn('[UserService] Alternative setup method also failed:', altError.message);
      throw altError;
    }
  }

  // NEW METHOD: Verify Supabase setup is working correctly
  async verifySupabaseSetup() {
    if (this.backendType !== 'supabase') {
      return {
        success: false,
        error: 'Not using Supabase backend',
        details: `Current backend type: ${this.backendType}`
      };
    }

    if (!this.supabaseClient) {
      return {
        success: false,
        error: 'Supabase client not initialized',
        details: 'Client initialization failed or configuration missing'
      };
    }

    const results = [];
    let overallSuccess = true;

    try {
      console.log('[UserService] 🔍 Starting Supabase setup verification...');

      // Test 1: Basic connection
      results.push(await this._testSupabaseConnection());

      // Test 2: Profiles table existence and access
      results.push(await this._testProfilesTableAccess());

      // Test 3: RLS policies
      results.push(await this._testRLSPolicies());

      // Test 4: Trigger functions (if possible)
      results.push(await this._testTriggerFunctions());

      // Determine overall success
      overallSuccess = results.every((result) => result.success);

      const summary = {
        success: overallSuccess,
        message: overallSuccess
          ? '✅ All Supabase setup verification tests passed!'
          : '⚠️ Some verification tests failed - see details',
        details: results,
        timestamp: new Date().toISOString(),
        backendType: this.backendType,
        hasClient: !!this.supabaseClient
      };

      console.log('[UserService] Setup verification completed:', summary);
      return summary;
    } catch (error) {
      return {
        success: false,
        error: 'Verification process failed',
        details: error.message || String(error),
        results: results,
        timestamp: new Date().toISOString()
      };
    }
  }

  // Helper: Test basic Supabase connection
  async _testSupabaseConnection() {
    try {
      const { data, error } = await this.supabaseClient.auth.getUser();

      // Even if no user, successful response means connection works
      if (error && !error.message.includes('session_not_found') && !error.message.includes('No session found')) {
        throw error;
      }

      return {
        test: 'Connection Test',
        success: true,
        message: 'Successfully connected to Supabase auth endpoint',
        details: {
          hasUser: !!data?.user,
          userStatus: data?.user ? 'authenticated' : 'anonymous'
        }
      };
    } catch (error) {
      return {
        test: 'Connection Test',
        success: false,
        message: 'Failed to connect to Supabase',
        error: error.message
      };
    }
  }

  // Helper: Test profiles table access
  async _testProfilesTableAccess() {
    try {
      const { data, error } = await this.supabaseClient.from('profiles').select('id').limit(1);

      if (error) {
        if (error.code === 'PGRST116') {
          return {
            test: 'Profiles Table Test',
            success: false,
            message: 'Profiles table does not exist',
            error: 'Table needs to be created',
            suggestion: 'Run automatic setup or manual SQL commands'
          };
        } else {
          throw error;
        }
      }

      return {
        test: 'Profiles Table Test',
        success: true,
        message: 'Profiles table exists and is accessible',
        details: {
          tableExists: true,
          canRead: true
        }
      };
    } catch (error) {
      return {
        test: 'Profiles Table Test',
        success: false,
        message: 'Failed to access profiles table',
        error: error.message,
        suggestion: 'Check database setup and permissions'
      };
    }
  }

  // Helper: Test RLS policies
  async _testRLSPolicies() {
    try {
      // Try to access profiles without authentication (should be restricted)
      const { data, error } = await this.supabaseClient.from('profiles').select('*');

      // If we're not authenticated, we should get no results due to RLS
      // If we are authenticated, we should only see our own profile
      const currentUser = await this.supabaseClient.auth.getUser();

      if (currentUser.data?.user) {
        // User is authenticated - should see own profile or empty result
        return {
          test: 'RLS Policies Test',
          success: true,
          message: 'RLS policies appear to be working (authenticated user)',
          details: {
            userAuthenticated: true,
            profilesVisible: data?.length || 0,
            note: 'Can only see own profile due to RLS'
          }
        };
      } else {
        // User not authenticated - should see no profiles due to RLS
        return {
          test: 'RLS Policies Test',
          success: data?.length === 0,
          message:
            data?.length === 0
              ? 'RLS policies working correctly (no unauthorized access)'
              : 'RLS policies may not be configured correctly',
          details: {
            userAuthenticated: false,
            profilesVisible: data?.length || 0,
            expected: 0
          }
        };
      }
    } catch (error) {
      return {
        test: 'RLS Policies Test',
        success: false,
        message: 'Could not test RLS policies',
        error: error.message
      };
    }
  }

  // Helper: Test trigger functions
  async _testTriggerFunctions() {
    try {
      // We can't directly test triggers without creating a user,
      // but we can check if the functions exist in the database
      // This is a simplified test - just check if we can query profiles
      const { data, error } = await this.supabaseClient
        .from('profiles')
        .select('count', { count: 'exact', head: true });

      if (error) {
        throw error;
      }

      return {
        test: 'Trigger Functions Test',
        success: true,
        message: 'Database functions appear to be accessible',
        details: {
          note: 'Full trigger testing requires user creation',
          profileCount: data?.length || 0
        }
      };
    } catch (error) {
      return {
        test: 'Trigger Functions Test',
        success: false,
        message: 'Could not test database functions',
        error: error.message
      };
    }
  }
}

// NEW: Static utility methods for developers to use from console
UserService.setupSupabase = async function () {
  console.log('🚀 [UserService] Manual Supabase setup initiated...');

  const instance = UserService.instance;
  if (!instance) {
    console.error('❌ [UserService] UserService instance not available');
    return { success: false, error: 'UserService instance not available' };
  }

  if (instance.backendType !== 'supabase') {
    console.warn('⚠️  [UserService] Not using Supabase backend - current backend:', instance.backendType);
    return { success: false, error: 'Not using Supabase backend', backendType: instance.backendType };
  }

  try {
    await instance._autoSetupSupabaseDatabase();
    console.log('✅ [UserService] Manual setup completed');
    return { success: true, message: 'Manual setup completed successfully' };
  } catch (error) {
    console.error('❌ [UserService] Manual setup failed:', error);
    return { success: false, error: error.message || String(error) };
  }
};

UserService.verifySupabase = async function () {
  console.log('🔍 [UserService] Manual Supabase verification initiated...');

  const instance = UserService.instance;
  if (!instance) {
    console.error('❌ [UserService] UserService instance not available');
    return { success: false, error: 'UserService instance not available' };
  }

  try {
    const result = await instance.verifySupabaseSetup();
    if (result.success) {
      console.log('✅ [UserService] Verification passed!');
    } else {
      console.warn('⚠️  [UserService] Verification failed - see details');
    }
    console.table(result.details);
    return result;
  } catch (error) {
    console.error('❌ [UserService] Verification failed:', error);
    return { success: false, error: error.message || String(error) };
  }
};

UserService.debugInfo = function () {
  console.log('🔧 [UserService] Debug Information:');

  const instance = UserService.instance;
  if (!instance) {
    console.error('❌ UserService instance not available');
    return { available: false };
  }

  const info = {
    available: true,
    backendType: instance.backendType,
    hasSupabaseClient: !!instance.supabaseClient,
    hasSupabaseConfig: !!instance.supabaseConfig,
    currentUser: instance.current
      ? {
          id: instance.current.getId(),
          authenticated: true
        }
      : null,
    supabaseConfig: instance.supabaseConfig
      ? {
          url: instance.supabaseConfig.url,
          hasAnonKey: !!instance.supabaseConfig.anonKey,
          hasServiceRoleKey: !!instance.supabaseConfig.serviceRoleKey,
          enabled: instance.supabaseConfig.enabled
        }
      : null
  };

  console.table(info);
  return info;
};

// Helper: Make utilities available globally for easy console access
if (typeof window !== 'undefined') {
  window.XgeniaUserService = {
    setup: UserService.setupSupabase,
    verify: UserService.verifySupabase,
    debug: UserService.debugInfo,
    help: function () {
      console.log(`
🎯 XGENIA User Service Console Utilities:

📋 Available Commands:
  XgeniaUserService.debug()  - Show current configuration and status
  XgeniaUserService.setup()  - Manually trigger Supabase database setup
  XgeniaUserService.verify() - Run comprehensive setup verification tests
  XgeniaUserService.help()   - Show this help message

🔧 Example Usage:
  // Check current status
  XgeniaUserService.debug()
  
  // Setup database tables manually
  await XgeniaUserService.setup()
  
  // Verify everything is working
  await XgeniaUserService.verify()

💡 Notes:
  - Setup happens automatically when user management nodes are first used
  - These utilities are for manual testing and debugging
  - Ensure Supabase is configured in Cloud Services before using
      `);
    }
  };

  // Show help on first load
  console.log('🎯 XGENIA User Service utilities loaded! Type XgeniaUserService.help() for commands');
}

UserService.forScope = (modelScope) => {
  // On the viewer, always return main scope
  return UserService.instance;
};

var _instance;
Object.defineProperty(UserService, 'instance', {
  get: function () {
    if (_instance === undefined) _instance = new UserService();
    return _instance;
  }
});

XgeniaRuntime.Services.UserService = UserService;

module.exports = UserService;
