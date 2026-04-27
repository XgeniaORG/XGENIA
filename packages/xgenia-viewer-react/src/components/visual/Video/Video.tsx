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
}

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

  constructor(props: VideoProps) {
    super(props);

    this.wantToPlay = false;
    this.canPlay = false;
  }

  componentWillUnmount() {
    this.canPlay = false;
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
          this.video = video;
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
