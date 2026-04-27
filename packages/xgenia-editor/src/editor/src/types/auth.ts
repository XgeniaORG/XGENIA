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
}

// Auth error types
export interface AuthError {
  message: string;
  status?: number;
  code?: string;
} 