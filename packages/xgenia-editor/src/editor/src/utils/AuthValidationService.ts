import { supabase } from '../supabaseInit';
import type { User, Session } from '@supabase/supabase-js';

interface AuthValidationState {
  lastOnlineValidation: number | null;
  lastOfflineGracePeriodStart: number | null;
  consecutiveFailedValidations: number;
  userValidatedOffline: boolean;
}

interface ValidationResult {
  isValid: boolean;
  shouldForceReauth: boolean;
  shouldShowOfflineWarning: boolean;
  daysUntilExpiry: number | null;
  message?: string;
}

export class AuthValidationService {
  private static readonly STORAGE_KEY = 'xgenia_auth_validation_state';
  private static readonly ONLINE_VALIDATION_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
  private static readonly OFFLINE_GRACE_PERIOD = 30 * 24 * 60 * 60 * 1000; // 30 days
  private static readonly WARNING_PERIOD = 7 * 24 * 60 * 60 * 1000; // Show warning 7 days before expiry
  private static readonly MAX_FAILED_VALIDATIONS = 3;

  /**
   * Check if user authentication is valid (main validation function)
   */
  static async validateUserAuth(user: User | null, session: Session | null): Promise<ValidationResult> {
    if (!session || !user) {
      console.log('No valid session found - user not authenticated (normal state)');
      return {
        isValid: true,
        shouldForceReauth: false,
        shouldShowOfflineWarning: false,
        daysUntilExpiry: null,
        message: 'User not authenticated'
      };
    }

    const isOnline = navigator.onLine;
    const validationState = this.getValidationState();
    const now = Date.now();

    console.log('[AuthValidationService] Starting validation:', {
      userId: user.id,
      isOnline,
      navigatorOnLine: navigator.onLine,
      hasValidationState: !!validationState,
      lastOnlineValidation: validationState.lastOnlineValidation,
      lastOfflineGracePeriodStart: validationState.lastOfflineGracePeriodStart
    });

    // Check if session is expired
    if (session.expires_at && new Date(session.expires_at * 1000) <= new Date()) {
      if (isOnline) {
        // Try to refresh the session
        try {
          console.log('[AuthValidationService] Session expired, attempting refresh...');
          const { data, error } = await supabase.auth.refreshSession();
          if (!error && data.session) {
            console.log('[AuthValidationService] Session refreshed successfully');
            await this.recordSuccessfulValidation();
            return {
              isValid: true,
              shouldForceReauth: false,
              shouldShowOfflineWarning: false,
              daysUntilExpiry: null,
              message: 'Session refreshed successfully'
            };
          } else {
            console.error('[AuthValidationService] Session refresh failed:', error);
          }
        } catch (error: any) {
          console.error('Failed to refresh session:', error);
        }
      }
      
      // If offline or refresh failed, check grace period
      return this.handleExpiredSession(validationState, now);
    }

    if (isOnline) {
      return await this.handleOnlineValidation(user, validationState, now);
    } else {
      return this.handleOfflineValidation(validationState, now);
    }
  }

  /**
   * Handle validation when user is online
   */
  private static async handleOnlineValidation(
    user: User, 
    validationState: AuthValidationState, 
    now: number
  ): Promise<ValidationResult> {
    // Check if we need to validate (not validated in last 24 hours)
    const needsValidation = !validationState.lastOnlineValidation || 
      (now - validationState.lastOnlineValidation) > this.ONLINE_VALIDATION_INTERVAL;

    if (!needsValidation) {
      return {
        isValid: true,
        shouldForceReauth: false,
        shouldShowOfflineWarning: false,
        daysUntilExpiry: null
      };
    }

    try {
      console.log('[AuthValidationService] Attempting online validation for user:', user.id);
      
      // Try to validate user exists in database and is active.
      // If profiles table doesn't exist, we'll fall back to basic session validation.
      // 2026-08-19: is_active / subscription_status / last_seen were dropped in the
      // primora account rebuild (2026-08-04) — selecting them 400s on every launch.
      // The account flag is `status` now; the tier lives in membership_level/plan.
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('id, status, membership_level, plan')
        .eq('id', user.id)
        .single();

      // If profiles table doesn't exist or query fails, fall back to basic validation
      if (error) {
        console.warn('[AuthValidationService] Profiles table validation failed:', error.message);
        
        // Check if it's a table doesn't exist error (code 42P01) or similar
        if (error.code === '42P01' || error.message.includes('does not exist') || error.message.includes('relation')) {
          console.log('[AuthValidationService] Profiles table does not exist, using basic session validation');
          
          // For now, allow the user to proceed with basic session validation
          // This is a temporary fix until the database schema is set up
          await this.recordSuccessfulValidation();
          
          return {
            isValid: true,
            shouldForceReauth: false,
            shouldShowOfflineWarning: false,
            daysUntilExpiry: null,
            message: 'Basic session validation successful (profiles table not set up)'
          };
        }
        
        // For other database errors, be more lenient and don't force reauth
        // This prevents session invalidation due to temporary database issues
        console.warn('[AuthValidationService] Database error during validation, allowing session to continue:', error.message);
        await this.recordSuccessfulValidation();
        
        return {
          isValid: true,
          shouldForceReauth: false,
          shouldShowOfflineWarning: false,
          daysUntilExpiry: null,
          message: 'Session validation successful (database validation skipped due to error)'
        };
      }

      if (!profile) {
        console.warn('[AuthValidationService] User profile not found, but allowing session to continue');
        // Don't force reauth for missing profile - this could be a new user
        await this.recordSuccessfulValidation();
        
        return {
          isValid: true,
          shouldForceReauth: false,
          shouldShowOfflineWarning: false,
          daysUntilExpiry: null,
          message: 'Session validation successful (profile not yet created)'
        };
      }

      // Account state lives in `status` ('active' on healthy rows). Only force
      // reauth on values that explicitly mean the account was shut off — an
      // unknown or missing value must never log a working user out.
      const accountStatus = String((profile as any).status ?? '').toLowerCase();
      if (['inactive', 'suspended', 'disabled', 'deactivated', 'banned'].includes(accountStatus)) {
        console.warn('[AuthValidationService] User account deactivated, forcing reauth');
        await this.recordFailedValidation(validationState);
        return {
          isValid: false,
          shouldForceReauth: true,
          shouldShowOfflineWarning: false,
          daysUntilExpiry: null,
          message: 'User account has been deactivated'
        };
      }

      await this.recordSuccessfulValidation();
      
      return {
        isValid: true,
        shouldForceReauth: false,
        shouldShowOfflineWarning: false,
        daysUntilExpiry: null,
        message: 'Full validation successful'
      };
    } catch (error: any) {
      console.error('[AuthValidationService] Unexpected error during validation:', error);
      
      // Be lenient with unexpected errors - don't force reauth
      await this.recordSuccessfulValidation();
      
      return {
        isValid: true,
        shouldForceReauth: false,
        shouldShowOfflineWarning: false,
        daysUntilExpiry: null,
        message: 'Session validation successful (validation error occurred but session allowed)'
      };
    }
  }

  /**
   * Handle validation when user is offline
   */
  private static handleOfflineValidation(
    validationState: AuthValidationState, 
    now: number
  ): ValidationResult {
    console.log('[AuthValidationService] Handling offline validation:', {
      hasLastOfflineGracePeriodStart: !!validationState.lastOfflineGracePeriodStart,
      lastOfflineGracePeriodStart: validationState.lastOfflineGracePeriodStart,
      now,
      navigatorOnLine: navigator.onLine
    });
    
    // If no offline grace period has started, start it now
    if (!validationState.lastOfflineGracePeriodStart) {
      console.log('[AuthValidationService] Starting offline grace period');
      this.updateValidationState({
        ...validationState,
        lastOfflineGracePeriodStart: now,
        userValidatedOffline: true
      });
      
      return {
        isValid: true,
        shouldForceReauth: false,
        shouldShowOfflineWarning: true,
        daysUntilExpiry: 30,
        message: 'Working offline - you have 30 days until revalidation is required'
      };
    }

    const timeSinceOfflineStart = now - validationState.lastOfflineGracePeriodStart;
    const timeUntilExpiry = this.OFFLINE_GRACE_PERIOD - timeSinceOfflineStart;
    const daysUntilExpiry = Math.ceil(timeUntilExpiry / (24 * 60 * 60 * 1000));

    console.log('[AuthValidationService] Offline validation result:', {
      timeSinceOfflineStart,
      timeUntilExpiry,
      daysUntilExpiry,
      shouldShowWarning: timeUntilExpiry <= this.WARNING_PERIOD
    });

    if (timeUntilExpiry <= 0) {
      return {
        isValid: false,
        shouldForceReauth: true,
        shouldShowOfflineWarning: false,
        daysUntilExpiry: 0,
        message: 'Offline grace period has expired. Please connect to the internet to revalidate your account.'
      };
    }

    const shouldShowWarning = timeUntilExpiry <= this.WARNING_PERIOD;

    return {
      isValid: true,
      shouldForceReauth: false,
      shouldShowOfflineWarning: shouldShowWarning,
      daysUntilExpiry,
      message: shouldShowWarning 
        ? `Working offline - ${daysUntilExpiry} days until revalidation required`
        : undefined
    };
  }

  /**
   * Handle expired session
   */
  private static handleExpiredSession(
    validationState: AuthValidationState, 
    now: number
  ): ValidationResult {
    // If we're in offline grace period, allow continued usage
    if (validationState.lastOfflineGracePeriodStart) {
      const timeSinceOfflineStart = now - validationState.lastOfflineGracePeriodStart;
      const timeUntilExpiry = this.OFFLINE_GRACE_PERIOD - timeSinceOfflineStart;
      
      if (timeUntilExpiry > 0) {
        const daysUntilExpiry = Math.ceil(timeUntilExpiry / (24 * 60 * 60 * 1000));
        return {
          isValid: true,
          shouldForceReauth: false,
          shouldShowOfflineWarning: true,
          daysUntilExpiry,
          message: `Session expired but working offline - ${daysUntilExpiry} days until revalidation required`
        };
      }
    }

    return {
      isValid: false,
      shouldForceReauth: true,
      shouldShowOfflineWarning: false,
      daysUntilExpiry: null,
      message: 'Session has expired. Please log in again.'
    };
  }

  /**
   * Record successful validation
   */
  private static async recordSuccessfulValidation(): Promise<void> {
    const validationState = this.getValidationState();
    this.updateValidationState({
      ...validationState,
      lastOnlineValidation: Date.now(),
      lastOfflineGracePeriodStart: null, // Reset offline period
      consecutiveFailedValidations: 0,
      userValidatedOffline: false
    });
  }

  /**
   * Record failed validation
   */
  private static async recordFailedValidation(currentState: AuthValidationState): Promise<void> {
    this.updateValidationState({
      ...currentState,
      consecutiveFailedValidations: currentState.consecutiveFailedValidations + 1
    });
  }

  /**
   * Get current validation state from local storage
   */
  private static getValidationState(): AuthValidationState {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (!stored) {
        return {
          lastOnlineValidation: null,
          lastOfflineGracePeriodStart: null,
          consecutiveFailedValidations: 0,
          userValidatedOffline: false
        };
      }
      return JSON.parse(stored);
    } catch (error: any) {
      console.error('Failed to parse validation state:', error);
      return {
        lastOnlineValidation: null,
        lastOfflineGracePeriodStart: null,
        consecutiveFailedValidations: 0,
        userValidatedOffline: false
      };
    }
  }

  /**
   * Update validation state in local storage
   */
  private static updateValidationState(state: AuthValidationState): void {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(state));
    } catch (error: any) {
      console.error('Failed to save validation state:', error);
    }
  }

  /**
   * Force revalidation (useful for testing or manual refresh)
   */
  static async forceRevalidation(): Promise<void> {
    // Check if we're online before attempting revalidation
    if (!navigator.onLine) {
      throw new Error('Cannot revalidate while offline. Please check your internet connection and try again.');
    }
    
    // Clear the validation state to force a fresh validation
    this.updateValidationState({
      lastOnlineValidation: null,
      lastOfflineGracePeriodStart: null,
      consecutiveFailedValidations: 0,
      userValidatedOffline: false
    });
    
    console.log('[AuthValidationService] Validation state cleared, ready for fresh validation');
  }

  /**
   * Get human-readable status for UI display
   */
  static getAuthStatusMessage(result: ValidationResult): string {
    if (!result.isValid) {
      return result.message || 'Authentication required';
    }

    if (result.shouldShowOfflineWarning && result.daysUntilExpiry !== null) {
      if (result.daysUntilExpiry <= 1) {
        return 'Working offline - Please connect to internet soon to revalidate';
      } else if (result.daysUntilExpiry <= 7) {
        return `Working offline - ${result.daysUntilExpiry} days until revalidation required`;
      }
    }

    return 'Authenticated';
  }
}

export type { ValidationResult, AuthValidationState }; 