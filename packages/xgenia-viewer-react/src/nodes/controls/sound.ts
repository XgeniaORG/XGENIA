import * as React from 'react';
import { Sound, SoundControls, SoundProps } from '../../components/controls/Sound';
import { createNodeFromReactComponent } from '../../react-component-node';
import { XGENIA } from '../../types';

// Type definitions
interface SoundInternalState {
  soundUrl: string;
  volume: number;
  playbackRate: number;
  loop: boolean;
  interrupt: boolean;
  spriteData: string;
  spriteId: string;
  showControls: boolean;
  showVolumeSlider: boolean;
  autoPlay: boolean;
  isPlaying: boolean;
  isPaused: boolean;
  soundControls: SoundControls | null;
  loadError: Error | null;
}

interface SoundNodeProps extends SoundProps {
  sprite: string;
  spriteId: string;
  showControls: boolean;
  showVolumeSlider: boolean;
}

interface SoundNodeInstance {
  _internal: SoundInternalState;
  props: SoundNodeProps;
  sendSignalOnOutput(signalName: string): void;
  flagOutputDirty(outputName: string): void;
  forceUpdate(): void;
}

interface NodeDefinition {
  name: string;
  docs: string;
  displayName: string;
  category: string;
  usePortAsLabel: string;
  color: string;
  allowChildren: boolean;
  nodeDoubleClickAction: {
    focusPort: string;
  };
  connectionPanel: {
    groupPriority: string[];
  };
  initialize(this: SoundNodeInstance): void;
  getInspectInfo(this: SoundNodeInstance): string;
  inputs: Record<string, any>;
  outputs: Record<string, any>;
  getReactComponent(): (props: SoundNodeProps) => React.ReactElement;
}

// Helper to resolve URLs correctly in both editor and exported builds
function resolveAssetUrl(_url: string): string {
  let url = String(_url || '');

  // `uid://<id>` stable refs resolve via the asset manifest BEFORE the '://' early-return.
  if (url.indexOf('uid://') === 0) {
    const manifest = ((globalThis as any).XGENIA && (globalThis as any).XGENIA.assetsManifest) || null;
    const mapped = manifest && manifest[url.slice(6)];
    if (mapped) url = String(mapped);
    else return url;
  }

  // Absolute or data/blob URLs are returned as is
  if (!url || url.includes('://') || url.startsWith('data:') || url.startsWith('blob:')) {
    return url;
  }

  // @ts-expect-error Global XGENIA provided at runtime
  const envBaseUrl = typeof XGENIA !== 'undefined' && XGENIA && XGENIA.Env && XGENIA.Env['BaseUrl'];
  // @ts-expect-error Global XGENIA provided at runtime
  const runtimeBaseUrl = typeof XGENIA !== 'undefined' && XGENIA && XGENIA.baseUrl;
  const base = (envBaseUrl || runtimeBaseUrl || '') as string;

  // A root-absolute path is the only kind that needs rebasing: '/x.mp3' means the domain root,
  // which is wrong under a sub-path. Rebase it when we know the base, otherwise leave it.
  if (url.startsWith('/')) {
    if (base && base !== '/') return base + url.substring(1);
    return url;
  }

  // ─── a relative path is left relative (2026-09-03) ────────────────────────
  // This used to `return base + url` with `base` defaulting to '/', so a stored
  // 'music.mp3' — which is the shape the project graph actually holds, see any project.json —
  // came out as '/music.mp3'. Root-hosted previews hid it, because there '/music.mp3' and
  // 'music.mp3' are the same file. A deploy under a sub-path is where it breaks: Stake serves
  // games from a nested route, so '/music.mp3' asked the domain root and 404'd, Howler never
  // loaded, and play() was a no-op reporting
  // "[Sound] play() ignored — audio is not loaded: /sigmamusicart-...mp3".
  //
  // Two reasons not to prefix with `base` here either. A relative href already resolves against
  // the document, which is correct for every hosting layout we ship to; and this runs from the
  // `soundUrl` SETTER during graph init, which can be before the inline
  // `XGENIA.Env['BaseUrl'] = ...` script has run — so `base` is not reliably known at this
  // point, and baking in a guess is what produced the bad URL.
  //
  // Image and Video have always behaved this way (rewrite only when the path starts with '/',
  // and only when BaseUrl exists); this brings Sound in line with them.
  return url;
}

const SoundNodeDefinition: NodeDefinition = {
  name: 'Sound',
  docs: 'https://docsapp.xgenia.com/nodes/utilities/sound',
  displayName: 'Sound',
  // (2026-08-25, export 1787621749600) 'Visual', not 'Utilities': this node ships
  // through createNodeFromReactComponent, which registers it category:'Visual' at
  // runtime — it MUST mount in the render tree or soundControls never binds and
  // play()/stop() are silent no-ops. The 'Utilities' literal here leaked into
  // compiled-node-docs and every placement heuristic, which is how detached Sound
  // nodes kept shipping silent games. Keep this equal to the runtime truth.
  category: 'Visual',
  usePortAsLabel: 'soundUrl',
  color: 'purple',
  allowChildren: false,
  nodeDoubleClickAction: {
    focusPort: 'soundUrl'
  },
  connectionPanel: {
    groupPriority: ['General', 'Settings', 'Sprite', 'UI', 'Actions', 'Events']
  },
  initialize: function (this: SoundNodeInstance): void {
    const self = this;
    this._internal = {
      soundUrl: '',
      volume: 1.0,
      playbackRate: 1.0,
      loop: false,
      interrupt: false,
      spriteData: '',
      spriteId: '',
      showControls: false,
      showVolumeSlider: false,
      autoPlay: false,
      isPlaying: false,
      isPaused: false,
      soundControls: null,
      loadError: null
    };

    // Set up React component props
    this.props.soundUrl = '';
    this.props.volume = 1.0;
    this.props.playbackRate = 1.0;
    this.props.loop = false;
    this.props.interrupt = false;
    this.props.sprite = '';
    this.props.spriteId = '';
    this.props.showControls = false;
    this.props.showVolumeSlider = false;
    this.props.autoPlay = false;

    // Set up event callbacks for the React component
    this.props.onPlay = function(): void {
      self._internal.isPlaying = true;
      self._internal.isPaused = false;
      self.sendSignalOnOutput('soundStarted');
      self.flagOutputDirty('isPlaying');
      self.flagOutputDirty('isPaused');
    };

    this.props.onPause = function(): void {
      self._internal.isPaused = true;
      self.sendSignalOnOutput('soundPaused');
      self.flagOutputDirty('isPaused');
    };

    this.props.onStop = function(): void {
      self._internal.isPlaying = false;
      self._internal.isPaused = false;
      self.sendSignalOnOutput('soundStopped');
      self.flagOutputDirty('isPlaying');
      self.flagOutputDirty('isPaused');
    };

    this.props.onEnd = function(): void {
      self._internal.isPlaying = false;
      self._internal.isPaused = false;
      self.sendSignalOnOutput('soundEnded');
      self.flagOutputDirty('isPlaying');
      self.flagOutputDirty('isPaused');
    };

    this.props.onLoad = function(): void {
      self._internal.loadError = null;
      self.sendSignalOnOutput('soundLoaded');
    };

    this.props.onError = function(error: Error): void {
      self._internal.loadError = error;
      self.sendSignalOnOutput('soundError');
    };

    // Handle component mount/unmount to get control references
    this.props.onComponentMount = function(controls: SoundControls): void {
      self._internal.soundControls = controls;
    };

    this.props.onComponentUnmount = function(): void {
      self._internal.soundControls = null;
    };
  },

  getInspectInfo(this: SoundNodeInstance): string {
    if (this._internal.loadError) {
      return 'Error: ' + this._internal.loadError.message;
    }
    if (this._internal.isPlaying) {
      return 'Playing';
    }
    if (this._internal.isPaused) {
      return 'Paused';
    }
    if (this._internal.soundUrl) {
      return 'Ready';
    }
    return 'No sound loaded';
  },

  inputs: {
    play: {
      displayName: 'Play',
      group: 'Actions',
      valueChangedToTrue: function (this: SoundNodeInstance): void {
        if (this._internal.soundControls) {
          this._internal.soundControls.play();
        }
      }
    },

    stop: {
      displayName: 'Stop',
      group: 'Actions',
      valueChangedToTrue: function (this: SoundNodeInstance): void {
        if (this._internal.soundControls) {
          this._internal.soundControls.stop();
        }
      }
    },

    pause: {
      displayName: 'Pause',
      group: 'Actions',
      valueChangedToTrue: function (this: SoundNodeInstance): void {
        if (this._internal.soundControls) {
          this._internal.soundControls.pause();
        }
      }
    },

    soundUrl: {
      type: {
        name: 'audio'
      },
      displayName: 'Sound URL',
      group: 'General',
      default: '',
      set: function (this: SoundNodeInstance, value: string): void {
        this._internal.soundUrl = resolveAssetUrl(value);
        this.props.soundUrl = this._internal.soundUrl;
        this.forceUpdate();
      }
    },

    volume: {
      type: 'number',
      displayName: 'Volume',
      group: 'Settings',
      default: 1.0,
      min: 0,
      max: 1,
      set: function (this: SoundNodeInstance, value: number): void {
        this._internal.volume = Math.max(0, Math.min(1, value));
        this.props.volume = this._internal.volume;
        this.forceUpdate();
      }
    },

    playbackRate: {
      type: 'number',
      displayName: 'Playback Rate',
      group: 'Settings',
      default: 1.0,
      min: 0.1,
      max: 4.0,
      set: function (this: SoundNodeInstance, value: number): void {
        this._internal.playbackRate = Math.max(0.1, Math.min(4.0, value));
        this.props.playbackRate = this._internal.playbackRate;
        this.forceUpdate();
      }
    },

    loop: {
      type: 'boolean',
      displayName: 'Loop',
      group: 'Settings',
      default: false,
      set: function (this: SoundNodeInstance, value: boolean): void {
        this._internal.loop = value;
        this.props.loop = value;
        this.forceUpdate();
      }
    },

    interrupt: {
      type: 'boolean',
      displayName: 'Interrupt',
      group: 'Settings',
      default: false,
      set: function (this: SoundNodeInstance, value: boolean): void {
        this._internal.interrupt = value;
        this.props.interrupt = value;
        this.forceUpdate();
      }
    },

    sprite: {
      type: 'string',
      displayName: 'Sprite Data',
      group: 'Sprite',
      default: '',
      set: function (this: SoundNodeInstance, value: string): void {
        this._internal.spriteData = value;
        this.props.sprite = value;
        this.forceUpdate();
      }
    },

    spriteId: {
      type: 'string',
      displayName: 'Sprite ID',
      group: 'Sprite',
      default: '',
      set: function (this: SoundNodeInstance, value: string): void {
        this._internal.spriteId = value;
        this.props.spriteId = value;
        this.forceUpdate();
      }
    },

    showControls: {
      type: 'boolean',
      displayName: 'Show Controls',
      group: 'UI',
      default: false,
      set: function (this: SoundNodeInstance, value: boolean): void {
        this._internal.showControls = value;
        this.props.showControls = value;
        this.forceUpdate();
      }
    },

    showVolumeSlider: {
      type: 'boolean',
      displayName: 'Show Volume Slider',
      group: 'UI',
      default: false,
      set: function (this: SoundNodeInstance, value: boolean): void {
        this._internal.showVolumeSlider = value;
        this.props.showVolumeSlider = value;
        this.forceUpdate();
      }
    },

    autoPlay: {
      type: 'boolean',
      displayName: 'Auto Play',
      group: 'Settings',
      default: false,
      set: function (this: SoundNodeInstance, value: boolean): void {
        this._internal.autoPlay = value;
        this.props.autoPlay = value;
        this.forceUpdate();
      }
    }
  },

  outputs: {
    soundStarted: {
      type: 'signal',
      displayName: 'Started'
    },
    soundEnded: {
      type: 'signal',
      displayName: 'Ended'
    },
    soundPaused: {
      type: 'signal',
      displayName: 'Paused'
    },
    soundStopped: {
      type: 'signal',
      displayName: 'Stopped'
    },
    soundLoaded: {
      type: 'signal',
      displayName: 'Loaded'
    },
    soundError: {
      type: 'signal',
      displayName: 'Error'
    },
    isPlaying: {
      type: 'boolean',
      displayName: 'Is Playing',
      getter: function(this: SoundNodeInstance): boolean {
        return this._internal.isPlaying;
      }
    },
    isPaused: {
      type: 'boolean',
      displayName: 'Is Paused',
      getter: function(this: SoundNodeInstance): boolean {
        return this._internal.isPaused;
      }
    },
    duration: {
      type: 'number',
      displayName: 'Duration',
      getter: function(this: SoundNodeInstance): number {
        if (this._internal.soundControls) {
          return this._internal.soundControls.getDuration() || 0;
        }
        return 0;
      }
    },
    currentVolume: {
      type: 'number',
      displayName: 'Current Volume',
      getter: function(this: SoundNodeInstance): number {
        return this._internal.volume;
      }
    },
    currentPlaybackRate: {
      type: 'number',
      displayName: 'Current Playback Rate',
      getter: function(this: SoundNodeInstance): number {
        return this._internal.playbackRate;
      }
    }
  },

  getReactComponent(): (props: SoundNodeProps) => React.ReactElement {
    return function SoundComponent(props: SoundNodeProps): React.ReactElement {
      return React.createElement(Sound, props);
    };
  }
};

// Export using createNodeFromReactComponent
export default createNodeFromReactComponent(SoundNodeDefinition);
