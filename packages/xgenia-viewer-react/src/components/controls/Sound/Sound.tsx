import React, { useEffect, useCallback, useRef } from 'react';
import useSound from 'use-sound';

import Layout from '../../../layout';
import { XGENIA } from '../../../types';

export interface SoundProps extends XGENIA.ReactProps {
  soundUrl: string;
  volume: number;
  playbackRate: number;
  loop: boolean;
  interrupt: boolean;
  sprite?: string; // JSON string of sprite data
  spriteId?: string;
  autoPlay?: boolean;

  // UI Options
  showControls?: boolean;
  showVolumeSlider?: boolean;
  controlsStyle?: React.CSSProperties;

  // Event callbacks from the node
  onPlay?: () => void;
  onPause?: () => void;
  onStop?: () => void;
  onEnd?: () => void;
  onLoad?: () => void;
  onError?: (error: any) => void;

  // Control refs for the node to call
  onComponentMount?: (controls: SoundControls) => void;
  onComponentUnmount?: () => void;
}

export interface SoundControls {
  play: (options?: { id?: string }) => void;
  stop: () => void;
  pause: () => void;
  isPlaying: () => boolean;
  getDuration: () => number | null;
  getSound: () => any;
}

export function Sound(props: SoundProps) {
  const {
    soundUrl,
    volume = 1.0,
    playbackRate = 1.0,
    loop = false,
    interrupt = false,
    sprite,
    spriteId,
    autoPlay = false,
    showControls = false,
    showVolumeSlider = false,
    onPlay,
    onPause,
    onStop,
    onEnd,
    onLoad,
    onError,
    onComponentMount,
    onComponentUnmount
  } = props;

  const isPlayingRef = useRef(false);
  const volumeRef = useRef(volume);

  // Hover states for buttons
  const [playHovered, setPlayHovered] = React.useState(false);
  const [pauseHovered, setPauseHovered] = React.useState(false);
  const [stopHovered, setStopHovered] = React.useState(false);

  // Parse sprite data
  const spriteData = React.useMemo(() => {
    if (!sprite) return undefined;
    try {
      return JSON.parse(sprite);
    } catch (e: any) {
      console.error('Invalid sprite data:', e);
      return undefined;
    }
  }, [sprite]);

  // Detect audio format from URL
  const audioFormat = React.useMemo(() => {
    if (!soundUrl) return undefined;
    const extension = soundUrl.split('.').pop()?.toLowerCase();
    switch (extension) {
      case 'mp3':
        return ['mp3'];
      case 'wav':
        return ['wav'];
      case 'ogg':
        return ['ogg'];
      case 'm4a':
      case 'aac':
        return ['m4a', 'aac'];
      case 'flac':
        return ['flac'];
      case 'wma':
        return ['wma'];
      default:
        // Try to detect from URL or default to mp3
        return ['mp3', 'wav', 'ogg'];
    }
  }, [soundUrl]);

  // Configure use-sound
  const soundConfig = React.useMemo(() => ({
    volume: volumeRef.current,
    playbackRate,
    loop,
    interrupt,
    sprite: spriteData,
    format: audioFormat,
    html5: true, // Use HTML5 audio for better compatibility
    preload: true, // Preload the audio file
    onload: () => {
      console.log('Audio loaded successfully:', soundUrl);
      onLoad?.();
    },
    onloaderror: (_id: any, error: any) => {
      console.error('Audio load error:', error, 'URL:', soundUrl);
      onError?.(error);
    },
    onplay: () => {
      isPlayingRef.current = true;
      onPlay?.();
    },
    onend: () => {
      isPlayingRef.current = false;
      onEnd?.();
    },
    onpause: () => {
      onPause?.();
    },
    onstop: () => {
      isPlayingRef.current = false;
      onStop?.();
    }
  }), [volume, playbackRate, loop, interrupt, spriteData, audioFormat, soundUrl, onLoad, onError, onPlay, onEnd, onPause, onStop]);

  // Only initialize use-sound when we have a valid URL
  const shouldInitializeSound = soundUrl && soundUrl.trim() !== '';

  // Use the useSound hook only when we have a valid URL
  const [play, { stop, pause, sound, duration }] = useSound(
    shouldInitializeSound ? soundUrl : '',
    shouldInitializeSound ? soundConfig : undefined
  );

  // Handle audio context and user interaction
  const [audioContextReady, setAudioContextReady] = React.useState(false);

  React.useEffect(() => {
    // Enable audio context on first user interaction
    const enableAudioContext = () => {
      if (sound && sound.ctx && sound.ctx.state === 'suspended') {
        sound.ctx.resume().then(() => {
          console.log('Audio context resumed');
          setAudioContextReady(true);
        }).catch((error) => {
          console.error('Failed to resume audio context:', error);
        });
      } else {
        setAudioContextReady(true);
      }
    };

    // Add listeners for user interaction
    const events = ['click', 'touchstart', 'keydown'];
    events.forEach(event => {
      document.addEventListener(event, enableAudioContext, { once: true });
    });

    return () => {
      events.forEach(event => {
        document.removeEventListener(event, enableAudioContext);
      });
    };
  }, [sound]);

  // Update volume when it changes
  useEffect(() => {
    volumeRef.current = volume;
    if (sound) {
      sound.volume(volume);
    }
  }, [volume, sound]);

  // Update playback rate when it changes
  useEffect(() => {
    if (sound) {
      sound.rate(playbackRate);
    }
  }, [playbackRate, sound]);

  // Update loop when it changes
  useEffect(() => {
    if (sound) {
      sound.loop(loop);
    }
  }, [loop, sound]);

  // Auto play if requested
  useEffect(() => {
    if (autoPlay && soundUrl && play) {
      play();
    }
  }, [autoPlay, soundUrl, play]);

  // Create controls object for the node
  const controls: SoundControls = React.useMemo(() => ({
    play: (options) => {
      if (!shouldInitializeSound) {
        console.warn('Cannot play sound: No URL provided');
        onError?.(new Error('No sound URL provided'));
        return;
      }

      if (!play) {
        console.warn('Cannot play sound: Sound not initialized');
        onError?.(new Error('Sound not initialized'));
        return;
      }

      // Prevent overlapping sounds - don't play if already playing
      if (isPlayingRef.current) {
        console.log('Sound is already playing, ignoring play request');
        return;
      }

      try {
        // Ensure audio context is ready
        if (sound && sound.ctx && sound.ctx.state === 'suspended') {
          sound.ctx.resume().then(() => {
            console.log('Audio context resumed before play');
            if (spriteId && spriteData && spriteData[spriteId]) {
              play({ id: spriteId });
            } else if (options?.id && spriteData && spriteData[options.id]) {
              play({ id: options.id });
            } else {
              play();
            }
          }).catch((error) => {
            console.error('Failed to resume audio context before play:', error);
            onError?.(error);
          });
        } else {
          if (spriteId && spriteData && spriteData[spriteId]) {
            play({ id: spriteId });
          } else if (options?.id && spriteData && spriteData[options.id]) {
            play({ id: options.id });
          } else {
            play();
          }
        }
      } catch (error: any) {
        console.error('Error playing sound:', error);
        onError?.(error);
      }
    },
    stop: () => {
      if (stop) {
        stop();
      }
    },
    pause: () => {
      if (sound) {
        sound.pause();
      }
    },
    isPlaying: () => isPlayingRef.current,
    getDuration: () => duration || null,
    getSound: () => sound
  }), [play, stop, sound, duration, spriteId, spriteData, onError, shouldInitializeSound]);

  // Register controls with the node
  useEffect(() => {
    if (onComponentMount) {
      onComponentMount(controls);
    }

    return () => {
      if (onComponentUnmount) {
        onComponentUnmount();
      }
    };
  }, [controls, onComponentMount, onComponentUnmount]);

  // If no UI is requested, return null
  if (!showControls) {
    return null;
  }

  // Apply layout styles
  let style: React.CSSProperties = { ...props.style };
  Layout.size(style, props);
  Layout.align(style, props);

  // Modern control styles with gradients and shadows
  const controlsStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '16px',
    background: 'linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%)',
    borderRadius: '12px',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1), 0 2px 4px rgba(0, 0, 0, 0.06)',
    border: '1px solid rgba(0, 0, 0, 0.08)',
    fontSize: '14px',
    backdropFilter: 'blur(10px)',
    ...props.controlsStyle
  };

  const getButtonStyle = (isActive: boolean = false, isDisabled: boolean = false, isHovered: boolean = false): React.CSSProperties => ({
    padding: '8px 16px',
    border: 'none',
    borderRadius: '8px',
    background: isActive
      ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
      : 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    color: '#fff',
    cursor: isDisabled ? 'not-allowed' : 'pointer',
    fontSize: '13px',
    fontWeight: '500',
    transition: 'all 0.2s ease',
    boxShadow: isHovered && !isDisabled
      ? (isActive
        ? '0 6px 16px rgba(102, 126, 234, 0.5)'
        : '0 4px 12px rgba(245, 87, 108, 0.4)')
      : (isActive
        ? '0 4px 12px rgba(102, 126, 234, 0.4)'
        : '0 2px 8px rgba(245, 87, 108, 0.3)'),
    opacity: isDisabled ? 0.6 : 1,
    transform: isHovered && !isDisabled ? 'translateY(-1px)' : 'translateY(0)',
  });

  const sliderStyle: React.CSSProperties = {
    width: '100px',
    height: '4px',
    borderRadius: '2px',
    background: '#e9ecef',
    outline: 'none',
    WebkitAppearance: 'none',
    appearance: 'none',
  };

  const sliderThumbStyle: React.CSSProperties = {
    WebkitAppearance: 'none',
    appearance: 'none',
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    cursor: 'pointer',
    border: 'none',
    boxShadow: '0 2px 6px rgba(102, 126, 234, 0.3)',
  };

  const statusStyle: React.CSSProperties = {
    fontSize: '12px',
    fontWeight: '500',
    padding: '4px 8px',
    borderRadius: '6px',
    color: isPlayingRef.current ? '#28a745' : shouldInitializeSound ? '#6c757d' : '#dc3545',
    background: isPlayingRef.current ? '#d4edda' : shouldInitializeSound ? '#f8f9fa' : '#f8d7da',
    border: `1px solid ${isPlayingRef.current ? '#c3e6cb' : shouldInitializeSound ? '#dee2e6' : '#f5c6cb'}`,
    minWidth: '60px',
    textAlign: 'center'
  };

  return (
    <div className={props.className} style={style}>
      <div style={controlsStyle}>
        {/* Play Button */}
        <button
          style={getButtonStyle(isPlayingRef.current, !shouldInitializeSound || !audioContextReady, playHovered)}
          onClick={() => controls.play()}
          disabled={!shouldInitializeSound || !audioContextReady}
          onMouseEnter={() => setPlayHovered(true)}
          onMouseLeave={() => setPlayHovered(false)}
          title={
            !shouldInitializeSound
              ? 'Please set a sound URL first'
              : !audioContextReady
                ? 'Click anywhere to enable audio'
                : isPlayingRef.current
                  ? 'Sound is already playing'
                  : 'Play sound'
          }
        >
          {!shouldInitializeSound ? '🔇 No URL' :
            !audioContextReady ? '🔊 Enable' :
              isPlayingRef.current ? '⏸️ Playing' : '▶️ Play'}
        </button>

        {/* Pause Button */}
        <button
          style={getButtonStyle(false, !isPlayingRef.current, pauseHovered)}
          onClick={() => controls.pause()}
          disabled={!isPlayingRef.current}
          onMouseEnter={() => setPauseHovered(true)}
          onMouseLeave={() => setPauseHovered(false)}
          title="Pause sound"
        >
          ⏸️ Pause
        </button>

        {/* Stop Button */}
        <button
          style={getButtonStyle(false, !isPlayingRef.current, stopHovered)}
          onClick={() => controls.stop()}
          disabled={!isPlayingRef.current}
          onMouseEnter={() => setStopHovered(true)}
          onMouseLeave={() => setStopHovered(false)}
          title="Stop sound"
        >
          ⏹️ Stop
        </button>

        {/* Volume Slider */}
        {showVolumeSlider && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: '500', color: '#495057' }}>
              🔊 {Math.round(volume * 100)}%
            </span>
            <div style={{ position: 'relative' }}>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={volume}
                style={sliderStyle}
                onChange={(e) => {
                  const newVolume = parseFloat(e.target.value);
                  volumeRef.current = newVolume;
                  if (sound) {
                    sound.volume(newVolume);
                  }
                }}
                title={`Volume: ${Math.round(volume * 100)}%`}
              />
              <style>{`
                input[type="range"]::-webkit-slider-thumb {
                  -webkit-appearance: none;
                  appearance: none;
                  width: 16px;
                  height: 16px;
                  border-radius: 50%;
                  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                  cursor: pointer;
                  border: none;
                  box-shadow: 0 2px 6px rgba(102, 126, 234, 0.3);
                }
                input[type="range"]::-moz-range-thumb {
                  width: 16px;
                  height: 16px;
                  border-radius: 50%;
                  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                  cursor: pointer;
                  border: none;
                  box-shadow: 0 2px 6px rgba(102, 126, 234, 0.3);
                }
              `}</style>
            </div>
          </div>
        )}

        {/* Status Indicator */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
          {spriteId && (
            <span style={{
              fontSize: '11px',
              color: '#6c757d',
              background: '#f8f9fa',
              padding: '2px 6px',
              borderRadius: '4px',
              border: '1px solid #dee2e6'
            }}>
              🎵 {spriteId}
            </span>
          )}
          <span style={statusStyle}>
            {isPlayingRef.current ? '🎵 Playing' :
              shouldInitializeSound ? (duration ? `⏱️ ${Math.round(duration / 1000)}s` : '✅ Ready') : '❌ No URL'}
          </span>
        </div>
      </div>

      {/* props.children */}
    </div>
  );
}
