import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://pcrghrjikkcmelflwiys.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjcmdocmppa2tjbWVsZmx3aXlzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDUzNTU3OTAsImV4cCI6MjA2MDkzMTc5MH0.wxwJQqyTZATJmaJPDX3TuaNaJ5hxMFFk7RgzHeq4Bt0';

// Initialize the Supabase client with standard configuration for better compatibility
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true
    // Remove custom storage configuration to use default Supabase behavior
  },
  global: {
    headers: {
      'X-Client-Info': 'xgenia-editor'
    }
  }
});

// Verify client initialization
// console.log('[SupabaseInit] Client initialized:', {
//   hasClient: !!supabase,
//   hasAuth: !!supabase.auth,
//   url: supabaseUrl,
//   storageAvailable: typeof window !== 'undefined' && !!window.localStorage
// });

// Helper function to get current user
export const getCurrentUser = () => {
  return supabase.auth.getUser();
};

// Helper function to sign in
export const signInWithEmail = (email: string, password: string) => {
  return supabase.auth.signInWithPassword({
    email,
    password
  });
};

// Helper function to sign out
export const signOut = () => {
  return supabase.auth.signOut();
};

// Helper function to sign in with OAuth
export const signInWithOAuth = (provider: 'google' | 'github' | 'discord' | 'azure' | 'facebook') => {
  return supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${window.location.origin}/auth/callback`
    }
  });
};

// Helper to send password reset email
export const resetPasswordForEmail = (email: string) => {
  return supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/auth/callback`,
  });
};

// Helper function to sign in with XGENIA (OAuth2)
export const signInWithXgenia = () => {
  // XGENIA OAuth configuration - This would need to be set up in Supabase
  return supabase.auth.signInWithOAuth({
    provider: 'google', // Placeholder - would be 'xgenia' if custom provider is set up
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
      queryParams: {
        // Custom params for XGENIA if needed
        provider_hint: 'xgenia'
      }
    }
  });
};

// Helper function to listen to auth changes
export const onAuthStateChange = (callback: (event: string, session: any) => void) => {
  return supabase.auth.onAuthStateChange(callback);
}; 