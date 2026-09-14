import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://pcrghrjikkcmelflwiys.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjcmdocmppa2tjbWVsZmx3aXlzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDUzNTU3OTAsImV4cCI6MjA2MDkzMTc5MH0.wxwJQqyTZATJmaJPDX3TuaNaJ5hxMFFk7RgzHeq4Bt0';
11
/**
 * AN AUTH REQUEST THAT HANGS HOLDS THE AUTH LOCK FOREVER. (2026-09-10)
 *
 * supabase-js v2 serialises every auth operation behind one exclusive Web Lock
 * (`lock:sb-<ref>-auth-token`), held for the whole of a refresh — and `_refreshAccessToken`
 * retries *retryable* fetch failures with backoff inside that lock. A socket that never answers
 * is not a failure: the fetch promise simply never settles, the retry loop never advances, and
 * the lock is never released. Everything else on this client then queues behind it forever —
 * `getSession()`, `refreshSession()`, and the `auth.getJwt` / `auth.refreshJwt` bridge commands
 * the AI panel drives. The panel's 15s bound expires and it tells the user their session is dead
 * when the session is perfectly alive; only reloading the editor clears it.
 *
 * Bounding the request converts that silence into a rejection, which supabase-js wraps as an
 * AuthRetryableFetchError — so the retry loop advances, the budget (AUTO_REFRESH_TICK_DURATION,
 * 30s) actually terminates, and the lock is released.
 *
 * Scoped to /auth/v1/ deliberately: PostgREST, storage and function calls can be legitimately
 * slow, carry no auth lock, and must not inherit this ceiling.
 */
const AUTH_FETCH_TIMEOUT_MS = 10_000;

const boundedAuthFetch: typeof fetch = (input, init) => {
  const url = typeof input === 'string' ? input
    : input instanceof URL ? input.href
      : (input as Request).url;

  if (!url || !url.includes('/auth/v1/')) return fetch(input as any, init);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`auth request exceeded ${AUTH_FETCH_TIMEOUT_MS}ms`)), AUTH_FETCH_TIMEOUT_MS);

  // Never drop an abort the caller asked for — chain theirs onto ours.
  const callerSignal = init?.signal;
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort((callerSignal as any).reason);
    else callerSignal.addEventListener('abort', () => controller.abort((callerSignal as any).reason), { once: true });
  }

  return fetch(input as any, { ...init, signal: controller.signal })
    .finally(() => clearTimeout(timer));
};

// Initialize the Supabase client with standard configuration for better compatibility
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true
    // Remove custom storage configuration to use default Supabase behavior
  },
  global: {
    fetch: boundedAuthFetch,
    headers: {
      'X-Client-Info': 'xgenia-editor'
    }
  }
});

type RefreshResult = Awaited<ReturnType<typeof supabase.auth.refreshSession>>;

/** The one refresh currently in flight for this editor, shared by every caller below. */
let refreshInFlight: Promise<RefreshResult> | null = null;

/**
 * ONE REFRESH AT A TIME, FOR THE WHOLE EDITOR. (2026-09-10)
 *
 * Supabase refresh tokens are single-use with rotation. Three places used to call
 * `supabase.auth.refreshSession()` independently — the ChatPanel bridge's `auth.refreshJwt`,
 * `AuthContext.refreshSession`, and `AuthValidationService.validateUserAuth` — on top of the
 * client's own autoRefresh tick. Concurrent refreshes double-spend the token, Supabase's reuse
 * detection revokes the whole family, and the user is signed out of the app ("Invalid Refresh
 * Token: Already Used"). They also pile up on the auth lock, so each one waits out the others.
 *
 * Every editor-side refresh goes through here. Callers that arrive while one is running share
 * its outcome instead of starting a second. The latch is released when the WORK settles — never
 * on a caller's timeout — so a caller that gives up early cannot strand it (and the bounded
 * fetch above guarantees the work does settle).
 */
export function refreshSessionShared(): Promise<RefreshResult> {
  if (refreshInFlight) return refreshInFlight;

  const run = supabase.auth.refreshSession();
  refreshInFlight = run;

  const release = () => { if (refreshInFlight === run) refreshInFlight = null; };
  run.then(release, release);

  return run;
}

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