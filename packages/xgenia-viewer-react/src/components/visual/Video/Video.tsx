import React from 'react';

import Layout from '../../../layout';
import PointerListeners from '../../../pointerlisteners';
import { XGENIA } from '../../../types';

export interface VideoProps extends XGENIA.ReactProps {
  objectPositionX: string;
  objectPositionY: string;

  dom: Exclude<CachedVideoProps, 'innerRef' | 'onCanPlay'>;

  onCanPlay?: () => void;
  videoWidth?: (value: number) => void;
  videoHeight?: (value: number) => void;
  onVideoElementCreated?: (video) => void;

  // Playback outputs, driven by the element's media events (see attachMediaListeners).
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: () => void;
  onTimeUpdate?: (seconds: number) => void;
  duration?: (seconds: number) => void;
  isPlaying?: (playing: boolean) => void;
}

// Playback Position updates at most this often. `timeupdate` fires every
// 15–250 ms depending on the browser; pause, end and seek still report the exact
// position straight away.
const TIME_UPDATE_MIN_INTERVAL_MS = 250;

const MEDIA_EVENTS = [
  'play',
  'playing',
  'pause',
  'ended',
  'timeupdate',
  'seeked',
  'loadedmetadata',
  'durationchange',
  'emptied'
] as const;

export interface CachedVideoProps {
  className?: string;
  style?: React.CSSProperties;

  muted?: boolean;
  loop?: boolean;
  volume?: number;
  autoplay?: boolean;
  controls?: boolean;
  src: string;

  innerRef: (video: HTMLVideoElement) => void;
  onCanPlay: () => void;
}

class CachedVideo extends React.PureComponent<CachedVideoProps> {
  video!: HTMLVideoElement | HTMLImageElement;

  isBase64String(str: string): boolean {
    // Basic check for base64 string:
    // - Contains only base64 characters (A-Z, a-z, 0-9, +, /, =)
    // - Length is divisible by 4 when padding is considered
    // - Minimum reasonable length for video data
    const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
    return str.length > 100 && str.length % 4 === 0 && base64Regex.test(str);
  }

  componentDidUpdate() {
    if (this.video instanceof HTMLVideoElement) {
      this.video.muted = this.props.muted ?? false;
      this.video.loop = this.props.loop ?? false;
      this.video.volume = this.props.volume ?? 1;
      this.video.autoplay = this.props.autoplay ?? false;
      this.video.controls = this.props.controls ?? false;
    }
  }

  render() {
    let src = this.props.src ? this.props.src.toString() : undefined;

    const isWebP = src && (src.toString().toLowerCase().includes('.webp') || src.toString().startsWith('data:image/webp') || (this.isBase64String(src) && src.toString().startsWith('UklGR')));

    if (src) {
      // Handle base64 videos (data: URLs) - use as-is, no modification needed
      if (src.startsWith('data:')) {
        // Base64 video with data URL prefix, no further processing required
      }
      // Handle pure base64 strings (without data: prefix)
      else if (this.isBase64String(src)) {
        // Convert pure base64 to data URL - Detect WebP vs MP4
        if (src.startsWith('UklGR')) {
          src = `data:image/webp;base64,${src}`;
        } else {
          src = `data:video/mp4;base64,${src}`;
        }
      }
      // Handle relative URLs
      else if (src.startsWith('/')) {
        // @ts-expect-error missing XGENIA typings
        const baseUrl = XGENIA.Env && XGENIA.Env['BaseUrl'];
        if (baseUrl) {
          src = baseUrl + src.substring(1);
        }
        // Add time fragment for Android compatibility (Videos only)
        if (!isWebP && src.indexOf('#t=') === -1) {
          src += '#t=0.01'; //force Android to render the first frame
        }
      }
      // Handle absolute URLs (http, https, etc.)
      else {
        // Add time fragment for Android compatibility (Videos only)
        if (!isWebP && src.indexOf('#t=') === -1) {
          src += '#t=0.01'; //force Android to render the first frame
        }
      }
    }

    // Destructure props to separate DOM-valid attributes from React-specific props
    const { autoplay, innerRef, onCanPlay, className, style, muted, loop, volume, controls, ...otherProps } = this.props;

    // Build common props for both video and img
    const commonProps = {
      className,
      style,
      src: src,
      ...PointerListeners(this.props),
      ref: (el) => {
        if (el) {
          this.video = el as any;
          if (el instanceof HTMLVideoElement) {
            el.volume = volume ?? 1;
          }
          innerRef(el as any);
          
          // Image doesn't have oncanplay, so we trigger it manually on load
          if (el instanceof HTMLImageElement) {
              if (el.complete) {
                  onCanPlay();
              } else {
                  el.onload = onCanPlay;
              }
          }
        }
      }
    };

    if (isWebP) {
        return <img {...commonProps} />;
    }

    // Build proper HTML5 video props with correct camelCase naming
    const videoProps = {
      ...commonProps,
      playsInline: true,
      muted: muted ?? false,
      loop: loop ?? false,
      autoPlay: autoplay ?? false, // Fix: autoplay → autoPlay
      controls: controls ?? false,
      onCanPlay: onCanPlay
    };

    return <video {...videoProps} />;
  }
}

export class Video extends React.Component<VideoProps> {
  wantToPlay: boolean;
  canPlay: boolean;
  video!: HTMLVideoElement | HTMLImageElement;

  private mediaElement: HTMLVideoElement | null = null;
  private lastTimeUpdateAt = -Infinity;
  private lastIsPlaying: boolean | undefined = undefined;

  constructor(props: VideoProps) {
    super(props);

    this.wantToPlay = false;
    this.canPlay = false;
  }

  componentWillUnmount() {
    this.canPlay = false;
    this.detachMediaListeners();
  }

  // Called with the element on every render (the ref callback is recreated each
  // time), so subscribe only when the element actually changes. An animated
  // WebP renders as <img>, which has no media events — nothing to subscribe.
  setVideoElement(video: HTMLVideoElement | HTMLImageElement) {
    this.video = video;
    const media = video instanceof HTMLVideoElement ? video : null;
    if (media === this.mediaElement) return;
    this.detachMediaListeners();
    if (media) this.attachMediaListeners(media);
  }

  private attachMediaListeners(media: HTMLVideoElement) {
    this.mediaElement = media;
    this.lastTimeUpdateAt = -Infinity;
    this.lastIsPlaying = undefined;
    for (const type of MEDIA_EVENTS) media.addEventListener(type, this.handleMediaEvent);
  }

  private detachMediaListeners() {
    const media = this.mediaElement;
    if (!media) return;
    for (const type of MEDIA_EVENTS) media.removeEventListener(type, this.handleMediaEvent);
    this.mediaElement = null;
  }

  private handleMediaEvent = (event: Event) => {
    const media = this.mediaElement;
    if (!media || event.target !== media) return;

    switch (event.type) {
      case 'play':
        this.reportIsPlaying(media);
        this.props.onPlay && this.props.onPlay();
        break;
      case 'playing':
      case 'emptied':
        this.reportIsPlaying(media);
        break;
      case 'pause':
        this.reportCurrentTime(media, true);
        this.reportIsPlaying(media);
        // Reaching the end pauses the element first; that is On Ended, not On Pause.
        if (!media.ended) this.props.onPause && this.props.onPause();
        break;
      case 'ended':
        // Browsers don't fire `ended` while `loop` is on (the element seeks back
        // to the start instead); guard anyway so a loop never reports an end.
        if (media.loop) return;
        this.reportCurrentTime(media, true);
        this.reportIsPlaying(media);
        this.props.onEnded && this.props.onEnded();
        break;
      case 'timeupdate':
        this.reportCurrentTime(media, false);
        break;
      case 'seeked':
        this.reportCurrentTime(media, true);
        break;
      case 'loadedmetadata':
      case 'durationchange':
        this.reportDuration(media);
        break;
    }
  };

  private reportCurrentTime(media: HTMLVideoElement, force: boolean) {
    if (!this.props.onTimeUpdate) return;
    const now = Date.now();
    if (!force && now - this.lastTimeUpdateAt < TIME_UPDATE_MIN_INTERVAL_MS) return;
    this.lastTimeUpdateAt = now;
    this.props.onTimeUpdate(media.currentTime);
  }

  private reportDuration(media: HTMLVideoElement) {
    // NaN before metadata, Infinity for a live stream: report 0 for "not known".
    const duration = Number.isFinite(media.duration) ? media.duration : 0;
    this.props.duration && this.props.duration(duration);
  }

  private reportIsPlaying(media: HTMLVideoElement) {
    const playing = !media.paused && !media.ended;
    if (playing === this.lastIsPlaying) return;
    this.lastIsPlaying = playing;
    this.props.isPlaying && this.props.isPlaying(playing);
  }

  setSourceObject(src) {
    if (this.video instanceof HTMLVideoElement && this.video.srcObject !== src) {
      this.video.srcObject = src;
      this.canPlay = false; //wait for can play event
    }
  }

  play() {
    this.wantToPlay = true;
    if (this.canPlay && this.video instanceof HTMLVideoElement) {
      this.video.play().catch(() => {});
    }
  }

  restart() {
    this.wantToPlay = true;
    if (this.canPlay) {
      if (this.video instanceof HTMLVideoElement) {
          this.video.currentTime = 0;
          this.video.play().catch(() => {});
      } else if (this.video instanceof HTMLImageElement) {
          // Restarting an animated GIF/WebP is tricky, usually requires re-assigning src
          const currentSrc = this.video.src;
          this.video.src = '';
          this.video.src = currentSrc;
      }
    }
  }

  pause() {
    this.wantToPlay = false;
    if (this.video && this.video instanceof HTMLVideoElement) {
        this.video.pause();
    }
  }

  reset() {
    this.wantToPlay = false;
    if (this.video) {
      if (this.video instanceof HTMLVideoElement) {
          this.video.currentTime = 0;
          this.video.pause();
      } else if (this.video instanceof HTMLImageElement) {
          // No easy way to 'reset' an image without re-loading
      }
    }
  }

  render() {
    const props = this.props;
    const style = {
      ...props.style
    };

    Layout.size(style, props);
    Layout.align(style, props);

    if (style.opacity === 0) {
      style.pointerEvents = 'none';
    }

    style.objectPosition = `${props.objectPositionX} ${props.objectPositionY}`;

    return (
      <CachedVideo
        {...props.dom}
        className={props.className}
        style={style}
        innerRef={(video) => {
          this.setVideoElement(video);
          if (this.props.onVideoElementCreated && video) {
            this.props.onVideoElementCreated(video);
          }
        }}
        onCanPlay={() => {
          this.canPlay = true;
          if (this.video instanceof HTMLVideoElement) {
            if (this.wantToPlay) {
              this.video.play().catch(() => {});
            }
            this.props.videoWidth && this.props.videoWidth(this.video.videoWidth);
            this.props.videoHeight && this.props.videoHeight(this.video.videoHeight);
          } else if (this.video instanceof HTMLImageElement) {
            this.props.videoWidth && this.props.videoWidth(this.video.naturalWidth);
            this.props.videoHeight && this.props.videoHeight(this.video.naturalHeight);
          }
          this.props.onCanPlay && this.props.onCanPlay();
        }}
      />
    );
  }
}
