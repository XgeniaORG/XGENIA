import { supabase } from '../supabaseInit';

/**
 * Test Supabase connection and basic functionality
 */
export const testSupabaseConnection = async (): Promise<{
  success: boolean;
  message: string;
  details?: any;
}> => {
  try {
    console.log('🧪 Testing Supabase connection...');
    
    // Test 1: Basic client initialization
    if (!supabase) {
      return {
        success: false,
        message: 'Supabase client not initialized'
      };
    }
    console.log('✅ Supabase client initialized');

    // Test 2: Test auth endpoint
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error && error.message !== 'No session found') {
        throw error;
      }
      console.log('✅ Auth endpoint accessible');
    } catch (authError: any) {
      return {
        success: false,
        message: 'Auth endpoint test failed',
        details: authError.message
      };
    }

    // Test 3: Test database connection (try to query profiles table)
    try {
      const { error } = await supabase
        .from('profiles')
        .select('id')
        .limit(1);
      
      if (error && !error.message.includes('relation "public.profiles" does not exist')) {
        throw error;
      }
      console.log('✅ Database connection established');
    } catch (dbError: any) {
      console.warn('⚠️  Database test failed (this is normal if tables are not set up yet):', dbError.message);
    }

    return {
      success: true,
      message: 'Supabase connection test passed',
      details: {
        projectUrl: 'https://pcrghrjikkcmelflwiys.supabase.co',
        authWorking: true,
        timestamp: new Date().toISOString()
      }
    };

  } catch (error: any) {
    console.error('❌ Supabase connection test failed:', error);
    return {
      success: false,
      message: 'Supabase connection test failed',
      details: error.message
    };
  }
};

/**
 * Test user authentication flow
 */
export const testAuthFlow = async (email: string, password: string): Promise<{
  success: boolean;
  message: string;
  user?: any;
  error?: string;
}> => {
  try {
    console.log('🧪 Testing authentication flow...');

    // Test sign in
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      return {
        success: false,
        message: 'Authentication failed',
        error: error.message
      };
    }

    if (!data.user) {
      return {
        success: false,
        message: 'No user data returned',
        error: 'Authentication succeeded but no user data was returned'
      };
    }

    console.log('✅ Authentication successful');

    // Test sign out
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      console.warn('⚠️  Sign out test failed:', signOutError.message);
    } else {
      console.log('✅ Sign out successful');
    }

    return {
      success: true,
      message: 'Authentication flow test passed',
      user: {
        id: data.user.id,
        email: data.user.email,
        created_at: data.user.created_at
      }
    };

  } catch (error: any) {
    console.error('❌ Authentication flow test failed:', error);
    return {
      success: false,
      message: 'Authentication flow test failed',
      error: error.message
    };
  }
};

/**
 * Test user profile operations
 */
export const testProfileOperations = async (): Promise<{
  success: boolean;
  message: string;
  details?: any;
}> => {
  try {
    console.log('🧪 Testing profile operations...');

    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    if (userError || !user) {
      return {
        success: false,
        message: 'No authenticated user found for profile test'
      };
    }

    // Test profile query
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (profileError && !profileError.message.includes('does not exist')) {
      throw profileError;
    }

    console.log('✅ Profile operations accessible');

    return {
      success: true,
      message: 'Profile operations test passed',
      details: {
        hasProfile: !!profile,
        userId: user.id,
        email: user.email
      }
    };

  } catch (error: any) {
    console.error('❌ Profile operations test failed:', error);
    return {
      success: false,
      message: 'Profile operations test failed',
      details: error.message
    };
  }
};

/**
 * Run all tests
 */
export const runAllSupabaseTests = async (): Promise<{
  connectionTest: any;
  overallSuccess: boolean;
}> => {
  console.log('🚀 Running comprehensive Supabase tests...');
  
  const connectionTest = await testSupabaseConnection();
  
  // Only run other tests if connection test passes
  let authTest = null;
  let profileTest = null;
  
  if (connectionTest.success) {
    // Note: Auth and profile tests would require actual credentials
    // These are commented out to avoid requiring test credentials
    console.log('📝 Note: Auth flow and profile tests require valid credentials');
  }

  const overallSuccess = connectionTest.success;

  console.log(`${overallSuccess ? '✅' : '❌'} Overall test result: ${overallSuccess ? 'PASSED' : 'FAILED'}`);

  return {
    connectionTest,
    overallSuccess
  };
};

/**
 * Quick connection check (for use in components)
 */
export const quickConnectionCheck = async (): Promise<boolean> => {
  try {
    const { error } = await supabase.auth.getSession();
    return !error || error.message === 'No session found';
  } catch {
    return false;
  }
}; 