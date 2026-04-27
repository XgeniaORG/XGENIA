

import React, { useEffect, useState, useRef } from 'react';



export interface LoaderScreenProps {
  progress?: number; // 0 to 1
  isVisible?: boolean;
  autoHide?: boolean; // Automatically hide when progress reaches 100%
  loadingText?: string;
  showPercentage?: boolean;
  customLogoUrl?: string; // Custom logo image URL, empty = use text fallback
  completeDelay?: number; // Delay in ms after loading completes before fade out
  onFadeOutComplete?: () => void;
  xgeniaNode?: any;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}



/**
* LoaderScreen - A full-screen loading overlay with XGENIA branding
* 
* Features:
* - Dark theme with animated logo
* - Smooth progress bar with glow effect
* - Fade-out animation when loading completes
* - Blocks all interaction during loading
*/
export const LoaderScreen: React.FC<LoaderScreenProps> = ({
  progress = 0,
  isVisible = true,
  autoHide = false,
  loadingText = 'Loading assets...',
  showPercentage = true,
  customLogoUrl = '',
  completeDelay = 0,
  onFadeOutComplete,
  xgeniaNode: _xgeniaNode, // Prefixed with _ to indicate intentionally unused
  style,
  children
}) => {
  // _xgeniaNode is available for future use if needed
  void _xgeniaNode;



  const [isFadingOut, setIsFadingOut] = useState(false);
  const [shouldRender, setShouldRender] = useState(isVisible);
  const [logoFailed, setLogoFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);



  // Determine which logo to use
  const hasCustomLogo = customLogoUrl && customLogoUrl.trim() !== '';



  const percentageValue = Math.min(100, Math.max(0, Math.round((progress || 0) * 100)));

  // Determine if we should be visible based on both prop and autoHide logic
  const isLoaded = percentageValue >= 100;
  const effectivelyVisible = isVisible && !(autoHide && isLoaded);



  // Handle delay after loading completes or manual hide
  useEffect(() => {
    // When loading completes or hidden manually and we have a delay configured
    if (!effectivelyVisible && shouldRender && !isFadingOut) {
      if (completeDelay > 0) {
        const timer = setTimeout(() => {
          setIsFadingOut(true);
        }, completeDelay);
        return () => clearTimeout(timer);
      } else {
        setIsFadingOut(true);
      }
    }



    // When loading should be shown again
    if (effectivelyVisible && !shouldRender) {
      setShouldRender(true);
      setIsFadingOut(false);
    }

    return undefined;
  }, [effectivelyVisible, shouldRender, isFadingOut, completeDelay]);



  // Handle fade-out animation completion
  useEffect(() => {
    if (isFadingOut) {
      const timer = setTimeout(() => {
        setShouldRender(false);
        setIsFadingOut(false);
        onFadeOutComplete?.();
      }, 600); // Match CSS transition duration
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [isFadingOut, onFadeOutComplete]);



  // Get base URL for assets
  const baseUrl = typeof window !== 'undefined' && (window as any).XGENIA?.Env?.BaseUrl
    ? (window as any).XGENIA.Env.BaseUrl
    : '/';



  // Use custom logo if provided, otherwise fall back to default XGENIA logo
  const logoUrl = hasCustomLogo
    ? customLogoUrl
    : `${baseUrl}ndl_assets/xgenia-loader-logo.png`;



  // If no custom logo and default fails, show text. If custom logo is provided, always try to show it.
  const shouldShowTextFallback = !hasCustomLogo && logoFailed;



  return (
    <div style={style}>
      {shouldRender && (
        <div
          ref={containerRef}
          className={`xgenia-loader-screen ${isFadingOut ? 'xgenia-loader-fade-out' : ''}`}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            zIndex: 999999,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#0a0a0f',
            background: 'radial-gradient(ellipse at center, #1a1a2e 0%, #0a0a0f 70%)',
            opacity: isFadingOut ? 0 : 1,
            transition: 'opacity 0.6s ease-out',
            pointerEvents: 'all',
            userSelect: 'none',
            overflow: 'hidden'
          }}
          data-xgenia-loader="true"
        >
          {/* Animated background particles */}
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            overflow: 'hidden',
            pointerEvents: 'none'
          }}>
            {[...Array(20)].map((_, i) => (
              <div
                key={i}
                className="xgenia-loader-particle"
                style={{
                  position: 'absolute',
                  width: `${2 + Math.random() * 4}px`,
                  height: `${2 + Math.random() * 4}px`,
                  backgroundColor: 'rgba(99, 102, 241, 0.3)',
                  borderRadius: '50%',
                  left: `${Math.random() * 100}%`,
                  top: `${Math.random() * 100}%`,
                  animation: `xgenia-loader-float ${8 + Math.random() * 8}s ease-in-out infinite`,
                  animationDelay: `${Math.random() * 5}s`
                }}
              />
            ))}
          </div>



          {/* Logo container with pulse animation */}
          <div
            className="xgenia-loader-logo-container"
            style={{
              position: 'relative',
              marginBottom: '48px'
            }}
          >
            {/* Glow effect behind logo */}
            <div
              className="xgenia-loader-logo-glow"
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: '200px',
                height: '200px',
                background: 'radial-gradient(circle, rgba(99, 102, 241, 0.4) 0%, transparent 70%)',
                borderRadius: '50%',
                filter: 'blur(30px)',
                animation: 'xgenia-loader-pulse 2s ease-in-out infinite'
              }}
            />



            {/* Logo image or text fallback */}
            {shouldShowTextFallback ? (
              // Text fallback when no custom logo and default logo fails
              <div
                className="xgenia-loader-logo-text"
                style={{
                  fontSize: '48px',
                  fontWeight: 'bold',
                  color: 'white',
                  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                  letterSpacing: '4px',
                  textShadow: '0 0 20px rgba(99, 102, 241, 0.5)',
                  animation: 'xgenia-loader-logo-pulse 2s ease-in-out infinite'
                }}
              >
                XGENIA
              </div>
            ) : (
              // Show image (custom or default)
              <img
                src={logoUrl}
                alt="Loading"
                className="xgenia-loader-logo"
                style={{
                  position: 'relative',
                  width: hasCustomLogo ? 'auto' : '180px',
                  maxWidth: '250px',
                  maxHeight: '120px',
                  height: 'auto',
                  objectFit: 'contain',
                  filter: 'drop-shadow(0 0 20px rgba(99, 102, 241, 0.5))',
                  animation: 'xgenia-loader-logo-pulse 2s ease-in-out infinite'
                }}
                onError={() => {
                  if (!hasCustomLogo) {
                    console.warn('[LoaderScreen] Default logo failed to load, using text fallback');
                    setLogoFailed(true);
                  } else {
                    console.warn('[LoaderScreen] Custom logo failed to load:', customLogoUrl);
                  }
                }}
              />
            )}
          </div>



          {/* Progress bar container */}
          <div
            style={{
              width: '300px',
              maxWidth: '80vw',
              marginBottom: '24px'
            }}
          >
            {/* Progress bar background */}
            <div
              style={{
                width: '100%',
                height: '6px',
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                borderRadius: '3px',
                overflow: 'hidden',
                position: 'relative'
              }}
            >
              {/* Progress bar fill */}
              <div
                className="xgenia-loader-progress-fill"
                style={{
                  width: `${percentageValue}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #6366f1 0%, #8b5cf6 50%, #a78bfa 100%)',
                  borderRadius: '3px',
                  transition: 'width 0.3s ease-out',
                  position: 'relative',
                  boxShadow: '0 0 10px rgba(99, 102, 241, 0.5), 0 0 20px rgba(99, 102, 241, 0.3)'
                }}
              >
                {/* Shimmer effect */}
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.3) 50%, transparent 100%)',
                    animation: 'xgenia-loader-shimmer 1.5s ease-in-out infinite'
                  }}
                />
              </div>
            </div>
          </div>



          {/* Loading text */}
          <div
            style={{
              color: 'rgba(255, 255, 255, 0.7)',
              fontSize: '14px',
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              letterSpacing: '0.5px',
              textAlign: 'center'
            }}
          >
            {loadingText}
            {showPercentage && (
              <span style={{
                marginLeft: '8px',
                color: '#a78bfa',
                fontWeight: 500
              }}>
                {percentageValue}%
              </span>
            )}
          </div>



          {/* Inline keyframe styles */}
          <style>{`
           @keyframes xgenia-loader-pulse {
             0%, 100% {
               opacity: 0.4;
               transform: translate(-50%, -50%) scale(1);
             }
             50% {
               opacity: 0.7;
               transform: translate(-50%, -50%) scale(1.1);
             }
           }

           @keyframes xgenia-loader-logo-pulse {
             0%, 100% {
               transform: scale(1);
               filter: drop-shadow(0 0 20px rgba(99, 102, 241, 0.5));
             }
             50% {
               transform: scale(1.02);
               filter: drop-shadow(0 0 30px rgba(99, 102, 241, 0.7));
             }
           }

           @keyframes xgenia-loader-shimmer {
             0% {
               transform: translateX(-100%);
             }
             100% {
               transform: translateX(100%);
             }
           }

           @keyframes xgenia-loader-float {
             0%, 100% {
               transform: translateY(0) translateX(0);
               opacity: 0.3;
             }
             25% {
               transform: translateY(-20px) translateX(10px);
               opacity: 0.5;
             }
             50% {
               transform: translateY(-10px) translateX(-5px);
               opacity: 0.3;
             }
             75% {
               transform: translateY(-30px) translateX(5px);
               opacity: 0.4;
             }
           }

           .xgenia-loader-fade-out {
             pointer-events: none !important;
           }
         `}</style>
        </div>
      )}
      {/* Children are rendered alongside the loader */}
      {children}
    </div>
  );
};



export default LoaderScreen;
