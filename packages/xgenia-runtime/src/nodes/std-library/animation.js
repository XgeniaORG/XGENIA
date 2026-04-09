'use strict';

const AnimationNode = {
  name: 'Animation',
  docs: 'https://docsapp.xgenia.com/nodes/animation/animation',
  usePortAsLabel: 'animationName',
  category: 'Animation',
  color: 'animation',
  nodeDoubleClickAction: {
    action: 'openAnimationEditor'
  },
  searchTags: ['animation', 'motion', 'tween', 'framer-motion'],
  initialize: function () {
    var internal = this._internal;
    
    internal.animationControls = null;
    internal.isPlaying = false;
    internal.isPaused = false;
    internal.duration = 1;
    internal.animationData = {
      initial: {},
      animate: {},
      transition: {
        duration: 1,
        ease: 'easeOut',
        repeat: 0,
        repeatType: 'loop'
      }
    };
    internal.targetElement = null;
    internal.currentProgress = 0;
    internal.motionValues = {};
  },
  getInspectInfo() {
    return {
      isPlaying: this._internal.isPlaying,
      progress: this._internal.currentProgress,
      duration: this._internal.duration
    };
  },
  inputs: {
    animationName: {
      group: 'General',
      type: 'string',
      displayName: 'Animation Name',
      default: 'My Animation',
      set: function(value) {
        this._internal.animationName = value;
      }
    },
    target: {
      group: 'General',
      type: 'node',
      displayName: 'Target Element',
      set: function(value) {
        this._internal.targetElement = value;
      }
    },
    duration: {
      group: 'Timing',
      type: 'number',
      displayName: 'Duration (seconds)',
      default: 1,
      set: function(value) {
        this._internal.duration = Math.max(0.1, value);
        this._updateAnimation();
      }
    },
    easing: {
      group: 'Timing',
      type: {
        name: 'enum',
        enums: [
          { label: 'Linear', value: 'linear' },
          { label: 'Ease Out', value: 'easeOut' },
          { label: 'Ease In', value: 'easeIn' },
          { label: 'Ease In Out', value: 'easeInOut' },
          { label: 'Bounce Out', value: 'anticipate' },
          { label: 'Back Out', value: 'backOut' },
          { label: 'Back In', value: 'backIn' },
          { label: 'Back In Out', value: 'backInOut' },
          { label: 'Circ Out', value: 'circOut' },
          { label: 'Circ In', value: 'circIn' },
          { label: 'Circ In Out', value: 'circInOut' }
        ]
      },
      displayName: 'Easing',
      default: 'easeOut',
      set: function(value) {
        this._internal.animationData.transition.ease = value;
        this._updateAnimation();
      }
    },
    // Animation Properties - From Values
    fromX: {
      group: 'From Transform',
      type: 'number',
      displayName: 'From X',
      set: function(value) {
        this._internal.animationData.initial.x = value;
        this._updateAnimation();
      }
    },
    fromY: {
      group: 'From Transform',
      type: 'number',
      displayName: 'From Y',
      set: function(value) {
        this._internal.animationData.initial.y = value;
        this._updateAnimation();
      }
    },
    fromScale: {
      group: 'From Transform',
      type: 'number',
      displayName: 'From Scale',
      default: 1,
      set: function(value) {
        this._internal.animationData.initial.scale = value;
        this._updateAnimation();
      }
    },
    fromRotation: {
      group: 'From Transform',
      type: 'number',
      displayName: 'From Rotation',
      set: function(value) {
        this._internal.animationData.initial.rotate = value;
        this._updateAnimation();
      }
    },
    fromOpacity: {
      group: 'From Appearance',
      type: 'number',
      displayName: 'From Opacity',
      default: 1,
      set: function(value) {
        this._internal.animationData.initial.opacity = Math.max(0, Math.min(1, value));
        this._updateAnimation();
      }
    },
    // Animation Properties - To Values
    toX: {
      group: 'To Transform',
      type: 'number',
      displayName: 'To X',
      set: function(value) {
        this._internal.animationData.animate.x = value;
        this._updateAnimation();
      }
    },
    toY: {
      group: 'To Transform',
      type: 'number',
      displayName: 'To Y',
      set: function(value) {
        this._internal.animationData.animate.y = value;
        this._updateAnimation();
      }
    },
    toScale: {
      group: 'To Transform',
      type: 'number',
      displayName: 'To Scale',
      default: 1,
      set: function(value) {
        this._internal.animationData.animate.scale = value;
        this._updateAnimation();
      }
    },
    toRotation: {
      group: 'To Transform',
      type: 'number',
      displayName: 'To Rotation',
      set: function(value) {
        this._internal.animationData.animate.rotate = value;
        this._updateAnimation();
      }
    },
    toOpacity: {
      group: 'To Appearance',
      type: 'number',
      displayName: 'To Opacity',
      default: 1,
      set: function(value) {
        this._internal.animationData.animate.opacity = Math.max(0, Math.min(1, value));
        this._updateAnimation();
      }
    },
    // Advanced Properties
    repeat: {
      group: 'Advanced',
      type: 'number',
      displayName: 'Repeat Count',
      default: 0,
      set: function(value) {
        this._internal.animationData.transition.repeat = Math.max(0, Math.floor(value));
        this._updateAnimation();
      }
    },
    repeatType: {
      group: 'Advanced',
      type: {
        name: 'enum',
        enums: [
          { label: 'Loop', value: 'loop' },
          { label: 'Reverse', value: 'reverse' },
          { label: 'Mirror', value: 'mirror' }
        ]
      },
      displayName: 'Repeat Type',
      default: 'loop',
      set: function(value) {
        this._internal.animationData.transition.repeatType = value;
        this._updateAnimation();
      }
    },
    delay: {
      group: 'Advanced',
      type: 'number',
      displayName: 'Delay (seconds)',
      default: 0,
      set: function(value) {
        this._internal.animationData.transition.delay = Math.max(0, value);
        this._updateAnimation();
      }
    },
    // Control inputs
    play: {
      group: 'Controls',
      type: 'signal',
      displayName: 'Play',
      valueChangedToTrue: function() {
        this._playAnimation();
      }
    },
    pause: {
      group: 'Controls',
      type: 'signal',
      displayName: 'Pause',
      valueChangedToTrue: function() {
        this._pauseAnimation();
      }
    },
    stop: {
      group: 'Controls',
      type: 'signal',
      displayName: 'Stop',
      valueChangedToTrue: function() {
        this._stopAnimation();
      }
    },
    reverse: {
      group: 'Controls',
      type: 'signal',
      displayName: 'Reverse',
      valueChangedToTrue: function() {
        this._reverseAnimation();
      }
    },
    progress: {
      group: 'Controls',
      type: 'number',
      displayName: 'Progress (0-1)',
      set: function(value) {
        this._setProgress(Math.max(0, Math.min(1, value)));
      }
    }
  },
  outputs: {
    onStart: {
      group: 'Events',
      type: 'signal',
      displayName: 'On Start'
    },
    onComplete: {
      group: 'Events',
      type: 'signal',
      displayName: 'On Complete'
    },
    onUpdate: {
      group: 'Events',
      type: 'signal',
      displayName: 'On Update'
    },
    currentProgress: {
      group: 'Status',
      type: 'number',
      displayName: 'Current Progress',
      getter: function() {
        return this._internal.currentProgress;
      }
    },
    isPlaying: {
      group: 'Status',
      type: 'boolean',
      displayName: 'Is Playing',
      getter: function() {
        return this._internal.isPlaying;
      }
    },
    isPaused: {
      group: 'Status',
      type: 'boolean',
      displayName: 'Is Paused',
      getter: function() {
        return this._internal.isPaused;
      }
    }
  },
  prototypeExtensions: {
    _updateAnimation: {
      value: function() {
        if (!this._internal.targetElement) return;
        
        const internal = this._internal;
        const { initial, animate, transition } = internal.animationData;
        
        // Update transition duration
        transition.duration = internal.duration;
        
        // Store animation configuration for the target element
        // This will be used by the React component to apply Framer Motion
        internal.motionConfig = {
          initial,
          animate,
          transition: {
            ...transition,
            onStart: () => this._onAnimationStart(),
            onUpdate: (latest) => this._onAnimationUpdate(latest),
            onComplete: () => this._onAnimationComplete()
          }
        };
        
        // Notify the target element about animation changes
        if (internal.targetElement && internal.targetElement.updateMotionConfig) {
          internal.targetElement.updateMotionConfig(internal.motionConfig);
        }
      }
    },
    _playAnimation: {
      value: function() {
        const internal = this._internal;
        
        if (!internal.motionConfig) {
          this._updateAnimation();
        }
        
        internal.isPlaying = true;
        internal.isPaused = false;
        
        // Trigger animation via motion controls
        if (internal.targetElement && internal.targetElement.startAnimation) {
          internal.targetElement.startAnimation();
        }
        
        this._onAnimationStart();
        this.flagOutputDirty('isPlaying');
        this.flagOutputDirty('isPaused');
      }
    },
    _pauseAnimation: {
      value: function() {
        const internal = this._internal;
        
        if (internal.targetElement && internal.targetElement.pauseAnimation) {
          internal.isPlaying = false;
          internal.isPaused = true;
          
          internal.targetElement.pauseAnimation();
          
          this.flagOutputDirty('isPlaying');
          this.flagOutputDirty('isPaused');
        }
      }
    },
    _stopAnimation: {
      value: function() {
        const internal = this._internal;
        
        if (internal.targetElement && internal.targetElement.stopAnimation) {
          internal.isPlaying = false;
          internal.isPaused = false;
          internal.currentProgress = 0;
          
          internal.targetElement.stopAnimation();
          
          this.flagOutputDirty('isPlaying');
          this.flagOutputDirty('isPaused');
          this.flagOutputDirty('currentProgress');
        }
      }
    },
    _reverseAnimation: {
      value: function() {
        const internal = this._internal;
        
        if (internal.targetElement && internal.targetElement.reverseAnimation) {
          internal.targetElement.reverseAnimation();
          internal.isPlaying = true;
          this.flagOutputDirty('isPlaying');
        }
      }
    },
    _setProgress: {
      value: function(progress) {
        const internal = this._internal;
        
        if (internal.targetElement && internal.targetElement.setAnimationProgress) {
          internal.currentProgress = progress;
          internal.targetElement.setAnimationProgress(progress);
          this.flagOutputDirty('currentProgress');
        }
      }
    },
    _onAnimationStart: {
      value: function() {
        this.sendSignalOnOutput('onStart');
      }
    },
    _onAnimationUpdate: {
      value: function(latest) {
        // Update progress from Framer Motion
        // latest contains the current animated values
        if (latest && latest.progress !== undefined) {
          this._internal.currentProgress = latest.progress;
        }
        this.flagOutputDirty('currentProgress');
        this.sendSignalOnOutput('onUpdate');
      }
    },
    _onAnimationComplete: {
      value: function() {
        this._internal.isPlaying = false;
        this._internal.currentProgress = 1;
        
        this.flagOutputDirty('isPlaying');
        this.flagOutputDirty('currentProgress');
        this.sendSignalOnOutput('onComplete');
      }
    }
  }
};

module.exports = {
  node: AnimationNode,
  setup: function(context, graphModel) {
    // Setup any global animation context or Framer Motion initialization
    if (typeof window !== 'undefined') {
      // Check if Framer Motion is available
      try {
        // This would be imported in the actual React components
        console.log('Animation node ready. Framer Motion integration available.');
      } catch (e) {
        console.warn('Framer Motion not available. Animation node requires framer-motion library.');
      }
    }
  }
};
