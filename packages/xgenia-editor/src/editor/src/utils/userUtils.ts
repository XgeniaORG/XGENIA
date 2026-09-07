import { supabase } from '../supabaseInit';
import type { User } from '@supabase/supabase-js';
import type { UserProfile } from '../types/auth';

/**
 * Get the current authenticated user
 */
export const getCurrentUser = async (): Promise<User | null> => {
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) {
      console.error('Error getting current user:', error);
      return null;
    }
    return user;
  } catch (error: any) {
    console.error('Unexpected error getting user:', error);
    return null;
  }
};

/**
 * Get user profile from the profiles table
 */
export const getUserProfile = async (userId: string): Promise<UserProfile | null> => {
  try {
    // maybeSingle, not single (2026-08-29). `.single()` asks PostgREST for
    // exactly one row via `Accept: application/vnd.pgrst.object+json`, and
    // PostgREST answers 406 Not Acceptable for any other count — including
    // zero. Zero is what you get when the access token is rejected, because
    // RLS then evaluates auth.uid() as null and the row is simply invisible.
    // A packaged install showed this exactly: `/auth/v1/user` 403, then two
    // `profiles?select=*` 406s. `.maybeSingle()` returns data:null with no
    // error for zero rows, so "no profile" stops arriving as a transport
    // error and a real failure stays visible.
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.error('Error getting user profile:', error);
      return null;
    }

    if (!data) {
      // No row, and the query itself succeeded. Either the profile has not
      // been created yet or RLS is hiding it — both are ordinary, neither is
      // worth an error-level log.
      console.debug('[userUtils] No profile row visible for', userId);
      return null;
    }

    return data;
  } catch (error: any) {
    console.error('Unexpected error getting user profile:', error);
    return null;
  }
};

/**
 * Update user profile
 */
export const updateUserProfile = async (
  userId: string,
  updates: Partial<UserProfile>
): Promise<UserProfile | null> => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      console.error('Error updating user profile:', error);
      return null;
    }

    return data;
  } catch (error: any) {
    console.error('Unexpected error updating user profile:', error);
    return null;
  }
};

/**
 * Create user profile (called after user registration)
 */
export const createUserProfile = async (
  userId: string,
  email: string,
  additionalData?: Partial<UserProfile>
): Promise<UserProfile | null> => {
  try {
    const profileData = {
      id: userId,
      email,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...additionalData,
    };

    const { data, error } = await supabase
      .from('profiles')
      .insert(profileData)
      .select()
      .single();

    if (error) {
      console.error('Error creating user profile:', error);
      return null;
    }

    return data;
  } catch (error: any) {
    console.error('Unexpected error creating user profile:', error);
    return null;
  }
};

/**
 * Check if user has a profile
 */
export const userHasProfile = async (userId: string): Promise<boolean> => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .maybeSingle();

    // An existence check must not report "does not exist" when what actually
    // happened is "could not ask". Those were the same answer here — `.single()`
    // made a missing row an error, and the error and the missing row both
    // returned false. That is the shape of a user being silently treated as new:
    // a rejected token hides the row, this says "no profile", and everything
    // downstream provisions a free account over a paid one.
    if (error) throw error;

    return !!data;
  } catch (error: any) {
    // Deliberately rethrown rather than answered `false`. Returning false here
    // would mean "this user has no profile", which is a claim this function is
    // in no position to make when the query failed. Callers must decide what an
    // unknown means for them; provisioning a fresh free profile off the back of
    // a network error is how a paid account silently becomes a free one.
    console.error('Error checking user profile — UNKNOWN, not absent:', error);
    throw error;
  }
};

/**
 * Sign up a new user and create their profile
 */
export const signUpUser = async (
  email: string,
  password: string,
  additionalData?: Partial<UserProfile>
): Promise<{ user: User | null; error: string | null }> => {
  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      return { user: null, error: error.message };
    }

    if (data.user) {
      // Create user profile
      await createUserProfile(data.user.id, email, additionalData);
    }

    return { user: data.user, error: null };
  } catch (error: any) {
    console.error('Unexpected error during sign up:', error);
    return { user: null, error: error.message || 'Sign up failed' };
  }
};

/**
 * Delete user account and profile
 */
export const deleteUserAccount = async (userId: string): Promise<{ success: boolean; error?: string }> => {
  try {
    // First delete the profile
    const { error: profileError } = await supabase
      .from('profiles')
      .delete()
      .eq('id', userId);

    if (profileError) {
      console.error('Error deleting user profile:', profileError);
      return { success: false, error: profileError.message };
    }

    // Note: Deleting the auth user requires admin privileges
    // This would typically be done via a server-side function
    console.warn('User auth deletion requires admin privileges - implement server-side function');

    return { success: true };
  } catch (error: any) {
    console.error('Unexpected error deleting user account:', error);
    return { success: false, error: error.message || 'Account deletion failed' };
  }
};

/**
 * Utility to format user display name
 */
export const getUserDisplayName = (user: User | null, profile?: UserProfile | null): string => {
  if (!user) return 'Guest';

  // The profiles row carries the name as first_name/last_name (with name/surname
  // as aliases); full_name is not a column, so resolve from whatever is present.
  const profileName = [
    profile?.full_name,
    [profile?.first_name, profile?.last_name].filter(Boolean).join(' '),
    [profile?.name, profile?.surname].filter(Boolean).join(' ')
  ]
    .map((n) => (typeof n === 'string' ? n.trim() : ''))
    .find((n) => n.length > 0);

  if (profileName) {
    return profileName;
  }

  if (user.user_metadata?.full_name) {
    return user.user_metadata.full_name;
  }

  if (user.email) {
    return user.email.split('@')[0]; // Use part before @ as display name
  }

  return 'User';
};

/**
 * Check if user session is valid
 */
export const isSessionValid = async (): Promise<boolean> => {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    return !error && !!session && session.expires_at ? new Date(session.expires_at * 1000) > new Date() : false;
  } catch (error: any) {
    console.error('Error checking session validity:', error);
    return false;
  }
};

/**
 * Debug function to check current session state
 */
export const debugSessionState = async (): Promise<void> => {
  try {
    console.log('=== Session Debug Info ===');

    // Check localStorage for Supabase tokens
    const storageKeys = Object.keys(localStorage).filter(key =>
      key.includes('supabase') || key.includes('xgenia')
    );
    console.log('Relevant localStorage keys:', storageKeys);

    // Check each relevant key
    storageKeys.forEach(key => {
      try {
        const value = localStorage.getItem(key);
        if (value) {
          const parsed = JSON.parse(value);
          console.log(`Key: ${key}`, parsed);
        }
      } catch (e: any) {
        console.log(`Key: ${key} - Could not parse:`, localStorage.getItem(key));
      }
    });

    // Check for specific Supabase auth keys
    const supabaseAuthKey = 'xgenia-supabase-auth-token';
    const defaultSupabaseKey = 'sb-pcrghrjikkcmelflwiys-auth-token';

    console.log('Custom Supabase auth key:', localStorage.getItem(supabaseAuthKey));
    console.log('Default Supabase auth key:', localStorage.getItem(defaultSupabaseKey));

    // Check current Supabase session
    const { data: { session }, error } = await supabase.auth.getSession();
    console.log('Current Supabase session:', { session, error });

    // Check current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    console.log('Current Supabase user:', { user, error: userError });

    // Check if we're in Electron
    console.log('Environment info:', {
      isElectron: typeof window !== 'undefined' && window.process?.type,
      hasLocalStorage: typeof window !== 'undefined' && !!window.localStorage,
      localStorageQuota: typeof window !== 'undefined' ? 'available' : 'unavailable'
    });

    console.log('=== End Session Debug ===');
  } catch (error: any) {
    console.error('Error in debugSessionState:', error);
  }
};

/**
 * Get current storage usage details
 */
export const getStorageUsage = (): { usage: Record<string, string>; total: string; highest: { key: string; size: string } } => {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return { usage: {}, total: '0 KB', highest: { key: '', size: '0 KB' } };
    }

    const usage: Record<string, string> = {};
    let totalBytes = 0;
    let highestKey = '';
    let highestSize = 0;

    for (const key in localStorage) {
      if (localStorage.hasOwnProperty(key)) {
        const value = localStorage.getItem(key);
        if (value) {
          const size = value.length * 2; // Approx bytes (UTF-16)
          totalBytes += size;
          usage[key] = `${(size / 1024).toFixed(2)} KB`;

          if (size > highestSize) {
            highestSize = size;
            highestKey = key;
          }
        }
      }
    }

    return {
      usage,
      total: `${(totalBytes / 1024).toFixed(2)} KB`,
      highest: {
        key: highestKey,
        size: `${(highestSize / 1024).toFixed(2)} KB`
      }
    };
  } catch (error: any) {
    console.warn('Error calculating storage usage:', error);
    return { usage: {}, total: 'Unknown', highest: { key: '', size: 'Unknown' } };
  }
};

/**
 * Force clear storage (exposed for emergency use)
 * Preserves critical auth keys unless forceAll is true
 */
export const forceClearStorage = (forceAll: boolean = false): void => {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;

    console.log('⚠️ Force clearing storage...');
    const initialUsage = getStorageUsage();
    console.log('Initial usage:', initialUsage.total);

    const importantKeys = [
      'supabase.auth.token',
      'sb-pcrghrjikkcmelflwiys-auth-token',
      'xgenia-supabase-auth-token'
    ];

    const keysToRemove = Object.keys(localStorage).filter(key =>
      forceAll || (!importantKeys.some(important => key.includes(important)) && !key.startsWith('xgenia_chat_history_'))
    );

    // Specifically handle chat history if forceAll is true
    if (forceAll) {
      Object.keys(localStorage).filter(k => k.startsWith('xgenia_chat_history_')).forEach(k => keysToRemove.push(k));
    }

    keysToRemove.forEach(key => {
      localStorage.removeItem(key);
      console.log(`Deleted key: ${key}`);
    });

    console.log(`✅ Cleared ${keysToRemove.length} keys.`);
    console.log('Remaining usage:', getStorageUsage().total);
  } catch (error: any) {
    console.error('Error clearing storage:', error);
  }
};

// Expose to window for console access
if (typeof window !== 'undefined') {
  (window as any).xgenia = {
    ...(window as any).xgenia,
    getStorageUsage,
    forceClearStorage,
    clearStorage: () => forceClearStorage(false), // Alias for safety
    wipeAll: () => forceClearStorage(true)
  };
  console.log('🛠️ XGenia Storage Utils loaded. Run window.xgenia.getStorageUsage() or window.xgenia.clearStorage() in console.');
}

/**
 * Clean up legacy storage keys to free up space
 * Specifically targets old xgenia_conversations_* keys that are now file-based
 */
export const cleanupLegacyStorage = (): void => {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;

    // console.log('🧹 cleanupLegacyStorage: Scanning for legacy data...');
    const allKeys = Object.keys(localStorage);

    // 1. Explicit legacy keys
    const legacyKeys = allKeys.filter(k => k.startsWith('xgenia_conversations_'));

    // 2. Large compilation artifacts or logs that might be stuck
    const garbageKeys = allKeys.filter(k =>
      k.startsWith('xgenia_temp_') ||
      k.includes('webpack') ||
      k === 'xgenia_test_storage' ||
      k.startsWith('xgenia_chat_history_') // Include large chat histories
    );

    const keysToClean = [...legacyKeys, ...garbageKeys];

    if (keysToClean.length > 0) {
      console.log(`🧹 cleanupLegacyStorage: Removing ${keysToClean.length} items...`);
      let freedBytes = 0;

      keysToClean.forEach(key => {
        const item = localStorage.getItem(key);
        if (item) {
          freedBytes += item.length;
          localStorage.removeItem(key);
        }
      });

      console.log(`✅ Cleaned up keys, freed approx ${(freedBytes / 1024).toFixed(2)} KB`);
    }
  } catch (error: any) {
    console.warn('⚠️ Error during legacy storage cleanup:', error);
  }
};

/**
 * Test function to verify session storage is working
 */
export const testSessionStorage = async (): Promise<void> => {
  try {
    // console.log('=== Testing Session Storage ===');

    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    const testKey = 'xgenia_test_storage';
    const testValue = { test: true, timestamp: Date.now() };

    try {
      localStorage.setItem(testKey, JSON.stringify(testValue));
      // Clean up immediately if successful
      localStorage.removeItem(testKey);
    } catch (e: any) {
      console.error('❌ Cannot write to localStorage:', e);

      // If we hit quota, try to auto-clean and retry once
      if (e.name === 'QuotaExceededError' || e.code === 22 || e.message?.includes('quota')) {
        console.log('⚠️ Storage full. Attempting emergency cleanup...');
        cleanupLegacyStorage();

        // Check usage to give helpful debug info
        const usage = getStorageUsage();
        console.warn('Storage Usage Warning:', usage);
        console.warn(`Biggest consumer: ${usage.highest.key} (${usage.highest.size})`);
      }
      return;
    }
  } catch (error: any) {
    console.error('Error in testSessionStorage:', error);
  }
};