// src/editor/App.ts



import * as remote from '@electron/remote';
import React, { useState, useEffect, Component, ErrorInfo } from 'react';

import { AuthStatusBanner } from './src/components/AuthStatusBanner';
import { VideoLoader } from './src/components/VideoLoader';
// Removed Firebase imports and replaced with Supabase
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { SupabaseEmailLogin } from './src/licensing/SupabaseEmailLogin';
import Router from './src/router';

// // Import performance tracking (auto-starts when imported)
// import './src/utils/PerformanceIntegration';

// Error Boundary Component to prevent app crashes
class ErrorBoundary extends Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null; errorInfo: ErrorInfo | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error) {
    // Ignore harmless DOM removeChild errors caused by jQuery/external DOM manipulation
    if (error?.message?.includes('removeChild') || error?.name === 'NotFoundError') {
      console.warn('[ErrorBoundary] Ignoring non-fatal DOM error:', error.message);
      return null; // Don't set error state, let the app continue
    }
    // Update state so the next render will show the fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log the error to console for debugging
    console.error('ErrorBoundary caught an error:', error, errorInfo);

    // You can also log the error to an error reporting service here
    // logErrorToService(error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      // You can render any custom fallback UI
      return (
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: '100vh',
            background: '#222',
            color: '#ff4d4d',
            textAlign: 'center',
            padding: '20px'
          }}
        >
          <div>
            <h3>Something went wrong</h3>
            <p>An error occurred while running the application.</p>
            {this.state.error && (
              <pre style={{ textAlign: 'left', fontSize: '11px', maxHeight: '300px', overflow: 'auto', background: '#111', padding: '10px', borderRadius: '4px', marginTop: '10px' }}>
                {this.state.error.message}{'\n\n'}{this.state.error.stack}
              </pre>
            )}
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '8px 16px',
                backgroundColor: '#dc3545',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                marginTop: '10px'
              }}
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Main App Content Co   mponent (uses auth context)
function AppContent() {
  const { user, loading, error, validationResult, isOnline } = useAuth();
  const [showIntro, setShowIntro] = useState<boolean>(false); // Video intro disabled

  // Add global error handler for unhandled errors
  useEffect(() => {
    const handleGlobalError = (event: ErrorEvent) => {
      // Prevent default browser error handling
      event.preventDefault();
    };

    window.addEventListener('error', handleGlobalError);

    return () => {
      window.removeEventListener('error', handleGlobalError);
    };
  }, []);

  const handleVideoEnd = () => {
    setShowIntro(false);
  };

  if (showIntro) {
    return <VideoLoader onVideoEnd={handleVideoEnd} />;
  }

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          background: '#222',
          color: '#fff'
        }}
      >
        <div>Loading XGENIA Authentication...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          background: '#222',
          color: '#ff4d4d',
          textAlign: 'center'
        }}
      >
        <div>
          <h3>Authentication Error</h3>
          <p>{error}</p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '8px 16px',
              backgroundColor: '#dc3545',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              marginTop: '10px'
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Show login when no authenticated user is present
  const shouldShowLogin = !user;

  if (shouldShowLogin) {
    return (
      <SupabaseEmailLogin
        onLoginSuccess={() => {
          // Login success will be handled by the auth state change listener
          console.log('Login successful, auth state will update automatically');
        }}
      />
    );
  }

  return (
    <>
      <AuthStatusBanner validationResult={validationResult} isOnline={isOnline} />
      <div
        style={{
          paddingTop:
            validationResult && (!validationResult.isValid || validationResult.shouldShowOfflineWarning || !isOnline)
              ? '40px'
              : '0'
        }}
      >
        <Router uri={remote.process.env.xgeniaURI} />
      </div>
    </>
  );
}

// Main App Component with AuthProvider
export function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ErrorBoundary>
          <AppContent />
        </ErrorBoundary>
      </AuthProvider>
    </ErrorBoundary>
  );
}
