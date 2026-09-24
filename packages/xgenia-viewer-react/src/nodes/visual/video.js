import { getAbsoluteUrl } from '@xgenia/runtime/src/utils';

import { Video } from '../../components/visual/Video';
import NodeSharedPortDefinitions from '../../node-shared-port-definitions';
import { createNodeFromReactComponent } from '../../react-component-node';

const VideoNode = {
  name: 'Video',
  docs: 'https://docsapp.xgenia.com/nodes/basic-elements/video',
  connectionPanel: {
    groupPriority: [
      'General',
      'Video',
      'Video Actions',
      'Style',
      'Actions',
      'Events',
      'Mounted',
      'Playback',
      'Pointer Events',
      'Hover Events',
      'Dimensions',
      'Margin and padding'
    ]
  },
  getReactComponent() {
    return Video;
  },
  allowChildren: false,
  xgeniaNodeAsProp: true,
  outputs: {
    nodeReference: {
      displayName: 'Node Reference',
      group: 'General',
      type: 'node',
      getter: function() {
        return this;
      }
    }
  },
  defaultCss: {
    display: 'block'
  },
  inputs: {
    srcObject: {
      displayName: 'Source Object',
      group: 'Video',
      type: 'mediastream',
      default: null,
      set(value) {
        this.innerReactComponentRef && this.innerReactComponentRef.setSourceObject(value);
      }
    },
    play: {
      type: 'signal',
      group: 'Video Actions',
      displayName: 'Play',
      tooltip: {
        standard: 'Play the video'
      },
      valueChangedToTrue() {
        this.innerReactComponentRef && this.innerReactComponentRef.play();
      }
    },
    restart: {
      type: 'signal',
      group: 'Video Actions',
      displayName: 'Restart',
      tooltip: {
        standard: 'Restart the video from the beginning'
      },
      valueChangedToTrue() {
        this.innerReactComponentRef && this.innerReactComponentRef.restart();
      }
    },
    pause: {
      type: 'boolean',
      group: 'Video Actions',
      displayName: 'Pause',
      valueChangedToTrue() {
        this.innerReactComponentRef && this.innerReactComponentRef.pause();
      }
    },
    reset: {
      type: 'boolean',
      group: 'Video Actions',
      displayName: 'Reset',
      valueChangedToTrue() {
        this.innerReactComponentRef && this.innerReactComponentRef.reset();
      }
    },
    src: {
      displayName: 'Source',
      group: 'Video',
      type: 'string',
      set(src) {
        this.props.dom.src = getAbsoluteUrl(src);
        this.forceUpdate();
      }
    },
    poster: {
      displayName: 'Poster',
      group: 'Video',
      type: 'image',
      set(src) {
        this.props.dom.poster = getAbsoluteUrl(src);
        this.forceUpdate();
      }
    }
  },
  inputProps: {
    autoplay: {
      displayName: 'Autoplay',
      propPath: 'dom',
      group: 'Video',
      type: 'boolean'
    },
    controls: {
      displayName: 'Controls',
      propPath: 'dom',
      group: 'Video',
      type: 'boolean'
    },
    volume: {
      displayName: 'Volume',
      propPath: 'dom',
      group: 'Video',
      type: 'number',
      default: 1
    },
    muted: {
      displayName: 'Muted',
      propPath: 'dom',
      group: 'Video',
      type: 'boolean'
    },
    loop: {
      displayName: 'Loop',
      propPath: 'dom',
      group: 'Video',
      type: 'boolean'
    },
    objectPositionX: {
      displayName: 'Video Position X',
      group: 'Video Layout',
      type: {
        name: 'number',
        units: ['%', 'px'],
        defaultUnit: '%'
      },
      default: 50
    },
    objectPositionY: {
      displayName: 'Video Position Y',
      group: 'Video Layout',
      type: {
        name: 'number',
        units: ['%', 'px'],
        defaultUnit: '%'
      },
      default: 50
    }
  },
  inputCss: {
    objectFit: {
      displayName: 'Object Fit',
      group: 'Video Layout',
      type: {
        name: 'enum',
        enums: [
          {
            label: 'Contain',
            value: 'contain'
          },
          {
            label: 'Cover',
            value: 'cover'
          },
          {
            label: 'Fill',
            value: 'fill'
          },
          {
            label: 'None',
            value: 'none'
          }
        ]
      },
      default: 'contain'
    }
  },
  outputProps: {
    onCanPlay: {
      type: 'signal',
      group: 'Events',
      displayName: 'On Can Play'
    },
    // Playback outputs are driven by the Video component's media-event listeners,
    // not by props on the <video> element.
    onPlay: {
      group: 'Playback',
      displayName: 'On Play',
      type: 'signal',
      tooltip: {
        standard: 'Sent when playback starts or resumes'
      }
    },
    onPause: {
      group: 'Playback',
      displayName: 'On Pause',
      type: 'signal',
      tooltip: {
        standard: 'Sent when playback is paused before the end. Reaching the end sends On Ended instead'
      }
    },
    onEnded: {
      group: 'Playback',
      displayName: 'On Ended',
      type: 'signal',
      tooltip: {
        standard:
          'Sent once when the video plays to its end. Never sent while Loop is on (the video restarts instead). Not sent for animated WebP sources'
      }
    },
    onTimeUpdate: {
      group: 'Playback',
      displayName: 'Playback Position',
      type: 'number',
      tooltip: {
        standard: 'Current time in seconds. Updates at most 4 times a second, and immediately on pause, end and seek'
      }
    },
    duration: {
      group: 'Playback',
      displayName: 'Duration',
      type: 'number',
      tooltip: {
        standard: 'Length of the video in seconds, set once its metadata loads. 0 while unknown or for a live stream'
      }
    },
    isPlaying: {
      group: 'Playback',
      displayName: 'Is Playing',
      type: 'boolean',
      tooltip: {
        standard: 'True while the video is playing; false when paused or ended'
      }
    },
    onVideoElementCreated: {
      type: 'domelement',
      displayName: 'DOM Element'
    },
    videoWidth: {
      group: 'Playback',
      type: 'number',
      displayName: 'Video Width'
    },
    videoHeight: {
      group: 'Playback',
      type: 'number',
      displayName: 'Video Height'
    }
  }
};

NodeSharedPortDefinitions.addDimensions(VideoNode, {
  defaultSizeMode: 'contentSize',
  contentLabel: 'Video'
});
NodeSharedPortDefinitions.addTransformInputs(VideoNode);
NodeSharedPortDefinitions.addMarginInputs(VideoNode);
NodeSharedPortDefinitions.addSharedVisualInputs(VideoNode);
NodeSharedPortDefinitions.addAlignInputs(VideoNode);
NodeSharedPortDefinitions.addPointerEventOutputs(VideoNode);
NodeSharedPortDefinitions.addBorderInputs(VideoNode);

export default createNodeFromReactComponent(VideoNode);
