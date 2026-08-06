import type { User, Session, AuthChangeEvent } from '@supabase/supabase-js';

export interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  error: string | null;
}

export interface AuthContextType extends AuthState {
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

export type AuthEventHandler = (event: AuthChangeEvent, session: Session | null) => void;

// User profile interface for extended user data
export interface UserProfile {
  id: string;
  email: string;
  full_name?: string;
  avatar_url?: string;
  created_at: string;
  updated_at: string;

  // Name as stored on the profiles row (full_name is not a column)
  first_name?: string;
  last_name?: string;
  name?: string;
  surname?: string;

  // Subscription. membership_level is the tier ('free' | 'pro' | 'enterprise'),
  // plan is its display label, subscription_status is the legacy column name.
  membership_level?: string;
  plan?: string;
  subscription_status?: string;
  is_alpha_tester?: boolean;
  expires_at?: string | null;
  trial_hours?: number | null;
}

// Auth error types
export interface AuthError {
  message: string;
  status?: number;
  code?: string;
} 