import React, { useEffect, useRef, useState } from 'react';

interface VideoLoaderProps {
  onVideoEnd: () => void;
}

export const VideoLoader: React.FC<VideoLoaderProps> = ({ onVideoEnd }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Try multiple possible paths for the MP4 video
  const videoPaths = [
    '../assets/videos/LogoIntroXGENIA.mp4',
    '../../assets/videos/LogoIntroXGENIA.mp4',
    './assets/videos/LogoIntroXGENIA.mp4',
    '/assets/videos/LogoIntroXGENIA.mp4',
    'assets/videos/LogoIntroXGENIA.mp4'
  ];
  const [videoPath, setVideoPath] = useState(videoPaths[0]);
  
  // Test which path works
  useEffect(() => {
    async function checkVideoPaths() {
      console.log('VideoLoader: Testing video paths...');
      for (const path of videoPaths) {
        try {
          const response = await fetch(path, { method: 'HEAD' });
          if (response.ok) {
            console.log(`VideoLoader: Found working path: ${path}`);
            setVideoPath(path);
            return;
          }
        } catch (err: any) {
          // Ignore fetch errors and try next path
        }
      }
      // If no path works, we'll use the fallback animation
      console.log('VideoLoader: No valid video path found, using fallback animation');
    }
    
    checkVideoPaths();
  }, []);
  
  // Skip video if it takes too long to load
  useEffect(() => {
    console.log('VideoLoader: Starting intro animation');
    
    // Set a fallback timeout to proceed even if video doesn't load
    const timeoutId = setTimeout(() => {
      console.log('VideoLoader: Animation complete, proceeding to application');
      onVideoEnd();
    }, 5000); // 5 seconds timeout
    
    return () => {
      clearTimeout(timeoutId);
    };
  }, [onVideoEnd]);
  
  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      console.log(`VideoLoader: Attempting to load video: ${videoPath}`);
      
      // Handle video end with a 2-second delay
      video.addEventListener('ended', () => {
        console.log('VideoLoader: Video playback ended, waiting 5 seconds before proceeding');
        setTimeout(() => {
          console.log('VideoLoader: 5-second delay complete, proceeding to application');
          onVideoEnd();
        }, 5000); // 5 seconds delay after video ends
      });
      
      // Handle loading success
      video.addEventListener('canplaythrough', () => {
        console.log('VideoLoader: Video loaded successfully');
        setLoaded(true);
        try {
          // Start playback
          const playPromise = video.play();
          // Modern browsers return a promise from play()
          if (playPromise !== undefined) {
            playPromise
              .then(() => console.log('VideoLoader: Playback started successfully'))
              .catch(err => {
                console.error('VideoLoader: Playback error:', err);
                // If autoplay fails (common on mobile), proceed to application
                onVideoEnd();
              });
          }
        } catch (err: any) {
          console.error('VideoLoader: Playback error:', err);
          onVideoEnd();
        }
      });
      
      // Handle loading error
      video.addEventListener('error', (e) => {
        console.error('VideoLoader: Video loading error:', e);
        setError('Failed to load video');
        onVideoEnd();
      });
    }
    
    // Clean up event listeners
    return () => {
      if (video) {
        video.removeEventListener('ended', () => {
          setTimeout(onVideoEnd, 5000);
        });
        video.removeEventListener('canplaythrough', () => setLoaded(true));
        video.removeEventListener('error', () => setError('Failed to load video'));
      }
    };
  }, [onVideoEnd, videoPath]);
  
  // Show a skip button to allow users to bypass the intro
  const handleSkip = () => {
    console.log('VideoLoader: User skipped intro video');
    onVideoEnd();
  };

  return (
    <div style={{ 
      position: 'fixed', 
      top: 0, 
      left: 0, 
      width: '100%', 
      height: '100%', 
      backgroundColor: '#fff', // Changed from #000 to #fff for white background
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center', 
      alignItems: 'center',
      zIndex: 9999
    }}>
      {/* Only render video element if no error */}
      {!error && (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{ 
            maxWidth: '100%', 
            maxHeight: '80%',
            objectFit: 'contain'
          }}
        >
          <source src={videoPath} type="video/mp4" />
          Your browser does not support the video tag.
        </video>
      )}
      
      {/* Loading indicator */}
      {!loaded && !error && (
        <div style={{ marginTop: '20px', color: '#333', textAlign: 'center' }}>
          <p>Loading XGENIA...</p>
          <div style={{ 
            width: '200px', 
            height: '4px', 
            backgroundColor: '#eee',
            borderRadius: '2px',
            overflow: 'hidden',
            marginTop: '10px'
          }}>
            <div style={{ 
              height: '100%', 
              width: '50%', 
              backgroundColor: '#0088cc',
              borderRadius: '2px',
              animation: 'loading 2s infinite ease-in-out'
            }}></div>
          </div>
          <style>
            {`
              @keyframes loading {
                0% { transform: translateX(-100%); }
                50% { transform: translateX(100%); }
                100% { transform: translateX(-100%); }
              }
            `}
          </style>
        </div>
      )}
      
      {/* Error message */}
      {error && (
        <div style={{ color: '#ff6b6b', marginTop: '20px', textAlign: 'center' }}>
          <p>{error}</p>
          <p>Starting application...</p>
        </div>
      )}
      
      {/* Skip button */}
      <button 
        onClick={handleSkip}
        style={{
          position: 'absolute',
          bottom: '20px',
          padding: '8px 16px',
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          color: '#fff',
          border: '1px solid #fff',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '14px'
        }}
      >
        Skip Intro
      </button>
    </div>
  );
}; 