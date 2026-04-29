import React, { useState, useCallback } from 'react';
import { ValidationResult } from '../utils/AuthValidationService';
import { useAuth } from '../context/AuthContext';

interface AuthStatusBannerProps {
  validationResult: ValidationResult | null;
  isOnline: boolean;
}

export const AuthStatusBanner: React.FC<AuthStatusBannerProps> = ({
  validationResult,
  isOnline
}) => {
  const { forceRevalidation } = useAuth();
  const [dismissed, setDismissed] = useState(false);
  const [isRevalidating, setIsRevalidating] = useState(false);

  const handleRevalidate = useCallback(async () => {
    if (isRevalidating) return;

    try {
      console.log('[AuthStatusBanner] Revalidation button clicked, checking online status...');

      if (!navigator.onLine) {
        console.log('[AuthStatusBanner] User is offline, cannot revalidate');
        alert('You are currently offline. Please check your internet connection and try again.');
        return;
      }

      setIsRevalidating(true);
      console.log('[AuthStatusBanner] Starting revalidation...');
      await forceRevalidation();
      console.log('[AuthStatusBanner] Revalidation completed successfully');
      setDismissed(true);
    } catch (error: any) {
      console.error('[AuthStatusBanner] Revalidation failed:', error);
      alert(`Revalidation failed: ${error?.message || 'Unknown error'}. Please try again or refresh the page.`);
    } finally {
      setIsRevalidating(false);
    }
  }, [forceRevalidation, isRevalidating]);

  if (!validationResult) return null;
  if (dismissed) return null;

  // Don't show banner if everything is fine
  if (validationResult.isValid && !validationResult.shouldShowOfflineWarning && isOnline) {
    return null;
  }

  const getMessage = () => {
    if (!validationResult.isValid) {
      return validationResult.message || 'Authentication required';
    }

    if (!isOnline && validationResult.shouldShowOfflineWarning) {
      return `Offline — ${validationResult.daysUntilExpiry} days until revalidation required`;
    }

    if (!isOnline) {
      return 'Working offline — Some features may be limited';
    }

    if (validationResult.shouldShowOfflineWarning) {
      return `${validationResult.daysUntilExpiry} days until revalidation required`;
    }

    return validationResult.message || 'Status OK';
  };

  const getActionButton = () => {
    if (!validationResult.isValid) {
      return (
        <button style={styles.actionButton} onClick={() => window.location.reload()}>
          Sign In
        </button>
      );
    }

    // Show revalidate button when online AND we have a warning to show
    if (validationResult.shouldShowOfflineWarning && isOnline && navigator.onLine) {
      return (
        <button
          style={{
            ...styles.actionButton,
            ...(isRevalidating ? { opacity: 0.6, cursor: 'wait' } : {})
          }}
          onClick={handleRevalidate}
          disabled={isRevalidating}
        >
          {isRevalidating ? 'Revalidating...' : 'Revalidate Now'}
        </button>
      );
    }

    // Show disabled button when offline and warning is needed
    if (validationResult.shouldShowOfflineWarning && !isOnline) {
      return (
        <button
          style={{ ...styles.actionButton, opacity: 0.5, cursor: 'not-allowed' }}
          disabled={true}
          title="Revalidation requires internet connection"
        >
          Offline — Cannot Revalidate
        </button>
      );
    }

    return null;
  };

  return (
    <div style={styles.banner}>
      <div style={styles.content}>
        <span style={styles.message}>{getMessage()}</span>
        <div style={styles.actions}>
          {getActionButton()}
          <button
            style={styles.dismissButton}
            onClick={() => setDismissed(true)}
            aria-label="Dismiss banner"
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  banner: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10000,
    padding: '6px 16px',
    fontSize: '13px',
    fontWeight: 500,
    backgroundColor: '#000000',
    color: '#ffffff',
    pointerEvents: 'auto',
  },
  content: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    maxWidth: '1200px',
    margin: '0 auto',
  },
  message: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flex: 1,
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexShrink: 0,
  },
  actionButton: {
    padding: '4px 12px',
    fontSize: '12px',
    fontWeight: 600,
    border: '1px solid rgba(255, 255, 255, 0.3)',
    borderRadius: '4px',
    cursor: 'pointer',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    color: '#ffffff',
    transition: 'background-color 0.15s',
    whiteSpace: 'nowrap',
    pointerEvents: 'auto',
  },
  dismissButton: {
    background: 'none',
    border: 'none',
    color: 'rgba(255, 255, 255, 0.6)',
    cursor: 'pointer',
    fontSize: '14px',
    padding: '4px 6px',
    lineHeight: 1,
    pointerEvents: 'auto',
  },
};