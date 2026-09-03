import React, { useCallback, useEffect, useRef, useState } from 'react';
import useSound from 'use-sound';

import Layout from '../../../layout';
import Utils from '../../../nodes/controls/utils';
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

/** The imperative surface the audio engine hands back to the outer component. */
interface EngineApi {
  play: (id?: string) => void;
  stop: () => void;
  pause: () => void;
  getSound: () => any;
  getDuration: () => number | null;
}

/** Stable per-instance suffix for the scoped stylesheet. React ids are not needed here. */
let instanceCounter = 0;

/**
 * Strip query and hash before looking at the extension.
 *
 * Deployed builds append cache-busters, and `'a.m4a?v=3'.split('.').pop()` is `'m4a?v=3'`,
 * which matches no case and fell through to the `['mp3','wav','ogg']` guess. Handing Howler a
 * format list that does not include the real one makes it refuse the file outright, so the
 * guess turned a working sound into a silent one the moment a version suffix appeared.
 */
function audioFormatsFor(url: string): string[] | undefined {
  if (!url) return undefined;

  const clean = url.split(/[?#]/)[0];
  const dot = clean.lastIndexOf('.');
  if (dot < 0) return undefined;

  const ext = clean.substring(dot + 1).toLowerCase();
  switch (ext) {
    case 'mp3':
    case 'wav':
    case 'ogg':
    case 'flac':
    case 'wma':
    case 'webm':
      return [ext];
    case 'm4a':
    case 'aac':
      return ['m4a', 'aac'];
    default:
      // Unknown extension: say nothing rather than guessing. Howler falls back to its own
      // detection, which is right more often than a hardcoded list.
      return undefined;
  }
}

interface SoundEngineProps {
  /** Already non-empty and already resolved by the node. */
  soundUrl: string;
  volume: number;
  playbackRate: number;
  loop: boolean;
  interrupt: boolean;
  spriteData?: Record<string, any>;
  autoPlay: boolean;
  apiRef: React.RefObject<EngineApi | null>;
  onPlayingChange: (playing: boolean) => void;
  onDurationChange: (duration: number | null) => void;
  onLoadedChange: (loaded: boolean) => void;
  handlers: React.RefObject<{
    onPlay?: () => void;
    onPause?: () => void;
    onStop?: () => void;
    onEnd?: () => void;
    onLoad?: () => void;
    onError?: (error: any) => void;
  }>;
}

/**
 * The audio half, mounted ONLY when there is a URL and remounted (via `key`) when it changes.
 *
 * ─── why this is a separate component (2026-09-03) ──────────────────────────
 * `useSound` was previously called from the main component with `shouldInitializeSound ?
 * soundUrl : ''`, and that made the node permanently silent in exported builds.
 *
 * In use-sound 5.0.0, `sound` is set ONLY from Howler's `onload` callback, and every one of
 * `play`/`stop`/`pause` opens with `if (!sound) return;` — a silent no-op. Its src-change
 * effect is guarded by `if (HowlConstructor.current && sound)`, so it can only rebuild an
 * instance that already loaded once. Therefore ANY failure of the FIRST load is permanent and
 * silent, and a later correct URL can never recover it.
 *
 * The node guarantees that first failure: `initialize()` in nodes/controls/sound.ts sets
 * `this.props.soundUrl = ''`, so the component always mounted with an empty src. Howler failed
 * on `['']`, `sound` stayed null, and when the real URL arrived through the `soundUrl` setter
 * the guard above dropped it. Play did nothing, forever, with nothing logged. The same trap
 * catches a genuine 404 — a wrong path after Stake's asset flattening, or a bad BaseUrl — which
 * is why this reproduced on both deploy targets while often appearing to work in the editor,
 * where the node is re-created (and so remounted) as you edit it.
 *
 * Mounting per-URL means the hook only ever sees a real src, and each URL gets a fresh Howl.
 */
function SoundEngine({
  soundUrl,
  volume,
  playbackRate,
  loop,
  interrupt,
  spriteData,
  autoPlay,
  apiRef,
  onPlayingChange,
  onDurationChange,
  onLoadedChange,
  handlers
}: SoundEngineProps) {
  // Read through a ref so the Howl is never rebuilt just because the node handed down a fresh
  // closure. The node calls forceUpdate() on every parameter change, so these identities churn.
  const [play, { stop, pause, sound, duration }] = useSound(soundUrl, {
    volume,
    playbackRate,
    loop,
    interrupt,
    sprite: spriteData,
    format: audioFormatsFor(soundUrl),
    html5: true,
    preload: true,
    onload: () => {
      onLoadedChange(true);
      handlers.current.onLoad?.();
    },
    onloaderror: (_id: any, error: any) => {
      // Loud, and with the URL: the whole class of bug above was invisible because a failed
      // load looked identical to a sound nobody had triggered yet.
      console.error('[Sound] Failed to load audio:', soundUrl, error);
      onLoadedChange(false);
      handlers.current.onError?.(error);
    },
    onplay: () => {
      onPlayingChange(true);
      handlers.current.onPlay?.();
    },
    onend: () => {
      // Howler does not fire `end` for a looping sound, so this is a real stop.
      onPlayingChange(false);
      handlers.current.onEnd?.();
    },
    onpause: () => {
      onPlayingChange(false);
      handlers.current.onPause?.();
    },
    onstop: () => {
      onPlayingChange(false);
      handlers.current.onStop?.();
    }
  });

  useEffect(() => {
    onDurationChange(duration ?? null);
  }, [duration, onDurationChange]);

  // Howler applies `loop` at construction, and use-sound only forwards volume and rate on
  // change, so loop has to be pushed by hand.
  useEffect(() => {
    if (sound) sound.loop(loop);
  }, [sound, loop]);

  /**
   * Resume a suspended AudioContext, then run the action.
   *
   * Browsers start the context suspended until a user gesture. Calling this from inside a click
   * handler keeps us within that gesture, which is what makes the resume succeed.
   */
  const withAudioContext = useCallback(
    (action: () => void) => {
      const ctx = sound?.ctx;
      if (ctx && ctx.state === 'suspended') {
        ctx
          .resume()
          .then(action)
          .catch((error: any) => {
            console.error('[Sound] Could not resume the audio context:', error);
            handlers.current.onError?.(error);
          });
        return;
      }
      action();
    },
    [sound, handlers]
  );

  // Publish the imperative API upward. Written to a ref, so the node's `controls` object keeps a
  // stable identity and does not re-register on every render.
  useEffect(() => {
    apiRef.current = {
      play: (id?: string) => {
        if (!sound) {
          // Reachable while the file is still loading, and after a load error.
          console.warn('[Sound] play() ignored — audio is not loaded:', soundUrl);
          return;
        }
        withAudioContext(() => {
          if (id && spriteData && spriteData[id]) play({ id });
          else play();
        });
      },
      stop: () => stop(),
      pause: () => pause(),
      getSound: () => sound,
      getDuration: () => duration ?? null
    };

    return () => {
      apiRef.current = null;
    };
  }, [apiRef, play, stop, pause, sound, duration, spriteData, soundUrl, withAudioContext]);

  // Autoplay once the file is actually loaded. Before this, `play()` was called as soon as a URL
  // existed, which is exactly when `sound` is still null and play is a no-op.
  const autoPlayedRef = useRef(false);
  useEffect(() => {
    if (!autoPlay || !sound || autoPlayedRef.current) return;
    autoPlayedRef.current = true;
    apiRef.current?.play();
  }, [autoPlay, sound, apiRef]);

  return null;
}

/** Scoped thumb styling, so this node cannot restyle other sliders in the app. */
function _styleTemplate(_class: string, props: { thumbColor: string }) {
  return `.${_class}::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 12px;
  height: 12px;
  border: none;
  border-radius: 50%;
  background: ${props.thumbColor};
  cursor: pointer;
}
.${_class}::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border: none;
  border-radius: 50%;
  background: ${props.thumbColor};
  cursor: pointer;
}`;
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
    onComponentMount,
    onComponentUnmount
  } = props;

  const engineRef = useRef<EngineApi | null>(null);
  const isPlayingRef = useRef(false);

  /**
   * Playback state as STATE, not only a ref.
   *
   * It used to live solely in `isPlayingRef`, and the render read `isPlayingRef.current` for the
   * status text, the Play label and the `disabled` of Pause and Stop. A ref write does not
   * re-render, so the controls were frozen in their mount-time state: Pause and Stop rendered
   * `disabled={!false}` once and never became clickable, and the status never left "Ready" even
   * while audio played. The ref is kept alongside because the node's `isPlaying()` control reads
   * it synchronously, where a state value would be a render behind.
   */
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  const setPlaying = useCallback((playing: boolean) => {
    isPlayingRef.current = playing;
    setIsPlaying(playing);
  }, []);

  // The node replaces these on every forceUpdate(). Holding them in a ref keeps them current
  // without making them a reason to rebuild the Howl.
  const handlersRef = useRef({
    onPlay: props.onPlay,
    onPause: props.onPause,
    onStop: props.onStop,
    onEnd: props.onEnd,
    onLoad: props.onLoad,
    onError: props.onError
  });
  handlersRef.current = {
    onPlay: props.onPlay,
    onPause: props.onPause,
    onStop: props.onStop,
    onEnd: props.onEnd,
    onLoad: props.onLoad,
    onError: props.onError
  };

  const spriteData = React.useMemo(() => {
    if (!sprite) return undefined;
    try {
      return JSON.parse(sprite);
    } catch (e: any) {
      console.error('[Sound] Invalid sprite data:', e);
      return undefined;
    }
  }, [sprite]);

  const url = typeof soundUrl === 'string' ? soundUrl.trim() : '';
  const hasUrl = url !== '';

  /**
   * The node's control surface. Deliberately built once.
   *
   * Every method reaches through `engineRef`, so this object's identity never changes and the
   * registration effect below runs exactly on mount and unmount. It used to depend on
   * `[controls, onComponentMount, onComponentUnmount]`, where `controls` was rebuilt whenever
   * the sound instance changed and the two callbacks are fresh closures from the node — so the
   * node was re-registered on almost every render.
   */
  // Read at call time so a re-configured spriteId is honoured without rebuilding `controls`.
  const spriteIdRef = useRef(spriteId);
  spriteIdRef.current = spriteId;

  const controlsRef = useRef<SoundControls | null>(null);
  if (!controlsRef.current) {
    controlsRef.current = {
      play: (options) => {
        const engine = engineRef.current;
        if (!engine) {
          console.warn('[Sound] play() ignored — no sound URL is set.');
          handlersRef.current.onError?.(new Error('No sound URL provided'));
          return;
        }
        engine.play(options?.id ?? spriteIdRef.current);
      },
      stop: () => engineRef.current?.stop(),
      pause: () => engineRef.current?.pause(),
      isPlaying: () => isPlayingRef.current,
      getDuration: () => engineRef.current?.getDuration() ?? null,
      getSound: () => engineRef.current?.getSound() ?? null
    };
  }

  useEffect(() => {
    const controls = controlsRef.current!;
    onComponentMount?.(controls);
    return () => {
      onComponentUnmount?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Local volume so the slider can actually move. It was `value={volume}` with an onChange that
  // only wrote a ref, i.e. a controlled input whose value never changed — it snapped straight
  // back on every drag.
  const [uiVolume, setUiVolume] = useState(volume);
  useEffect(() => {
    setUiVolume(volume);
  }, [volume]);

  const instanceIdRef = useRef<string>('');
  if (!instanceIdRef.current) {
    instanceIdRef.current = `ndl-controls-sound-${++instanceCounter}`;
  }

  const engine = hasUrl ? (
    <SoundEngine
      // A new URL means a new Howl. See the note on SoundEngine: use-sound cannot swap the src
      // of an instance that never loaded, so remounting is the only reliable path.
      key={url}
      soundUrl={url}
      volume={uiVolume}
      playbackRate={playbackRate}
      loop={loop}
      interrupt={interrupt}
      spriteData={spriteData}
      autoPlay={autoPlay}
      apiRef={engineRef}
      onPlayingChange={setPlaying}
      onDurationChange={setDuration}
      onLoadedChange={setLoaded}
      handlers={handlersRef}
    />
  ) : null;

  // No UI requested: the audio still has to mount, it just renders nothing visible.
  if (!showControls) {
    return engine;
  }

  const style: React.CSSProperties = { ...props.style };
  Layout.size(style, props);
  Layout.align(style, props);

  const thumbColor = '#6b7280';
  const sliderClass = instanceIdRef.current;
  Utils.updateStylesForClass(sliderClass, { thumbColor }, _styleTemplate);

  /**
   * Neutral, and overridable through `controlsStyle`.
   *
   * The previous styling was a white card with pink-to-red and purple-to-indigo gradient
   * buttons, drop shadows and a backdrop blur — invented here and matching nothing else in the
   * viewer, where controls take their appearance from author-set props (see Button, Slider).
   * These are developer controls surfaced inside someone's game, so they stay quiet.
   */
  const barStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 8px',
    background: '#f5f5f5',
    border: '1px solid #d4d4d4',
    borderRadius: '4px',
    fontFamily: 'inherit',
    fontSize: '12px',
    lineHeight: 1.4,
    color: '#262626',
    boxSizing: 'border-box',
    ...props.controlsStyle
  };

  const buttonStyle = (disabled: boolean): React.CSSProperties => ({
    padding: '4px 10px',
    border: '1px solid #d4d4d4',
    borderRadius: '3px',
    background: disabled ? '#ebebeb' : '#ffffff',
    color: disabled ? '#a3a3a3' : '#262626',
    cursor: disabled ? 'default' : 'pointer',
    font: 'inherit',
    boxSizing: 'border-box'
  });

  const statusText = !hasUrl
    ? 'No URL'
    : !loaded
      ? 'Loading…'
      : isPlaying
        ? 'Playing'
        : duration
          ? `${Math.round(duration / 1000)}s`
          : 'Ready';

  return (
    <div className={props.className} style={style}>
      {engine}
      <div style={barStyle}>
        <button
          type="button"
          style={buttonStyle(!hasUrl)}
          // NOT disabled on "audio context not ready" any more. The context is resumed inside
          // this handler, which is the user gesture that permits it — and a disabled button
          // emits no click, so the old gate could never be satisfied by pressing Play. The
          // button sat disabled behind "Click anywhere to enable audio" until the user happened
          // to click something else first.
          disabled={!hasUrl}
          onClick={() => controlsRef.current?.play()}
          title={hasUrl ? 'Play' : 'Set a sound URL first'}
        >
          Play
        </button>

        <button
          type="button"
          style={buttonStyle(!isPlaying)}
          disabled={!isPlaying}
          onClick={() => controlsRef.current?.pause()}
          title="Pause"
        >
          Pause
        </button>

        <button
          type="button"
          style={buttonStyle(!isPlaying)}
          disabled={!isPlaying}
          onClick={() => controlsRef.current?.stop()}
          title="Stop"
        >
          Stop
        </button>

        {showVolumeSlider && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ color: '#525252' }}>{Math.round(uiVolume * 100)}%</span>
            <input
              className={sliderClass}
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={uiVolume}
              style={{
                width: '80px',
                height: '4px',
                borderRadius: '2px',
                background: '#d4d4d4',
                outline: 'none',
                WebkitAppearance: 'none',
                appearance: 'none'
              }}
              onChange={(e) => {
                const next = parseFloat(e.target.value);
                setUiVolume(next);
                engineRef.current?.getSound()?.volume(next);
              }}
              title={`Volume: ${Math.round(uiVolume * 100)}%`}
            />
          </label>
        )}

        {spriteId && <span style={{ color: '#525252' }}>{spriteId}</span>}
        <span style={{ color: '#525252' }}>{statusText}</span>
      </div>
    </div>
  );
}
