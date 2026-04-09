// src/editor/src/context/AuthContext.tsx

import type { User, Session } from '@supabase/supabase-js';
import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import Intercom, { update as intercomUpdate, shutdown as intercomShutdown } from '@intercom/messenger-js-sdk';

import { useIsOnline } from '../hooks/useIsOnline';
import { supabase, signInWithEmail, signOut as supabaseSignOut } from '../supabaseInit';
import type { AuthContextType, AuthState } from '../types/auth';
import { AuthValidationService, ValidationResult } from '../utils/AuthValidationService';
import { debugSessionState, testSessionStorage, cleanupLegacyStorage } from '../utils/userUtils';

// Extended AuthState to include validation result
interface ExtendedAuthState extends AuthState {
  validationResult: ValidationResult | null;
  isOnline: boolean;
}

// Extended AuthContextType
interface ExtendedAuthContextType extends ExtendedAuthState {
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
  forceRevalidation: () => Promise<void>;
}

const AuthContext = createContext<ExtendedAuthContextType | undefined>(undefined);

export interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [authState, setAuthState] = useState<ExtendedAuthState>({
    user: null,
    session: null,
    loading: true,
    error: null,
    validationResult: null,
    isOnline: true
  });

  const isOnline = useIsOnline();

  // Update online status in state
  useEffect(() => {
    setAuthState((prev) => ({ ...prev, isOnline }));
  }, [isOnline]);

  // Validate user authentication periodically
  const validateAuth = async (user: User | null, session: Session | null) => {
    try {
      const validationResult = await AuthValidationService.validateUserAuth(user, session);

      setAuthState((prev) => ({
        ...prev,
        validationResult,
        // Only set error if validation explicitly requires forced reauth AND we have a session
        // (no session is a normal state, not an error)
        error:
          validationResult.shouldForceReauth && session ? validationResult.message || 'Authentication required' : null
      }));

      // If validation fails and we need to force reauth, clear the session
      if (validationResult.shouldForceReauth && session) {
        setAuthState((prev) => ({
          ...prev,
          user: null,
          session: null,
          loading: false
        }));
      }

      return validationResult;
    } catch (error: any) {
      setAuthState((prev) => ({
        ...prev,
        validationResult: {
          isValid: false,
          shouldForceReauth: true,
          shouldShowOfflineWarning: false,
          daysUntilExpiry: null,
          message: 'Validation failed'
        },
        error: 'Validation failed'
      }));
    }
  };

  useEffect(() => {
    const handleWakeUp = async () => {
      console.log('[AuthContext] Window/tab focused, checking session...');
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (session && session.user) {
          await validateAuth(session.user, session);
        }
      } catch (err) {
        console.error('[AuthContext] Exception checking session on wakeup:', err);
      }
    };

    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        handleWakeUp();
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    // Get initial session
    const getInitialSession = async () => {
      try {
        console.log('[AuthContext] Getting initial session...');

        // 🧹 Clean up legacy storage first to ensure space for session
        cleanupLegacyStorage();

        // Test session storage first
        await testSessionStorage();

        // Debug current session state
        await debugSessionState();

        // Check if we're in Electron environment
        console.log('[AuthContext] Environment check:', {
          isElectron: typeof window !== 'undefined' && window.process?.type,
          hasLocalStorage: typeof window !== 'undefined' && !!window.localStorage,
          localStorageKeys: typeof window !== 'undefined' ? Object.keys(localStorage).filter(k => k.includes('supabase') || k.includes('xgenia')) : []
        });

        // Check for Electron-specific events
        if (typeof window !== 'undefined' && window.process?.type) {
          console.log('[AuthContext] Running in Electron environment');

          // Listen for Electron window focus events
          window.addEventListener('focus', handleWakeUp);

          window.addEventListener('blur', () => {
            // console.log('[AuthContext] Electron window blurred');
          });
        }

        const {
          data: { session },
          error
        } = await supabase.auth.getSession();

        if (error) {
          console.error('[AuthContext] Error getting initial session:', error);
          setAuthState((prev) => ({
            ...prev,
            error: error.message,
            loading: false
          }));
        } else {
          console.log('[AuthContext] Initial session result:', {
            hasSession: !!session,
            hasUser: !!session?.user,
            expiresAt: session?.expires_at
          });

          setAuthState((prev) => ({
            ...prev,
            session,
            user: session?.user || null,
            loading: false
          }));

          // Only validate if we have a session and user
          if (session && session.user) {
            console.log('[AuthContext] Validating initial session...');
            await validateAuth(session.user, session);
          } else {
            console.log('[AuthContext] No initial session found, user will need to login');
          }
        }
      } catch (err: any) {
        console.error('[AuthContext] Exception getting initial session:', err);
        setAuthState((prev) => ({
          ...prev,
          error: err.message || 'Failed to get session',
          loading: false
        }));
      }
    };

    getInitialSession();

    // Listen for auth changes
    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('[AuthContext] Auth state change:', event, {
        hasSession: !!session,
        hasUser: !!session?.user
      });

      setAuthState((prev) => ({
        ...prev,
        session,
        user: session?.user || null,
        loading: false,
        error: null // Clear errors on successful auth state change
      }));

      // Validate the new session if it exists
      if (session && session.user) {
        await validateAuth(session.user, session);
      }
    });

    return () => {
      subscription?.unsubscribe();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      if (typeof window !== 'undefined' && window.process?.type) {
        window.removeEventListener('focus', handleWakeUp);
      }
    };
  }, []);

  // Periodic validation check (every 10 minutes when online)
  useEffect(() => {
    if (!authState.user || !authState.session) return;

    const interval = setInterval(async () => {
      if (isOnline) {
        await validateAuth(authState.user, authState.session);
      }
    }, 10 * 60 * 1000); // 10 minutes

    return () => clearInterval(interval);
  }, [authState.user, authState.session, isOnline]);

  // Initialize Intercom when a user is present; hide launcher to only track users
  useEffect(() => {
    try {
      if (typeof window === 'undefined') return;

      const user = authState.user as any;
      if (user) {
        const name =
          user.user_metadata?.full_name ||
          user.user_metadata?.name ||
          user.user_metadata?.username ||
          (user.email ? String(user.email).split('@')[0] : undefined);
        const createdAtSec = user.created_at ? Math.floor(new Date(user.created_at).getTime() / 1000) : undefined;

        Intercom({
          app_id: 'nive2k8y',
          user_id: user.id,
          name,
          email: user.email,
          created_at: createdAtSec,
          hide_default_launcher: true,
          theme_mode: 'dark'
        });

        // Ensure the launcher stays hidden in case of later updates
        intercomUpdate({ hide_default_launcher: true, theme_mode: 'dark' });

      } else {
        // Shutdown Intercom when user logs out
        intercomShutdown();
      }
    } catch (e: any) {
      console.warn('[AuthContext] Intercom init/shutdown error:', e);
    }
  }, [authState.user]);

  const signIn = async (email: string, password: string): Promise<void> => {
    try {
      console.log('[AuthContext] Starting sign in process for:', email);
      setAuthState((prev) => ({ ...prev, loading: true, error: null }));

      const { data, error } = await signInWithEmail(email, password);

      if (error) {
        console.error('[AuthContext] Sign in failed:', error);
        throw error;
      }

      console.log('[AuthContext] Sign in successful:', {
        hasSession: !!data.session,
        hasUser: !!data.user,
        expiresAt: data.session?.expires_at
      });

      // Auth state will be updated via the onAuthStateChange listener
    } catch (error: any) {
      console.error('[AuthContext] Sign in error:', error);
      setAuthState((prev) => ({
        ...prev,
        error: error.message || 'Sign in failed',
        loading: false
      }));
      throw error; // Re-throw so components can handle it
    }
  };

  const signOut = async (): Promise<void> => {
    try {
      setAuthState((prev) => ({ ...prev, loading: true, error: null }));

      const { error } = await supabaseSignOut();

      if (error) {
        throw error;
      }

      // Clear validation state
      setAuthState((prev) => ({
        ...prev,
        validationResult: null
      }));

      // Auth state will be updated via the onAuthStateChange listener
    } catch (error: any) {
      setAuthState((prev) => ({
        ...prev,
        error: error.message || 'Sign out failed',
        loading: false
      }));
      throw error;
    }
  };

  const refreshSession = async (): Promise<void> => {
    try {
      console.log('[AuthContext] Attempting to refresh session...');
      setAuthState((prev) => ({ ...prev, loading: true, error: null }));

      const { data, error } = await supabase.auth.refreshSession();

      if (error) {
        console.error('[AuthContext] Session refresh failed:', error);
        throw error;
      }

      console.log('[AuthContext] Session refresh successful:', {
        hasSession: !!data.session,
        hasUser: !!data.session?.user,
        expiresAt: data.session?.expires_at
      });

      setAuthState((prev) => ({
        ...prev,
        session: data.session,
        user: data.session?.user || null,
        loading: false
      }));

      // Validate the refreshed session
      if (data.session && data.session.user) {
        await validateAuth(data.session.user, data.session);
      }
    } catch (error: any) {
      console.error('[AuthContext] Session refresh error:', error);
      setAuthState((prev) => ({
        ...prev,
        error: error.message || 'Session refresh failed',
        loading: false
      }));
      throw error;
    }
  };

  const forceRevalidation = async (): Promise<void> => {
    await AuthValidationService.forceRevalidation();
    if (authState.user && authState.session) {
      await validateAuth(authState.user, authState.session);
    }
  };

  const contextValue: ExtendedAuthContextType = {
    ...authState,
    signIn,
    signOut,
    refreshSession,
    forceRevalidation
  };

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
};

export const useAuth = (): ExtendedAuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export default AuthContext;
