import NodeSharedPortDefinitions from '../../node-shared-port-definitions';
import { createNodeFromReactComponent } from '../../react-component-node';

const AnimationNode = {
  name: 'Animation',
  docs: 'https://docsapp.xgenia.com/nodes/animation/animation',
  displayName: 'Animation',
  category: 'Animation',
  allowChildren: false, // Changed: This is not a container node
  usePortAsLabel: 'animationName',
  connectionPanel: {
    groupPriority: ['General', 'From Transform', 'To Transform', 'From Appearance', 'To Appearance', 'Timing', 'Controls', 'Events', 'Status']
  },
  nodeDoubleClickAction: {
    focusPort: 'animationName'
  },
  initialize() {
    this._animationConfig = {
      initial: {},
      animate: {},
      transition: {
        duration: 1,
        ease: 'easeOut'
      }
    };
    this._animationState = {
      isPlaying: false,
      isPaused: false,
      currentProgress: 0
    };
    this._targetElement = null;
    this._currentAnimation = null;
  },
  getReactComponent() {
    // Return a simple invisible div since this is a logic node
    return function() {
      return null; // Invisible node
    };
  },
  getInspectInfo() {
    return `${this.props.animationName || 'Animation'} - ${this._animationState.isPlaying ? 'Playing' : 'Stopped'}`;
  },
  defaultCss: {
    position: 'relative'
  },
  inputProps: {
    animationName: {
      group: 'General',
      type: 'string',
      displayName: 'Animation Name',
      default: 'My Animation'
    },
    // Target input for connecting visual nodes
    target: {
      group: 'General',
      type: 'node',
      displayName: 'Target Element',
      onChange: function(value) {
        // Store the target element reference when it changes
        this._targetElement = value;
        this._updateAnimationTarget();
      }
    },
    // From Transform Properties
    fromX: {
      group: 'From Transform',
      type: 'number',
      displayName: 'From X',
      onChange: function(value) {
        if (!this._animationConfig) this._animationConfig = { initial: {}, animate: {}, transition: {} };
        this._animationConfig.initial.x = value;
        this._updateAnimationConfig();
      }
    },
    fromY: {
      group: 'From Transform',
      type: 'number',
      displayName: 'From Y',
      onChange: function(value) {
        if (!this._animationConfig) this._animationConfig = { initial: {}, animate: {}, transition: {} };
        this._animationConfig.initial.y = value;
        this._updateAnimationConfig();
      }
    },
    fromScale: {
      group: 'From Transform',
      type: 'number',
      displayName: 'From Scale',
      default: 1,
      onChange: function(value) {
        if (!this._animationConfig) this._animationConfig = { initial: {}, animate: {}, transition: {} };
        this._animationConfig.initial.scale = value;
        this._updateAnimationConfig();
      }
    },
    fromRotation: {
      group: 'From Transform',
      type: 'number',
      displayName: 'From Rotation (degrees)',
      onChange: function(value) {
        if (!this._animationConfig) this._animationConfig = { initial: {}, animate: {}, transition: {} };
        this._animationConfig.initial.rotate = value;
        this._updateAnimationConfig();
      }
    },
    // To Transform Properties
    toX: {
      group: 'To Transform',
      type: 'number',
      displayName: 'To X',
      onChange: function(value) {
        if (!this._animationConfig) this._animationConfig = { initial: {}, animate: {}, transition: {} };
        this._animationConfig.animate.x = value;
        this._updateAnimationConfig();
      }
    },
    toY: {
      group: 'To Transform',
      type: 'number',
      displayName: 'To Y',
      onChange: function(value) {
        if (!this._animationConfig) this._animationConfig = { initial: {}, animate: {}, transition: {} };
        this._animationConfig.animate.y = value;
        this._updateAnimationConfig();
      }
    },
    toScale: {
      group: 'To Transform',
      type: 'number',
      displayName: 'To Scale',
      default: 1,
      onChange: function(value) {
        if (!this._animationConfig) this._animationConfig = { initial: {}, animate: {}, transition: {} };
        this._animationConfig.animate.scale = value;
        this._updateAnimationConfig();
      }
    },
    toRotation: {
      group: 'To Transform',
      type: 'number',
      displayName: 'To Rotation (degrees)',
      onChange: function(value) {
        if (!this._animationConfig) this._animationConfig = { initial: {}, animate: {}, transition: {} };
        this._animationConfig.animate.rotate = value;
        this._updateAnimationConfig();
      }
    },
    // From Appearance Properties
    fromOpacity: {
      group: 'From Appearance',
      type: 'number',
      displayName: 'From Opacity',
      default: 1,
      onChange: function(value) {
        if (!this._animationConfig) this._animationConfig = { initial: {}, animate: {}, transition: {} };
        this._animationConfig.initial.opacity = Math.max(0, Math.min(1, value));
        this._updateAnimationConfig();
      }
    },
    // To Appearance Properties
    toOpacity: {
      group: 'To Appearance',
      type: 'number',
      displayName: 'To Opacity',
      default: 1,
      onChange: function(value) {
        if (!this._animationConfig) this._animationConfig = { initial: {}, animate: {}, transition: {} };
        this._animationConfig.animate.opacity = Math.max(0, Math.min(1, value));
        this._updateAnimationConfig();
      }
    },
    // Timing Properties
    duration: {
      group: 'Timing',
      type: 'number',
      displayName: 'Duration (seconds)',
      default: 1,
      onChange: function(value) {
        if (!this._animationConfig) this._animationConfig = { initial: {}, animate: {}, transition: {} };
        this._animationConfig.transition.duration = Math.max(0.1, value);
        this._updateAnimationConfig();
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
      onChange: function(value) {
        if (!this._animationConfig) this._animationConfig = { initial: {}, animate: {}, transition: {} };
        this._animationConfig.transition.ease = value;
        this._updateAnimationConfig();
      }
    },
    delay: {
      group: 'Timing',
      type: 'number',
      displayName: 'Delay (seconds)',
      default: 0,
      onChange: function(value) {
        if (!this._animationConfig) this._animationConfig = { initial: {}, animate: {}, transition: {} };
        this._animationConfig.transition.delay = Math.max(0, value);
        this._updateAnimationConfig();
      }
    },
    repeat: {
      group: 'Timing',
      type: 'number',
      displayName: 'Repeat Count',
      default: 0,
      onChange: function(value) {
        if (!this._animationConfig) this._animationConfig = { initial: {}, animate: {}, transition: {} };
        this._animationConfig.transition.repeat = Math.max(0, Math.floor(value));
        this._updateAnimationConfig();
      }
    },
    repeatType: {
      group: 'Timing',
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
      onChange: function(value) {
        if (!this._animationConfig) this._animationConfig = { initial: {}, animate: {}, transition: {} };
        this._animationConfig.transition.repeatType = value;
        this._updateAnimationConfig();
      }
    },
    // Animation Control Props
    onAnimationStart: {
      group: 'Events',
      type: 'function',
      displayName: 'On Animation Start'
    },
    onAnimationComplete: {
      group: 'Events',
      type: 'function',
      displayName: 'On Animation Complete'
    },
    onAnimationUpdate: {
      group: 'Events',
      type: 'function',
      displayName: 'On Animation Update'
    }
  },
  inputs: {
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
      displayName: 'Set Progress (0-1)',
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
      get: function() {
        return this._animationState.currentProgress;
      }
    },
    isPlaying: {
      group: 'Status',
      type: 'boolean',
      displayName: 'Is Playing',
      get: function() {
        return this._animationState.isPlaying;
      }
    },
    isPaused: {
      group: 'Status',
      type: 'boolean',
      displayName: 'Is Paused',
      get: function() {
        return this._animationState.isPaused;
      }
    }
  },
  methods: {
    _updateAnimationConfig: function() {
      // Update the internal animation configuration
      this._animationConfig = {
        initial: { ...this._animationConfig.initial },
        animate: { ...this._animationConfig.animate },
        transition: { ...this._animationConfig.transition }
      };
    },
    
    _updateAnimationTarget: function() {
      // Store the target element reference
      console.log('Animation target updated:', this._targetElement);
    },
    
    _getTargetDOMElement: function(targetElement) {
      // Use provided target or fallback to stored target
      const target = targetElement || this.props.target || this._targetElement;
      if (!target) return null;
      
      // Get the DOM element from the target node
      if (target.innerReactComponentRef && target.innerReactComponentRef.current) {
        return target.innerReactComponentRef.current;
      }
      
      // Try to get the DOM element directly
      if (target.domElement) {
        return target.domElement;
      }
      
      // Try to get from React ref
      if (target.ref && target.ref.current) {
        return target.ref.current;
      }
      
      // Try getDOMElement method if available
      if (typeof target.getDOMElement === 'function') {
        return target.getDOMElement();
      }
      
      return null;
    },
    
    _buildAnimationConfig: function() {
      const config = {
        initial: {},
        animate: {},
        transition: {
          duration: this.inputProps.duration?.default || 1,
          ease: this.inputProps.easing?.default || 'easeOut',
          delay: this.inputProps.delay?.default || 0
        }
      };
      
      // Build from properties
      const fromProps = ['fromX', 'fromY', 'fromScale', 'fromRotation', 'fromOpacity'];
      const toProps = ['toX', 'toY', 'toScale', 'toRotation', 'toOpacity'];
      
      fromProps.forEach(prop => {
        const value = this.props[prop];
        if (value !== undefined) {
          const key = prop.replace('from', '').toLowerCase();
          if (key === 'rotation') {
            config.initial.rotate = value;
          } else {
            config.initial[key] = value;
          }
        }
      });
      
      toProps.forEach(prop => {
        const value = this.props[prop];
        if (value !== undefined) {
          const key = prop.replace('to', '').toLowerCase();
          if (key === 'rotation') {
            config.animate.rotate = value;
          } else {
            config.animate[key] = value;
          }
        }
      });
      
      // Update transition properties
      if (this.props.duration !== undefined) config.transition.duration = this.props.duration;
      if (this.props.easing !== undefined) config.transition.ease = this.props.easing;
      if (this.props.delay !== undefined) config.transition.delay = this.props.delay;
      if (this.props.repeat !== undefined) config.transition.repeat = this.props.repeat;
      if (this.props.repeatType !== undefined) config.transition.repeatType = this.props.repeatType;
      
      return config;
    },
    
    _playAnimation: function() {
      // Get target from props (set by createNodeFromReactComponent)
      const targetElement = this.props.target || this._targetElement;
      
      if (!targetElement) {
        console.warn('Animation: No target element connected');
        return;
      }
      
      const targetDOM = this._getTargetDOMElement(targetElement);
      if (!targetDOM) {
        console.warn('Animation: Could not find target DOM element');
        return;
      }
      
      this._animationState.isPlaying = true;
      this._animationState.isPaused = false;
      
      const config = this._buildAnimationConfig();
      
      // Use Web Animations API or CSS transitions
      this._animateElement(targetDOM, config);
      
      this.flagOutputDirty('isPlaying');
      this.flagOutputDirty('isPaused');
      this.sendSignalOnOutput('onStart');
    },
    
    _animateElement: function(element, config) {
      // Stop any existing animation
      if (this._currentAnimation) {
        this._currentAnimation.cancel();
      }
      
      // Build keyframes for Web Animations API
      const keyframes = [
        this._buildCSSTransform(config.initial),
        this._buildCSSTransform(config.animate)
      ];
      
      const options = {
        duration: (config.transition.duration || 1) * 1000, // Convert to milliseconds
        easing: this._convertEasing(config.transition.ease || 'easeOut'),
        delay: (config.transition.delay || 0) * 1000,
        iterations: config.transition.repeat ? config.transition.repeat + 1 : 1,
        direction: config.transition.repeatType === 'reverse' ? 'alternate' : 'normal'
      };
      
      try {
        this._currentAnimation = element.animate(keyframes, options);
        
        this._currentAnimation.addEventListener('finish', () => {
          this._onAnimationComplete();
        });
        
        this._currentAnimation.addEventListener('cancel', () => {
          this._animationState.isPlaying = false;
          this.flagOutputDirty('isPlaying');
        });
        
      } catch (error) {
        console.error('Animation error:', error);
        // Fallback to CSS transitions
        this._animateWithCSS(element, config);
      }
    },
    
    _buildCSSTransform: function(values) {
      const transform = [];
      const styles = {};
      
      if (values.x !== undefined) transform.push(`translateX(${values.x}px)`);
      if (values.y !== undefined) transform.push(`translateY(${values.y}px)`);
      if (values.scale !== undefined) transform.push(`scale(${values.scale})`);
      if (values.rotate !== undefined) transform.push(`rotate(${values.rotate}deg)`);
      
      if (transform.length > 0) {
        styles.transform = transform.join(' ');
      }
      
      if (values.opacity !== undefined) {
        styles.opacity = values.opacity;
      }
      
      return styles;
    },
    
    _convertEasing: function(easing) {
      const easingMap = {
        'linear': 'linear',
        'easeOut': 'ease-out',
        'easeIn': 'ease-in',
        'easeInOut': 'ease-in-out',
        'anticipate': 'cubic-bezier(0.175, 0.885, 0.32, 1.275)',
        'backOut': 'cubic-bezier(0.175, 0.885, 0.32, 1.275)',
        'backIn': 'cubic-bezier(0.6, -0.28, 0.735, 0.045)',
        'backInOut': 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
        'circOut': 'cubic-bezier(0.075, 0.82, 0.165, 1)',
        'circIn': 'cubic-bezier(0.6, 0.04, 0.98, 0.335)',
        'circInOut': 'cubic-bezier(0.785, 0.135, 0.15, 0.86)'
      };
      
      return easingMap[easing] || 'ease-out';
    },
    
    _animateWithCSS: function(element, config) {
      // Fallback CSS animation method
      const duration = (config.transition.duration || 1) * 1000;
      const easing = this._convertEasing(config.transition.ease || 'easeOut');
      
      element.style.transition = `all ${duration}ms ${easing}`;
      
      // Apply final styles
      const finalStyles = this._buildCSSTransform(config.animate);
      Object.assign(element.style, finalStyles);
      
      // Set up completion handler
      setTimeout(() => {
        this._onAnimationComplete();
      }, duration);
    },
    
    _pauseAnimation: function() {
      this._animationState.isPlaying = false;
      this._animationState.isPaused = true;
      
      if (this._currentAnimation) {
        this._currentAnimation.pause();
      }
      
      this.flagOutputDirty('isPlaying');
      this.flagOutputDirty('isPaused');
    },
    
    _stopAnimation: function() {
      this._animationState.isPlaying = false;
      this._animationState.isPaused = false;
      this._animationState.currentProgress = 0;
      
      if (this._currentAnimation) {
        this._currentAnimation.cancel();
        this._currentAnimation = null;
      }
      
      // Reset target element to initial state
      const targetElement = this.props.target || this._targetElement;
      const targetDOM = this._getTargetDOMElement(targetElement);
      if (targetDOM) {
        const config = this._buildAnimationConfig();
        const initialStyles = this._buildCSSTransform(config.initial);
        Object.assign(targetDOM.style, initialStyles);
      }
      
      this.flagOutputDirty('isPlaying');
      this.flagOutputDirty('isPaused');
      this.flagOutputDirty('currentProgress');
    },
    
    _reverseAnimation: function() {
      const targetElement = this.props.target || this._targetElement;
      if (!targetElement) return;
      
      const targetDOM = this._getTargetDOMElement(targetElement);
      if (!targetDOM) return;
      
      this._animationState.isPlaying = true;
      
      const config = this._buildAnimationConfig();
      // Swap initial and animate values for reverse
      const reverseConfig = {
        initial: config.animate,
        animate: config.initial,
        transition: config.transition
      };
      
      this._animateElement(targetDOM, reverseConfig);
      
      this.flagOutputDirty('isPlaying');
    },
    
    _setProgress: function(progress) {
      this._animationState.currentProgress = progress;
      
      const targetElement = this.props.target || this._targetElement;
      const targetDOM = this._getTargetDOMElement(targetElement);
      if (!targetDOM) return;
      
      const config = this._buildAnimationConfig();
      
      // Interpolate between initial and final values
      const interpolated = {};
      Object.keys(config.animate).forEach(key => {
        const startValue = config.initial[key] || 0;
        const endValue = config.animate[key];
        
        if (typeof startValue === 'number' && typeof endValue === 'number') {
          interpolated[key] = startValue + (endValue - startValue) * progress;
        } else {
          interpolated[key] = progress > 0.5 ? endValue : startValue;
        }
      });
      
      const styles = this._buildCSSTransform(interpolated);
      Object.assign(targetDOM.style, styles);
      
      this.flagOutputDirty('currentProgress');
      this.sendSignalOnOutput('onUpdate');
    },
    
    _onAnimationStart: function() {
      this._animationState.isPlaying = true;
      this._animationState.isPaused = false;
      this.flagOutputDirty('isPlaying');
      this.flagOutputDirty('isPaused');
      this.sendSignalOnOutput('onStart');
    },
    
    _onAnimationComplete: function() {
      this._animationState.isPlaying = false;
      this._animationState.currentProgress = 1;
      this._currentAnimation = null;
      
      this.flagOutputDirty('isPlaying');
      this.flagOutputDirty('currentProgress');
      this.sendSignalOnOutput('onComplete');
    },
    
    _onAnimationUpdate: function(progress) {
      this._animationState.currentProgress = progress;
      this.flagOutputDirty('currentProgress');
      this.sendSignalOnOutput('onUpdate');
    }
  }
};

// Add standard visual node capabilities
NodeSharedPortDefinitions.addDimensions(AnimationNode, {
  defaultSizeMode: 'contentSize',
  contentLabel: 'Animation'
});
NodeSharedPortDefinitions.addTransformInputs(AnimationNode);
NodeSharedPortDefinitions.addMarginInputs(AnimationNode);
NodeSharedPortDefinitions.addSharedVisualInputs(AnimationNode);

export default createNodeFromReactComponent(AnimationNode);
