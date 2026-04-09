'use strict';

// GSAP import using CommonJS to avoid module system conflicts
var gsap = require('gsap').gsap;
// Import BezierEasing for curve editor integration like states.js
const BezierEasing = require('bezier-easing');

/**
 * Curve Editor Integration for Custom Ease Functions
 * ================================================
 * 
 * This Animation Target node now supports the visual curve editor for custom ease functions,
 * similar to the States node. The integration includes:
 * 
 * 1. gsapCustomEase input is now of type 'curve' instead of JSON string
 * 2. Curve editor provides: { curve: [x1, y1, x2, y2], dur: 1000, delay: 0 }
 * 3. BezierEasing library compiles the curve into a usable easing function
 * 4. Seamless integration with GSAP's custom ease system
 * 
 * Usage:
 * - Set 'Advanced Ease' to 'custom'
 * - Use the 'Custom Ease (Curve Editor)' input to visually design your easing curve
 * - The curve editor provides real-time preview and intuitive control points
 */

var AnimationTarget = {
  name: 'net.xgenia.animationtarget',
  docs: "https://docsapp.xgenia.com/nodes/ui-controls/animation-target/",
  displayName: 'Animation Target',
  shortDesc: 'Animate properties of target visual elements using powerful GSAP animation controls.',
  category: 'Animation',
  usePortAsLabel: 'animationName',
  connectionPanel: {
    groupPriority: ['General', 'Target', 'Animation (GSAP)', 'Animation (GSAP) | Properties', 'Animation (GSAP) | Targets', 'Animation (GSAP) | Control', 'Target 1 Animation', 'Target 2 Animation', 'Target 3 Animation', 'Target 4 Animation', 'Target 5 Animation', 'Animation (GSAP) | Advanced', 'Animation (GSAP) | Path', 'Animation (GSAP) | Easing', 'Animation (GSAP) | Performance', 'Animation (GSAP) | State', 'Legacy Animation', 'Events', 'Status']
  },
  nodeDoubleClickAction: {
    focusPort: 'animationName'
  },
  initialize: function () {
    var self = this;
    var _internal = this._internal;

    // Animation name storage
    _internal.animationName = 'My Animation';

    // Target nodes storage
    _internal.targetNodes = [];
    _internal.targetNode = null;
    _internal.targetNode2 = null;
    _internal.targetNode3 = null;
    _internal.targetNode4 = null;
    _internal.targetNode5 = null;

    // GSAP Animation properties (copied from PixiSpriteNode)
    _internal.gsapEnabled = true; // Always enabled by default
    _internal.gsapVars = JSON.stringify({
      duration: 2,
      repeat: -1,
      yoyo: true,
      ease: 'power1.inOut',
      x: 100,
      y: 50,
      rotation: 0.5,
      alpha: 0.8
    }, null, 2);
    _internal.gsapDuration = 2;
    _internal.gsapDelay = 0;
    _internal.gsapRepeat = -1;
    _internal.gsapYoyo = true;
    _internal.gsapEase = 'power1.inOut';
    _internal.gsapTargetX = undefined;
    _internal.gsapTargetY = undefined;
    _internal.gsapTargetScaleX = undefined;
    _internal.gsapTargetScaleY = undefined;
    _internal.gsapTargetRotation = undefined;
    _internal.gsapTargetAlpha = 1;
    _internal.gsapTargetSkewX = undefined;
    _internal.gsapTargetSkewY = undefined;

    // Advanced GSAP Features
    _internal.gsapUseTimeline = false;
    _internal.gsapTimelineSteps = JSON.stringify([
      { duration: 1, x: 100, y: 0, ease: 'power2.out' },
      { duration: 1, x: 100, y: 100, ease: 'power2.in' },
      { duration: 1, x: 0, y: 100, ease: 'power2.out' },
      { duration: 1, x: 0, y: 0, ease: 'power2.in' }
    ], null, 2);
    _internal.gsapStaggerEnabled = false;
    // Stagger configuration removed
    _internal.gsapPathEnabled = false;
    _internal.gsapPathPoints = JSON.stringify([[0, 0], [100, 50], [200, 0], [300, 100]], null, 2);
    _internal.gsapPathType = 'linear';
    _internal.gsapPathAlign = 'self';
    _internal.gsapPathAutoRotate = false;
    _internal.gsapPathAlignOrigin = [0.5, 0.5];
    _internal.gsapAdvancedEase = 'none';
    // Initialize custom ease with curve editor format like states.js
    _internal.gsapCustomEase = { curve: [0.25, 0.1, 0.25, 1.0], dur: 1000, delay: 0 };
    _internal.gsapOverwrite = 'auto';
    _internal.gsapLazy = false;
    _internal.gsapTimeScale = 1;
    _internal.gsapProgress = 0;

    // Store the compiled bezier easing function
    _internal.compiledCustomEase = null;

    // Error tracking for stability
    _internal.lastError = '';
    _internal.lastWarning = '';
    _internal.errorCount = 0;
    
    // Performance monitoring
    _internal.performanceMetrics = {
      updateCount: 0,
      avgFrameTime: 0,
      lastFrameTime: 0,
      currentFPS: 0,
      frameTimeHistory: [],
      lastUpdateTime: performance.now(),
      updateFrequency: 0
    };

    // Performance monitoring timer
    this._performanceTimer = setInterval(() => {
      this._updatePerformanceMetrics();
    }, 1000); // Update every second

    // GSAP Event outputs
    _internal.gsapEventStart = false;
    _internal.gsapEventUpdate = false;
    _internal.gsapEventComplete = false;
    _internal.gsapEventRepeat = false;
    _internal.gsapEventReverse = false;
    _internal.gsapEventPause = false;
    _internal.gsapEventResume = false;
    _internal.gsapEventRestart = false;

    // Event-based animations removed

    // Target-specific animation vars
    _internal.target1AnimationVars = JSON.stringify({ duration: 2, x: 100, y: 50, rotation: 0.5, alpha: 0.8, ease: 'power1.inOut' }, null, 2);
    _internal.target1UseTimeline = false;
    _internal.target1TimelineSteps = JSON.stringify([{ duration: 1, x: 100, y: 0, ease: 'power2.out' }, { duration: 1, x: 100, y: 100, ease: 'power2.in' }, { duration: 1, x: 0, y: 100, ease: 'power2.out' }, { duration: 1, x: 0, y: 0, ease: 'power2.in' }], null, 2);
    
    _internal.target2AnimationVars = JSON.stringify({ duration: 1.5, scaleX: 1.5, scaleY: 1.5, rotation: -0.3, ease: 'bounce.out' }, null, 2);
    _internal.target2UseTimeline = false;
    _internal.target2TimelineSteps = JSON.stringify([{ duration: 0.5, scaleX: 1.5, scaleY: 1.5, ease: 'power2.out' }, { duration: 0.5, scaleX: 1, scaleY: 1, ease: 'power2.in' }, { duration: 0.5, rotation: 1, ease: 'bounce.out' }, { duration: 0.5, rotation: 0, ease: 'back.out' }], null, 2);
    
    _internal.target3AnimationVars = JSON.stringify({ duration: 3, y: -100, alpha: 0.5, ease: 'elastic.out' }, null, 2);
    _internal.target3UseTimeline = false;
    _internal.target3TimelineSteps = JSON.stringify([{ duration: 1, y: -50, alpha: 0.8, ease: 'power2.out' }, { duration: 1, y: -100, alpha: 0.5, ease: 'elastic.out' }, { duration: 1, y: -50, alpha: 0.8, ease: 'power2.in' }, { duration: 1, y: 0, alpha: 1, ease: 'bounce.out' }], null, 2);
    
    _internal.target4AnimationVars = JSON.stringify({ duration: 2.5, x: -50, scaleX: 0.8, scaleY: 0.8, ease: 'back.out' }, null, 2);
    _internal.target4UseTimeline = false;
    _internal.target4TimelineSteps = JSON.stringify([{ duration: 0.8, x: -25, scaleX: 0.9, ease: 'power2.out' }, { duration: 0.8, x: -50, scaleY: 0.8, ease: 'back.out' }, { duration: 0.9, x: -25, scaleX: 0.9, ease: 'power2.in' }, { duration: 0.8, x: 0, scaleX: 1, scaleY: 1, ease: 'elastic.out' }], null, 2);
    
    _internal.target5AnimationVars = JSON.stringify({ duration: 1, rotation: 1.57, skewX: 0.2, ease: 'power2.inOut', yoyo: true, repeat: -1 }, null, 2);
    _internal.target5UseTimeline = false;
    _internal.target5TimelineSteps = JSON.stringify([{ duration: 0.3, rotation: 0.5, skewX: 0.1, ease: 'power2.out' }, { duration: 0.3, rotation: 1, skewX: 0.2, ease: 'power2.in' }, { duration: 0.2, rotation: 1.57, skewX: 0.15, ease: 'bounce.out' }, { duration: 0.2, rotation: 0, skewX: 0, ease: 'elastic.out' }], null, 2);

    // Target-based animations toggle
    _internal.enableTargetBasedAnimations = false;

    // Custom JSON toggle
    _internal.enableCustomJSON = false;

    // Legacy animation state for backwards compatibility
    _internal.animationState = {
      isPlaying: false,
      isPaused: false,
      currentProgress: 0
    };

    // GSAP tween storage
    this._gsapTween = null;
    // Event-based tweens removed
    this._targetTweens = []; // Individual tweens for each target
    this._targetProxies = []; // Store target proxies for individual control

    // Strict configuration mode
    _internal.gsapStrictConfigEnabled = false;
    _internal.gsapConfigSource = 'properties'; // 'properties' | 'json' | 'timeline' | 'targetBased'
    _internal.gsapAutoStart = true;

    // console.log('Animation Target - Initializing with GSAP...');
    if (typeof gsap !== 'undefined') {
      // console.log('Animation Target - GSAP is available');
    } else {
      console.error('Animation Target - GSAP is not available!');
    }

    // Validate BezierEasing for curve editor integration
    if (typeof BezierEasing !== 'undefined') {
      // console.log('Animation Target - BezierEasing is available for curve editor integration');
    } else {
      console.error('Animation Target - BezierEasing is not available! Curve editor integration will not work.');
    }
  },
  getInspectInfo() {
    const animationName = this._internal?.animationName || 'Animation';
    const targetCount = this._internal.targetNodes.length;
    let targetInfo = 'No Targets';
    
    if (targetCount > 0) {
      if (targetCount === 1) {
        targetInfo = this._getTargetDisplayName(this._internal.targetNodes[0]);
      } else {
        targetInfo = `${targetCount} Targets`;
      }
    }
    
    const state = this._internal.animationState;
    const status = state.isPlaying ? 'Playing' : 'Stopped';
    
    return `${animationName} -> ${targetInfo} (GSAP) - ${status}`;
  },
  inputs: {
    // General
    animationName: {
      group: 'General',
      type: 'string',
      displayName: 'Animation Name',
      default: 'My Animation',
      set: function(value) {
        this._internal.animationName = value || 'My Animation';
      }
    },
    
    // Target connections
    target: {
      group: 'Target',
      type: 'node',
      displayName: 'Target Element 1',
      set: function(value) {
        // console.log('Animation Target - Target 1 selected:', value);
        this._internal.targetNode = value;
        this._updateTargetNodes();
      }
    },
    target2: {
      group: 'Target',
      type: 'node',
      displayName: 'Target Element 2',
      set: function(value) {
        this._internal.targetNode2 = value;
        this._updateTargetNodes();
      }
    },
    target3: {
      group: 'Target',
      type: 'node',
      displayName: 'Target Element 3',
      set: function(value) {
        this._internal.targetNode3 = value;
        this._updateTargetNodes();
      }
    },
    target4: {
      group: 'Target',
      type: 'node',
      displayName: 'Target Element 4',
      set: function(value) {
        this._internal.targetNode4 = value;
        this._updateTargetNodes();
      }
    },
    target5: {
      group: 'Target',
      type: 'node',
      displayName: 'Target Element 5',
      set: function(value) {
        this._internal.targetNode5 = value;
        this._updateTargetNodes();
      }
    },

    // --- Animation Configuration ---
    enableCustomJSON: {
      displayName: 'Enable Custom JSON', group: 'Animation (GSAP) | Configuration', type: 'boolean', default: false,
      set: function(v) {
        this._internal.enableCustomJSON = !!v;
        if (this._internal.gsapStrictConfigEnabled) {
          if (this._internal.enableCustomJSON) {
            this._internal.gsapUseTimeline = false;
            this._internal.enableTargetBasedAnimations = false;
            this._internal.gsapConfigSource = 'json';
          } else if (this._internal.gsapConfigSource === 'json') {
            this._internal.gsapConfigSource = 'properties';
          }
        }
        if (this._internal.gsapAutoStart) {
          this._autoStartActiveAnimation();
        } else {
          this._updateGSAPAnimation();
        }
      }
    },
    enableTargetBasedAnimations: {
      displayName: 'Enable Target Controls', group: 'Animation (GSAP) | Configuration', type: 'boolean', default: false,
      set: function(v) {
        this._internal.enableTargetBasedAnimations = !!v;
        if (this._internal.gsapStrictConfigEnabled) {
          if (this._internal.enableTargetBasedAnimations) {
            this._internal.gsapUseTimeline = false;
            this._internal.enableCustomJSON = false;
            this._internal.gsapConfigSource = 'targetBased';
          } else if (this._internal.gsapConfigSource === 'targetBased') {
            this._internal.gsapConfigSource = 'properties';
          }
        }
        // In target-based mode, ensure main tween doesn't interfere
        if (this._internal.gsapAutoStart) {
          this._autoStartActiveAnimation();
        } else {
          this._updateGSAPAnimation();
        }
      }
    },

    // Strict Configuration Mode
    gsapStrictConfigEnabled: {
      displayName: 'Strict Config Mode', group: 'Animation (GSAP) | Configuration', type: 'boolean', default: false,
      set: function(v) {
        this._internal.gsapStrictConfigEnabled = !!v;
        if (this._internal.gsapAutoStart) {
          this._autoStartActiveAnimation();
        } else {
          this._updateGSAPAnimation();
        }
      }
    },
    gsapConfigSource: {
      displayName: 'Config Source', group: 'Animation (GSAP) | Configuration', type: { name: 'enum', enums: ['properties', 'json', 'timeline', 'targetBased'] }, default: 'properties',
      set: function(v) {
        this._internal.gsapConfigSource = v || 'properties';
        if (this._internal.gsapStrictConfigEnabled) {
          // Enforce mutual exclusivity
          if (v === 'json') {
            this._internal.enableCustomJSON = true;
            this._internal.gsapUseTimeline = false;
            this._internal.enableTargetBasedAnimations = false;
          } else if (v === 'timeline') {
            this._internal.enableCustomJSON = false;
            this._internal.gsapUseTimeline = true;
            this._internal.enableTargetBasedAnimations = false;
          } else if (v === 'targetBased') {
            this._internal.enableCustomJSON = false;
            this._internal.gsapUseTimeline = false;
            this._internal.enableTargetBasedAnimations = true;
          } else { // properties
            this._internal.enableCustomJSON = false;
            this._internal.gsapUseTimeline = false;
            this._internal.enableTargetBasedAnimations = false;
          }
        }
        if (this._internal.gsapAutoStart) {
          this._autoStartActiveAnimation();
        } else {
          this._updateGSAPAnimation();
        }
      }
    },
    gsapAutoStart: {
      displayName: 'Auto Start Active Animation', group: 'Animation (GSAP) | Configuration', type: 'boolean', default: true,
      set: function(v) {
        this._internal.gsapAutoStart = !!v;
        if (this._internal.gsapAutoStart) {
          this._autoStartActiveAnimation();
        }
      }
    },

    // --- Main Animation JSON (Advanced) ---
    gsapVars: {
      displayName: 'Main Animation (JSON)', group: 'Animation (GSAP) | Advanced', type: { name: 'string', allowEditOnly: true, codeeditor: 'json' }, multiline: true,
      default: JSON.stringify({ duration: 2, repeat: -1, yoyo: true, ease: 'power1.inOut', x: 100, y: 50, rotation: 0.5, alpha: 0.8 }, null, 2),
      set: function(v) { this._internal.gsapVars = v; this._updateGSAPAnimation(); }
    },
    // Event-based animations removed

    // --- GSAP Properties (Easy Access) ---
    gsapDuration: { displayName: 'Duration', group: 'Animation (GSAP) | Properties', type: 'number', default: 2, set: function(v) { this._internal.gsapDuration = v; this._updateGSAPFromProperties(); } },
    gsapDelay: { displayName: 'Delay', group: 'Animation (GSAP) | Properties', type: 'number', default: 0, set: function(v) { this._internal.gsapDelay = v; this._updateGSAPFromProperties(); } },
    gsapRepeat: { displayName: 'Repeat', group: 'Animation (GSAP) | Properties', type: 'number', default: -1, set: function(v) { this._internal.gsapRepeat = v; this._updateGSAPFromProperties(); } },
    gsapYoyo: { displayName: 'Yoyo', group: 'Animation (GSAP) | Properties', type: 'boolean', default: true, set: function(v) { this._internal.gsapYoyo = v; this._updateGSAPFromProperties(); } },
    gsapEase: { displayName: 'Ease', group: 'Animation (GSAP) | Properties', type: { name: 'enum', enums: ['none', 'power1.out', 'power1.in', 'power1.inOut', 'power2.out', 'power2.in', 'power2.inOut', 'power3.out', 'power3.in', 'power3.inOut', 'power4.out', 'power4.in', 'power4.inOut', 'back.out', 'back.in', 'back.inOut', 'elastic.out', 'elastic.in', 'elastic.inOut', 'bounce.out', 'bounce.in', 'bounce.inOut', 'sine.out', 'sine.in', 'sine.inOut', 'expo.out', 'expo.in', 'expo.inOut', 'circ.out', 'circ.in', 'circ.inOut'] }, default: 'power1.inOut', set: function(v) { this._internal.gsapEase = v; this._updateGSAPFromProperties(); } },

    // --- GSAP Target Properties ---
    gsapTargetX: { displayName: 'Target X', group: 'Animation (GSAP) | Targets', type: 'number', set: function(v) { this._internal.gsapTargetX = v; this._updateGSAPFromProperties(); } },
    gsapTargetY: { displayName: 'Target Y', group: 'Animation (GSAP) | Targets', type: 'number', set: function(v) { this._internal.gsapTargetY = v; this._updateGSAPFromProperties(); } },
    gsapTargetScaleX: { displayName: 'Target Scale X', group: 'Animation (GSAP) | Targets', type: 'number', set: function(v) { this._internal.gsapTargetScaleX = v; this._updateGSAPFromProperties(); } },
    gsapTargetScaleY: { displayName: 'Target Scale Y', group: 'Animation (GSAP) | Targets', type: 'number', set: function(v) { this._internal.gsapTargetScaleY = v; this._updateGSAPFromProperties(); } },
    gsapTargetRotation: { displayName: 'Target Rotation', group: 'Animation (GSAP) | Targets', type: 'number', set: function(v) { this._internal.gsapTargetRotation = v; this._updateGSAPFromProperties(); } },
    gsapTargetAlpha: { displayName: 'Target Alpha', group: 'Animation (GSAP) | Targets', type: 'number', default: 1, min: 0, max: 1, set: function(v) { this._internal.gsapTargetAlpha = v; this._updateGSAPFromProperties(); } },
    gsapTargetSkewX: { displayName: 'Target Skew X', group: 'Animation (GSAP) | Targets', type: 'number', set: function(v) { this._internal.gsapTargetSkewX = v; this._updateGSAPFromProperties(); } },
    gsapTargetSkewY: { displayName: 'Target Skew Y', group: 'Animation (GSAP) | Targets', type: 'number', set: function(v) { this._internal.gsapTargetSkewY = v; this._updateGSAPFromProperties(); } },

    // --- Animation Control ---
    gsapPlay: { displayName: 'Play', group: 'Animation (GSAP) | Control', type: 'signal', valueChangedToTrue: function() { this._gsapPlay(); } },
    gsapPause: { displayName: 'Pause', group: 'Animation (GSAP) | Control', type: 'signal', valueChangedToTrue: function() { this._gsapPause(); } },
    gsapResume: { displayName: 'Resume', group: 'Animation (GSAP) | Control', type: 'signal', valueChangedToTrue: function() { this._gsapResume(); } },
    gsapRestart: { displayName: 'Restart', group: 'Animation (GSAP) | Control', type: 'signal', valueChangedToTrue: function() { this._gsapRestart(); } },
    gsapReverse: { displayName: 'Reverse', group: 'Animation (GSAP) | Control', type: 'signal', valueChangedToTrue: function() { this._gsapReverse(); } },
    gsapStop: { displayName: 'Stop', group: 'Animation (GSAP) | Control', type: 'signal', valueChangedToTrue: function() { this._gsapStop(); } },
    gsapStopAll: { displayName: 'Stop All', group: 'Animation (GSAP) | Control', type: 'signal', valueChangedToTrue: function() { this._gsapStopAll(); } },
    gsapTogglePlay: { displayName: 'Toggle Play', group: 'Animation (GSAP) | Control', type: 'signal', valueChangedToTrue: function() { this._gsapTogglePlay(); } },
    gsapAutoStartNow: { displayName: 'Auto Start Active', group: 'Animation (GSAP) | Control', type: 'signal', valueChangedToTrue: function() { this._autoStartActiveAnimation(); } },

    // --- Advanced GSAP Features ---
    gsapUseTimeline: { displayName: 'Use Timeline', group: 'Animation (GSAP) | Advanced', type: 'boolean', default: false, set: function(v) {
      this._internal.gsapUseTimeline = v;
      if (this._internal.gsapStrictConfigEnabled) {
        if (this._internal.gsapUseTimeline) {
          this._internal.enableCustomJSON = false;
          this._internal.enableTargetBasedAnimations = false;
          this._internal.gsapConfigSource = 'timeline';
        } else if (this._internal.gsapConfigSource === 'timeline') {
          this._internal.gsapConfigSource = 'properties';
        }
      }
      if (this._internal.gsapAutoStart) {
        this._autoStartActiveAnimation();
      } else {
        this._updateGSAPFromProperties();
      }
    } },
    gsapTimelineSteps: { displayName: 'Timeline Steps (JSON)', group: 'Animation (GSAP) | Advanced', type: { name: 'string', allowEditOnly: true, codeeditor: 'json' }, multiline: true, default: JSON.stringify([{ duration: 1, x: 100, y: 0, ease: 'power2.out' }, { duration: 1, x: 100, y: 100, ease: 'power2.in' }, { duration: 1, x: 0, y: 100, ease: 'power2.out' }, { duration: 1, x: 0, y: 0, ease: 'power2.in' }], null, 2), set: function(v) { this._internal.gsapTimelineSteps = v; this._updateGSAPFromProperties(); } },

    // Stagger configuration removed

    // Path Animations
    gsapPathEnabled: { displayName: 'Enable Path', group: 'Animation (GSAP) | Path', type: 'boolean', default: false, set: function(v) { this._internal.gsapPathEnabled = v; this._updateGSAPFromProperties(); } },
    gsapPathPoints: { displayName: 'Path Points (JSON)', group: 'Animation (GSAP) | Path', type: { name: 'string', allowEditOnly: true, codeeditor: 'json' }, multiline: true, default: JSON.stringify([[0, 0], [100, 50], [200, 0], [300, 100]], null, 2), set: function(v) { this._internal.gsapPathPoints = v; this._updateGSAPFromProperties(); } },
    gsapPathType: { displayName: 'Path Type', group: 'Animation (GSAP) | Path', type: { name: 'enum', enums: ['linear', 'curved', 'cubic'] }, default: 'linear', set: function(v) { this._internal.gsapPathType = v; this._updateGSAPFromProperties(); } },
    gsapPathAlign: { displayName: 'Path Align', group: 'Animation (GSAP) | Path', type: { name: 'enum', enums: ['self', 'start', 'end', 'center'] }, default: 'self', set: function(v) { this._internal.gsapPathAlign = v; this._updateGSAPFromProperties(); } },
    gsapPathAutoRotate: { displayName: 'Auto Rotate', group: 'Animation (GSAP) | Path', type: 'boolean', default: false, set: function(v) { this._internal.gsapPathAutoRotate = v; this._updateGSAPFromProperties(); } },
    gsapPathAlignOrigin: { displayName: 'Align Origin', group: 'Animation (GSAP) | Path', type: 'array', default: [0.5, 0.5], set: function(v) { this._internal.gsapPathAlignOrigin = v; this._updateGSAPFromProperties(); } },

    // Advanced Easing
    gsapAdvancedEase: { displayName: 'Advanced Ease', group: 'Animation (GSAP) | Easing', type: { name: 'enum', enums: ['none', 'custom', 'back.in', 'back.out', 'back.inOut', 'elastic.in', 'elastic.out', 'elastic.inOut', 'bounce.in', 'bounce.out', 'bounce.inOut', 'rough', 'slow', 'steps', 'power1.in', 'power1.out', 'power1.inOut', 'power2.in', 'power2.out', 'power2.inOut', 'power3.in', 'power3.out', 'power3.inOut', 'power4.in', 'power4.out', 'power4.inOut'] }, default: 'none', set: function(v) { this._internal.gsapAdvancedEase = v; this._updateGSAPFromProperties(); } },
    gsapCustomEase: { displayName: 'Custom Ease (Curve Editor)', group: 'Animation (GSAP) | Easing', type: 'curve', default: { curve: [0.25, 0.1, 0.25, 1.0], dur: 1000, delay: 0 }, set: function(v) { this._internal.gsapCustomEase = v; this._compileCustomEase(); this._updateGSAPFromProperties(); } },

    // Performance & Control
    gsapOverwrite: { displayName: 'Overwrite Mode', group: 'Animation (GSAP) | Performance', type: { name: 'enum', enums: ['auto', 'all', 'concurrent', 'preexisting', 'none'] }, default: 'auto', set: function(v) { this._internal.gsapOverwrite = v; this._updateGSAPFromProperties(); } },
    gsapLazy: { displayName: 'Lazy Rendering', group: 'Animation (GSAP) | Performance', type: 'boolean', default: false, set: function(v) { this._internal.gsapLazy = v; this._updateGSAPFromProperties(); } },
    gsapTimeScale: { displayName: 'Time Scale', group: 'Animation (GSAP) | Performance', type: 'number', default: 1, min: 0, max: 10, set: function(v) { this._internal.gsapTimeScale = v; this._updateGSAPFromProperties(); } },
    gsapProgress: { displayName: 'Progress', group: 'Animation (GSAP) | Performance', type: 'number', default: 0, min: 0, max: 1, set: function(v) { this._internal.gsapProgress = v; if (this._gsapTween) this._gsapTween.progress(v); } },

    // Animation Events (Signals)
    gsapEventStart: { displayName: 'On Start', group: 'Animation (GSAP) | Events', type: 'signal' },
    gsapEventUpdate: { displayName: 'On Update', group: 'Animation (GSAP) | Events', type: 'signal' },
    gsapEventComplete: { displayName: 'On Complete', group: 'Animation (GSAP) | Events', type: 'signal' },
    gsapEventRepeat: { displayName: 'On Repeat', group: 'Animation (GSAP) | Events', type: 'signal' },
    gsapEventReverse: { displayName: 'On Reverse', group: 'Animation (GSAP) | Events', type: 'signal' },
    gsapEventPause: { displayName: 'On Pause', group: 'Animation (GSAP) | Events', type: 'signal' },
    gsapEventResume: { displayName: 'On Resume', group: 'Animation (GSAP) | Events', type: 'signal' },
    gsapEventRestart: { displayName: 'On Restart', group: 'Animation (GSAP) | Events', type: 'signal' },

    // Target control section removed

    // Target-Specific Animation Configurations
    // Target 1 Animation Config
    target1AnimationVars: {
      displayName: 'Target 1 Animation (JSON)', group: 'Target 1 Animation', type: { name: 'string', allowEditOnly: true, codeeditor: 'json' }, multiline: true,
      default: JSON.stringify({ duration: 2, x: 100, y: 50, rotation: 0.5, alpha: 0.8, ease: 'power1.inOut' }, null, 2),
      set: function(v) { this._internal.target1AnimationVars = v; }
    },
    target1UseTimeline: { displayName: 'Use Timeline', group: 'Target 1 Animation', type: 'boolean', default: false, set: function(v) { this._internal.target1UseTimeline = v; } },
    target1TimelineSteps: { 
      displayName: 'Timeline Steps (JSON)', group: 'Target 1 Animation', type: { name: 'string', allowEditOnly: true, codeeditor: 'json' }, multiline: true, 
      default: JSON.stringify([{ duration: 1, x: 100, y: 0, ease: 'power2.out' }, { duration: 1, x: 100, y: 100, ease: 'power2.in' }, { duration: 1, x: 0, y: 100, ease: 'power2.out' }, { duration: 1, x: 0, y: 0, ease: 'power2.in' }], null, 2), 
      set: function(v) { this._internal.target1TimelineSteps = v; } 
    },
    target1CreateAnimation: { displayName: 'Create Target 1 Animation', group: 'Target 1 Animation', type: 'signal', valueChangedToTrue: function() { this._createTargetSpecificAnimation(0); } },

    // Target 2 Animation Config
    target2AnimationVars: {
      displayName: 'Target 2 Animation (JSON)', group: 'Target 2 Animation', type: { name: 'string', allowEditOnly: true, codeeditor: 'json' }, multiline: true,
      default: JSON.stringify({ duration: 1.5, scaleX: 1.5, scaleY: 1.5, rotation: -0.3, ease: 'bounce.out' }, null, 2),
      set: function(v) { this._internal.target2AnimationVars = v; }
    },
    target2UseTimeline: { displayName: 'Use Timeline', group: 'Target 2 Animation', type: 'boolean', default: false, set: function(v) { this._internal.target2UseTimeline = v; } },
    target2TimelineSteps: { 
      displayName: 'Timeline Steps (JSON)', group: 'Target 2 Animation', type: { name: 'string', allowEditOnly: true, codeeditor: 'json' }, multiline: true, 
      default: JSON.stringify([{ duration: 0.5, scaleX: 1.5, scaleY: 1.5, ease: 'power2.out' }, { duration: 0.5, scaleX: 1, scaleY: 1, ease: 'power2.in' }, { duration: 0.5, rotation: 1, ease: 'bounce.out' }, { duration: 0.5, rotation: 0, ease: 'back.out' }], null, 2), 
      set: function(v) { this._internal.target2TimelineSteps = v; } 
    },
    target2CreateAnimation: { displayName: 'Create Target 2 Animation', group: 'Target 2 Animation', type: 'signal', valueChangedToTrue: function() { this._createTargetSpecificAnimation(1); } },

    // Target 3 Animation Config
    target3AnimationVars: {
      displayName: 'Target 3 Animation (JSON)', group: 'Target 3 Animation', type: { name: 'string', allowEditOnly: true, codeeditor: 'json' }, multiline: true,
      default: JSON.stringify({ duration: 3, y: -100, alpha: 0.5, ease: 'elastic.out' }, null, 2),
      set: function(v) { this._internal.target3AnimationVars = v; }
    },
    target3UseTimeline: { displayName: 'Use Timeline', group: 'Target 3 Animation', type: 'boolean', default: false, set: function(v) { this._internal.target3UseTimeline = v; } },
    target3TimelineSteps: { 
      displayName: 'Timeline Steps (JSON)', group: 'Target 3 Animation', type: { name: 'string', allowEditOnly: true, codeeditor: 'json' }, multiline: true, 
      default: JSON.stringify([{ duration: 1, y: -50, alpha: 0.8, ease: 'power2.out' }, { duration: 1, y: -100, alpha: 0.5, ease: 'elastic.out' }, { duration: 1, y: -50, alpha: 0.8, ease: 'power2.in' }, { duration: 1, y: 0, alpha: 1, ease: 'bounce.out' }], null, 2), 
      set: function(v) { this._internal.target3TimelineSteps = v; } 
    },
    target3CreateAnimation: { displayName: 'Create Target 3 Animation', group: 'Target 3 Animation', type: 'signal', valueChangedToTrue: function() { this._createTargetSpecificAnimation(2); } },

    // Target 4 Animation Config
    target4AnimationVars: {
      displayName: 'Target 4 Animation (JSON)', group: 'Target 4 Animation', type: { name: 'string', allowEditOnly: true, codeeditor: 'json' }, multiline: true,
      default: JSON.stringify({ duration: 2.5, x: -50, scaleX: 0.8, scaleY: 0.8, ease: 'back.out' }, null, 2),
      set: function(v) { this._internal.target4AnimationVars = v; }
    },
    target4UseTimeline: { displayName: 'Use Timeline', group: 'Target 4 Animation', type: 'boolean', default: false, set: function(v) { this._internal.target4UseTimeline = v; } },
    target4TimelineSteps: { 
      displayName: 'Timeline Steps (JSON)', group: 'Target 4 Animation', type: { name: 'string', allowEditOnly: true, codeeditor: 'json' }, multiline: true, 
      default: JSON.stringify([{ duration: 0.8, x: -25, scaleX: 0.9, ease: 'power2.out' }, { duration: 0.8, x: -50, scaleY: 0.8, ease: 'back.out' }, { duration: 0.9, x: -25, scaleX: 0.9, ease: 'power2.in' }, { duration: 0.8, x: 0, scaleX: 1, scaleY: 1, ease: 'elastic.out' }], null, 2), 
      set: function(v) { this._internal.target4TimelineSteps = v; } 
    },
    target4CreateAnimation: { displayName: 'Create Target 4 Animation', group: 'Target 4 Animation', type: 'signal', valueChangedToTrue: function() { this._createTargetSpecificAnimation(3); } },

    // Target 5 Animation Config
    target5AnimationVars: {
      displayName: 'Target 5 Animation (JSON)', group: 'Target 5 Animation', type: { name: 'string', allowEditOnly: true, codeeditor: 'json' }, multiline: true,
      default: JSON.stringify({ duration: 1, rotation: 1.57, skewX: 0.2, ease: 'power2.inOut', yoyo: true, repeat: -1 }, null, 2),
      set: function(v) { this._internal.target5AnimationVars = v; }
    },
    target5UseTimeline: { displayName: 'Use Timeline', group: 'Target 5 Animation', type: 'boolean', default: false, set: function(v) { this._internal.target5UseTimeline = v; } },
    target5TimelineSteps: { 
      displayName: 'Timeline Steps (JSON)', group: 'Target 5 Animation', type: { name: 'string', allowEditOnly: true, codeeditor: 'json' }, multiline: true, 
      default: JSON.stringify([{ duration: 0.3, rotation: 0.5, skewX: 0.1, ease: 'power2.out' }, { duration: 0.3, rotation: 1, skewX: 0.2, ease: 'power2.in' }, { duration: 0.2, rotation: 1.57, skewX: 0.15, ease: 'bounce.out' }, { duration: 0.2, rotation: 0, skewX: 0, ease: 'elastic.out' }], null, 2), 
      set: function(v) { this._internal.target5TimelineSteps = v; } 
    },
    target5CreateAnimation: { displayName: 'Create Target 5 Animation', group: 'Target 5 Animation', type: 'signal', valueChangedToTrue: function() { this._createTargetSpecificAnimation(4); } },

    // Test signals for debugging
    testAnimation: { displayName: 'Test Animation', group: 'Animation (GSAP) | Control', type: 'signal', valueChangedToTrue: function() { this._testAnimation(); } },
    testSimpleAnimation: { displayName: 'Test Simple Animation', group: 'Animation (GSAP) | Control', type: 'signal', valueChangedToTrue: function() { this._testSimpleAnimation(); } },
    testCustomEase: { displayName: 'Test Custom Ease Curve', group: 'Animation (GSAP) | Easing', type: 'signal', valueChangedToTrue: function() { this._testCustomEase(); } }
  },
  outputs: {
    // Legacy outputs for backwards compatibility
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
        return this._internal.animationState.currentProgress;
      }
    },
    isPlaying: {
      group: 'Status',
      type: 'boolean',
      displayName: 'Is Playing',
      getter: function() {
        return this._internal.animationState.isPlaying;
      }
    },
    isPaused: {
      group: 'Status',
      type: 'boolean',
      displayName: 'Is Paused',
      getter: function() {
        return this._internal.animationState.isPaused;
      }
    },

    // --- Advanced GSAP Outputs ---
    gsapProgress: { displayName: 'Animation Progress', group: 'Animation (GSAP) | State', type: 'number', getter: function() { return this._gsapTween?.progress() || 0; } },
    gsapTime: { displayName: 'Animation Time', group: 'Animation (GSAP) | State', type: 'number', getter: function() { return this._gsapTween?.time() || 0; } },
    gsapDuration: { displayName: 'Animation Duration', group: 'Animation (GSAP) | State', type: 'number', getter: function() { return this._gsapTween?.duration() || 0; } },
    gsapPaused: { displayName: 'Animation Paused', group: 'Animation (GSAP) | State', type: 'boolean', getter: function() { return this._gsapTween?.paused() || false; } },
    gsapReversed: { displayName: 'Animation Reversed', group: 'Animation (GSAP) | State', type: 'boolean', getter: function() { return this._gsapTween?.reversed() || false; } },
    gsapActive: { displayName: 'Animation Active', group: 'Animation (GSAP) | State', type: 'boolean', getter: function() { return this._gsapTween?.isActive() || false; } },
    gsapRepeatCount: { displayName: 'Repeat Count', group: 'Animation (GSAP) | State', type: 'number', getter: function() { return this._gsapTween?.repeat() || 0; } },
    gsapYoyoCount: { displayName: 'Yoyo Count', group: 'Animation (GSAP) | State', type: 'number', getter: function() { return this._gsapTween?.yoyo() || 0; } },

    // Critical Error Handling Output
    animationError: { displayName: 'Animation Error', group: 'Status', type: 'string', getter: function() { return this._internal.lastError || ''; } },
    animationWarning: { displayName: 'Animation Warning', group: 'Status', type: 'string', getter: function() { return this._internal.lastWarning || ''; } },

    // Performance Monitoring Outputs
    frameRate: { displayName: 'Frame Rate (FPS)', group: 'Performance', type: 'number', getter: function() { return this._internal.performanceMetrics.currentFPS || 0; } },
    updateCount: { displayName: 'Update Count', group: 'Performance', type: 'number', getter: function() { return this._internal.performanceMetrics.updateCount || 0; } },
    averageFrameTime: { displayName: 'Avg Frame Time (ms)', group: 'Performance', type: 'number', getter: function() { return this._internal.performanceMetrics.avgFrameTime || 0; } }
  },
  onNodeDestroy: function() {
    // Clean up when the node is destroyed
    // console.log(`[AnimationTarget ${this.id}] Node destroying, cleaning up all resources`);
    
    this._killAllAnimations();
    
    // Clear performance monitoring timer
    if (this._performanceTimer) {
      clearInterval(this._performanceTimer);
      this._performanceTimer = null;
    }
    
    // Clear error tracking
    this._internal.lastError = '';
    this._internal.lastWarning = '';
    
    // console.log(`[AnimationTarget ${this.id}] Node cleanup complete`);
  },
  methods: {
    // === CRITICAL ERROR HANDLING METHODS ===
    _logError: function(error, context = 'Unknown') {
      const errorMsg = `[${context}] ${error.message || error}`;
      console.error(`[AnimationTarget ${this.id}] ERROR:`, errorMsg, error);
      
      this._internal.lastError = errorMsg;
      this._internal.errorCount++;
      this.flagOutputDirty('animationError');
      
      // Auto-clear error after 5 seconds to prevent stale error states
      setTimeout(() => {
        if (this._internal.lastError === errorMsg) {
          this._internal.lastError = '';
          this.flagOutputDirty('animationError');
        }
      }, 5000);
    },

    _logWarning: function(warning, context = 'Unknown') {
      const warningMsg = `[${context}] ${warning}`;
      // console.warn(`[AnimationTarget ${this.id}] WARNING:`, warningMsg);
      
      this._internal.lastWarning = warningMsg;
      this.flagOutputDirty('animationWarning');
      
      // Auto-clear warning after 3 seconds
      setTimeout(() => {
        if (this._internal.lastWarning === warningMsg) {
          this._internal.lastWarning = '';
          this.flagOutputDirty('animationWarning');
        }
      }, 3000);
    },

    _safeJsonParse: function(jsonString, defaultValue = {}, context = 'JSON Parse') {
      try {
        if (!jsonString || typeof jsonString !== 'string') {
          this._logWarning(`Invalid JSON input: ${typeof jsonString}`, context);
          return defaultValue;
        }
        return JSON.parse(jsonString);
      } catch (error) {
        this._logError(error, context);
        return defaultValue;
      }
    },

    _safeExecute: function(fn, context = 'Unknown', fallback = null) {
      try {
        return fn();
      } catch (error) {
        this._logError(error, context);
        return fallback;
      }
    },

    // === PERFORMANCE MONITORING ===
    _updatePerformanceMetrics: function() {
      const metrics = this._internal.performanceMetrics;
      
      // Calculate FPS from frame time history
      if (metrics.frameTimeHistory.length > 0) {
        const totalFrameTime = metrics.frameTimeHistory.reduce((sum, time) => sum + time, 0);
        metrics.avgFrameTime = Math.round((totalFrameTime / metrics.frameTimeHistory.length) * 100) / 100;
        metrics.currentFPS = Math.round(1000 / metrics.avgFrameTime);
        
        // Clear history to prevent memory growth
        metrics.frameTimeHistory = [];
      }
      
      // Flag performance outputs for update
      this.flagOutputDirty('frameRate');
      this.flagOutputDirty('averageFrameTime');
      this.flagOutputDirty('updateCount');
      
      // Performance warnings
      if (metrics.currentFPS < 30 && metrics.currentFPS > 0) {
        this._logWarning(`Low frame rate detected: ${metrics.currentFPS} FPS`, 'Performance Monitor');
      }
      
      if (metrics.updateCount > 1000) {
        // this._logWarning(`High update count: ${metrics.updateCount} updates/sec`, 'Performance Monitor');
      }
    },

    _recordFrameTime: function() {
      const now = performance.now();
      const metrics = this._internal.performanceMetrics;
      
      if (metrics.lastUpdateTime > 0) {
        const frameTime = now - metrics.lastUpdateTime;
        metrics.frameTimeHistory.push(frameTime);
        
        // Limit history size for memory efficiency
        if (metrics.frameTimeHistory.length > 60) { // Keep last 60 frames
          metrics.frameTimeHistory.shift();
        }
      }
      
      metrics.lastUpdateTime = now;
      metrics.updateCount++;
    },

    // === STATE CONSISTENCY MANAGEMENT ===
    _updateAnimationState: function(state, source = 'Unknown') {
      const oldState = { ...this._internal.animationState };
      
      // Update state with validation
      if (typeof state.isPlaying === 'boolean') {
        this._internal.animationState.isPlaying = state.isPlaying;
      }
      if (typeof state.isPaused === 'boolean') {
        this._internal.animationState.isPaused = state.isPaused;
      }
      if (typeof state.currentProgress === 'number') {
        this._internal.animationState.currentProgress = Math.max(0, Math.min(1, state.currentProgress));
      }
      
      // Check for consistency issues
      if (this._internal.animationState.isPlaying && this._internal.animationState.isPaused) {
        this._logWarning('State inconsistency: animation cannot be both playing and paused', 'State Management');
        this._internal.animationState.isPaused = false; // Prioritize playing
      }
      
      // Only flag outputs if state actually changed
      if (oldState.isPlaying !== this._internal.animationState.isPlaying) {
        this.flagOutputDirty('isPlaying');
      }
      if (oldState.isPaused !== this._internal.animationState.isPaused) {
        this.flagOutputDirty('isPaused');
      }
      if (oldState.currentProgress !== this._internal.animationState.currentProgress) {
        this.flagOutputDirty('currentProgress');
      }
      
      // console.log(`[AnimationTarget ${this.id}] State updated by ${source}:`, this._internal.animationState);
    },

    _getActiveAnimationCount: function() {
      let count = 0;
      
      // Count main animation
      if (this._gsapTween && typeof this._gsapTween.isActive === 'function' && this._gsapTween.isActive()) {
        count++;
      }
      
      // Count target animations
      if (this._targetTweens) {
        this._targetTweens.forEach(tween => {
          if (tween && typeof tween.isActive === 'function' && tween.isActive()) {
            count++;
          }
        });
      }
      
      // Count event animations
      if (this._gsapEventTweens) {
        this._gsapEventTweens.forEach(tween => {
          if (tween && typeof tween.isActive === 'function' && tween.isActive()) {
            count++;
          }
        });
      }
      
      return count;
    },

    _updateTargetNodes: function() {
      // Update the array of target nodes
      this._internal.targetNodes = [];
      
      ['targetNode', 'targetNode2', 'targetNode3', 'targetNode4', 'targetNode5'].forEach((prop) => {
        if (this._internal[prop]) {
          this._internal.targetNodes.push(this._internal[prop]);
        }
      });

      // console.log(`Animation Target - Updated target nodes: ${this._internal.targetNodes.length} targets`);
      this._internal.targetNodes.forEach((target, index) => {
        // console.log(`Animation Target - Target ${index + 1}:`, this._getTargetDisplayName(target));
      });

      // Auto-start animation when targets are connected
      if (this._internal.targetNodes.length > 0) {
        // console.log(`Animation Target - Auto-starting animation for ${this._internal.targetNodes.length} targets`);
        // Delay the animation start slightly to ensure proper initialization
        setTimeout(() => {
          if (this._internal.gsapStrictConfigEnabled && this._internal.gsapAutoStart) {
            this._autoStartActiveAnimation();
          } else {
            this._updateGSAPAnimation();
          }
        }, 100);
      }
    },

    _getTargetDisplayName: function(target) {
      if (!target) return 'Unknown Target';
      
      try {
        if (typeof target.getDisplayName === 'function') {
          return target.getDisplayName();
        }
        return target.displayName || target.name || 'Unknown Target';
      } catch (error) {
        console.warn('Animation Target - Error getting target display name:', error);
        return 'Unknown Target';
      }
    },

    _getPixiObjectType: function(target) {
      if (this._isPixiSpriteNode(target)) return 'PIXI.Sprite';
      if (this._isPixiTextNode(target)) return 'PIXI.Text';
      if (this._isPixiGraphicsNode(target)) return 'PIXI.Graphics';
      if (this._isPixiTilingSpriteNode(target)) return 'PIXI.TilingSprite';
      if (this._isPixiParticleContainerNode(target)) return 'PIXI.ParticleContainer';
      if (this._isPixiAnimatedSpriteNode(target)) return 'PIXI.AnimatedSprite';
      if (this._isPixiObject(target)) return 'PIXI.Object';
      return 'Unknown';
    },

    // --- GSAP Animation Methods ---
    _autoStartActiveAnimation: function() {
      try {
        // Stop any existing animations to prevent interference
        this._killAllAnimations();

        const strict = !!this._internal.gsapStrictConfigEnabled;
        const source = this._internal.gsapConfigSource || 'properties';
        const hasTargets = this._internal.targetNodes && this._internal.targetNodes.length > 0;
        if (!hasTargets) {
          // console.log(`[AnimationTarget ${this.id}] Auto-start skipped - no targets`);
          return;
        }

        if (strict) {
          // console.log(`[AnimationTarget ${this.id}] Auto-start (strict) with source: ${source}`);
          switch (source) {
            case 'json': {
              // Use JSON config directly
              this._updateGSAPAnimation();
              return;
            }
            case 'timeline': {
              const baseVars = {
                delay: this._internal.gsapDelay ?? 0,
                repeat: this._internal.gsapRepeat ?? -1,
                yoyo: this._internal.gsapYoyo ?? true,
                timeScale: this._internal.gsapTimeScale ?? 1
              };
              this._createTimelineAnimation(baseVars);
              return;
            }
            case 'targetBased': {
              // Auto-create target animations based on their configured vars/timeline
              const total = this._internal.targetNodes.length;
              for (let i = 0; i < total; i++) {
                this._createTargetSpecificAnimation(i);
              }
              return;
            }
            case 'properties':
            default: {
              this._updateGSAPFromProperties();
              return;
            }
          }
        } else {
          // Non-strict: prefer JSON if enabled and valid else properties; timeline if gsapUseTimeline is true
          if (this._internal.gsapUseTimeline) {
            const baseVars = {
              delay: this._internal.gsapDelay ?? 0,
              repeat: this._internal.gsapRepeat ?? -1,
              yoyo: this._internal.gsapYoyo ?? true,
              timeScale: this._internal.gsapTimeScale ?? 1
            };
            this._createTimelineAnimation(baseVars);
            return;
          }
          if (this._internal.enableCustomJSON) {
            const vars = this._safeJsonParse(this._internal.gsapVars, null, 'AutoStart JSON');
            if (vars && Object.keys(vars).length > 0) {
              this._updateGSAPAnimation();
              return;
            }
          }
          if (this._internal.enableTargetBasedAnimations) {
            const total = this._internal.targetNodes.length;
            for (let i = 0; i < total; i++) {
              this._createTargetSpecificAnimation(i);
            }
            return;
          }
          this._updateGSAPFromProperties();
        }
      } catch (e) {
        this._logError(e, 'Auto Start Active Animation');
      }
    },
    _updateGSAPAnimation: function() {
      // console.log(`[AnimationTarget ${this.id}] _updateGSAPAnimation called`);
      // console.log(`[AnimationTarget ${this.id}] Targets available: ${this._internal.targetNodes.length}`);

      // Clean up any existing animation
      if (this._gsapTween) {
        // console.log(`[AnimationTarget ${this.id}] Killing existing tween`);
        this._gsapTween.kill();
        this._gsapTween = null;
      }

      // Exit if no targets
      if (this._internal.targetNodes.length === 0) {
        // console.log(`[AnimationTarget ${this.id}] GSAP update skipped - no targets: ${this._internal.targetNodes.length}`);
        return;
      }

      // Strict configuration handling
      if (this._internal.gsapStrictConfigEnabled) {
        const mode = this._internal.gsapConfigSource || 'properties';
        // console.log(`[AnimationTarget ${this.id}] Strict mode active, source: ${mode}`);
        if (mode === 'targetBased') {
          // Do not create a main tween in target-based mode
          // console.log(`[AnimationTarget ${this.id}] Strict mode: targetBased selected - skipping main tween creation`);
          return;
        }
        if (mode === 'timeline') {
          // Build baseVars from properties, timeline steps will be used inside
          const baseVars = {
            delay: this._internal.gsapDelay ?? 0,
            repeat: this._internal.gsapRepeat ?? -1,
            yoyo: this._internal.gsapYoyo ?? true,
            timeScale: this._internal.gsapTimeScale ?? 1
          };
          this._createTimelineAnimation(baseVars);
          return;
        }
        if (mode === 'properties') {
          this._updateGSAPFromProperties();
          return;
        }
        // else mode === 'json' falls through to JSON handling below
      }

      // console.log(`[AnimationTarget ${this.id}] Raw gsapVars:`, this._internal.gsapVars);
      const vars = this._safeJsonParse(this._internal.gsapVars, {}, 'GSAP Vars Parsing');
      
      if (!vars || Object.keys(vars).length === 0) {
        if (this._internal.gsapStrictConfigEnabled && this._internal.gsapConfigSource === 'json') {
          this._logWarning('Strict JSON mode selected but gsapVars is empty/invalid. Skipping animation.', 'GSAP Animation');
          return;
        }
        this._logWarning('GSAP vars is empty or invalid, falling back to individual properties', 'GSAP Animation');
        this._updateGSAPFromProperties();
        return;
      }
      
      // console.log(`[AnimationTarget ${this.id}] Parsed GSAP vars:`, vars);

      // If vars is empty, fallback to individual properties
      if (!vars || Object.keys(vars).length === 0) {
        // console.log(`[AnimationTarget ${this.id}] GSAP vars is empty, falling back to individual properties...`);
        this._updateGSAPFromProperties();
        return;
      }

      // Create target animations for all connected targets
      this._createTargetAnimations(vars);
    },

    _createTargetAnimations: function(baseVars) {
      // console.log(`[AnimationTarget ${this.id}] Creating target animations for ${this._internal.targetNodes.length} targets`);

      // Create animation proxies for each target
      const targetProxies = [];
      this._internal.targetNodes.forEach((target, index) => {
        if (!target) return;
        
        // console.log(`[AnimationTarget ${this.id}] Preparing target ${index + 1}:`, this._getTargetDisplayName(target));
        const proxy = this._prepareAnimationTarget(target);
        if (proxy) {
          targetProxies.push(proxy);
        }
      });

      if (targetProxies.length === 0) {
        console.warn(`[AnimationTarget ${this.id}] No valid targets prepared for animation`);
        return;
      }

      // Add comprehensive callbacks
      const vars = { ...baseVars };
      vars.onUpdate = () => {
        // Record performance metrics
        this._recordFrameTime();
        
        // Update state consistently
        const progress = this._gsapTween ? this._gsapTween.progress() : 0;
        this._updateAnimationState({
          isPlaying: true,
          isPaused: false,
          currentProgress: progress
        }, 'Main Animation Update');
        
        this.sendSignalOnOutput('onUpdate');
        if (this._internal.gsapEventUpdate) this.sendSignalOnOutput('gsapEventUpdate');
      };

      vars.onStart = () => {
        // console.log(`[AnimationTarget ${this.id}] GSAP animation started`);
        this._updateAnimationState({
          isPlaying: true,
          isPaused: false
        }, 'Main Animation Start');
        
        this.sendSignalOnOutput('onStart');
        if (this._internal.gsapEventStart) this.sendSignalOnOutput('gsapEventStart');
      };

      vars.onComplete = () => {
        // console.log(`[AnimationTarget ${this.id}] GSAP animation completed`);
        
        // Check if any other animations are still active before marking as not playing
        const activeCount = this._getActiveAnimationCount();
        this._updateAnimationState({
          isPlaying: activeCount > 1, // Still playing if other animations are active
          currentProgress: 1
        }, 'Main Animation Complete');
        
        this.sendSignalOnOutput('onComplete');
        if (this._internal.gsapEventComplete) this.sendSignalOnOutput('gsapEventComplete');
      };

      vars.onRepeat = () => {
        if (this._internal.gsapEventRepeat) this.sendSignalOnOutput('gsapEventRepeat');
      };

      vars.onReverse = () => {
        if (this._internal.gsapEventReverse) this.sendSignalOnOutput('gsapEventReverse');
      };

      vars.onPause = () => {
        this._updateAnimationState({
          isPaused: true
        }, 'Main Animation Pause');
        
        if (this._internal.gsapEventPause) this.sendSignalOnOutput('gsapEventPause');
      };

      vars.onResume = () => {
        this._updateAnimationState({
          isPaused: false
        }, 'Main Animation Resume');
        
        if (this._internal.gsapEventResume) this.sendSignalOnOutput('gsapEventResume');
      };

      vars.onRestart = () => {
        if (this._internal.gsapEventRestart) this.sendSignalOnOutput('gsapEventRestart');
      };

      // console.log(`[AnimationTarget ${this.id}] Creating GSAP tween with vars:`, vars);
      // console.log(`[AnimationTarget ${this.id}] Target proxies:`, targetProxies.length);

      try {
        if (targetProxies.length === 1) {
          this._gsapTween = gsap.to(targetProxies[0], vars);
        } else {
          this._gsapTween = gsap.to(targetProxies, vars);
        }
        // console.log(`[AnimationTarget ${this.id}] GSAP tween created successfully and auto-playing:`, this._gsapTween);
        
        // Ensure animation starts playing immediately
        if (this._gsapTween) {
          this._gsapTween.play();
          // Update animation state to reflect that it's playing
          this._internal.animationState.isPlaying = true;
          this._internal.animationState.isPaused = false;
          this.flagOutputDirty('isPlaying');
          this.flagOutputDirty('isPaused');
        }
      } catch (error) {
        console.error(`[AnimationTarget ${this.id}] Error creating GSAP tween:`, error);
      }
    },

    _prepareAnimationTarget: function(target) {
      if (!target) {
        this._logWarning('Target is null or undefined', 'Target Preparation');
        return null;
      }

      // console.log(`[AnimationTarget ${this.id}] Preparing animation target:`, this._getTargetDisplayName(target));

      return this._safeExecute(() => {
        // 1. Robust PIXI sprite node detection
        if (this._isPixiSpriteNode(target)) {
          // console.log(`[AnimationTarget ${this.id}] Detected PIXI sprite node (${this._getPixiObjectType(target)}), using pixiObject directly`);
          return target.pixiObject;
        }

        // 2. PIXI Text node detection
        if (this._isPixiTextNode(target)) {
          // console.log(`[AnimationTarget ${this.id}] Detected PIXI text node (${this._getPixiObjectType(target)}), using textObject directly`);
          return target.textObject;
        }

        // 3. PIXI Graphics node detection
        if (this._isPixiGraphicsNode(target)) {
          // console.log(`[AnimationTarget ${this.id}] Detected PIXI graphics node (${this._getPixiObjectType(target)}), using graphicsObject directly`);
          return target.graphicsObject;
        }

        // 4. PIXI TilingSprite node detection
        if (this._isPixiTilingSpriteNode(target)) {
          // console.log(`[AnimationTarget ${this.id}] Detected PIXI tiling sprite node (${this._getPixiObjectType(target)}), using tilingSpriteObject directly`);
          return target.tilingSpriteObject;
        }

        // 5. PIXI ParticleContainer node detection
        if (this._isPixiParticleContainerNode(target)) {
          // console.log(`[AnimationTarget ${this.id}] Detected PIXI particle container node (${this._getPixiObjectType(target)}), using containerObject directly`);
          return target.containerObject;
        }

        // 6. PIXI AnimatedSprite node detection
        if (this._isPixiAnimatedSpriteNode(target)) {
          // console.log(`[AnimationTarget ${this.id}] Detected PIXI animated sprite node (${this._getPixiObjectType(target)}), using animatedSpriteObject directly`);
          return target.animatedSpriteObject;
        }

        // 7. Robust PIXI object detection (fallback)
        if (this._isPixiObject(target)) {
          // console.log(`[AnimationTarget ${this.id}] Detected PIXI object, using directly`);
          return target;
        }

        // 8. DOM element detection with validation
        if (this._isDomElementTarget(target)) {
          // console.log(`[AnimationTarget ${this.id}] Detected DOM element target`);
          return this._createReactComponentProxy(target);
        }

        // 9. React component with ref detection
        if (this._isReactComponentWithRef(target)) {
          // console.log(`[AnimationTarget ${this.id}] Detected React component with ref`);
          return this._createReactComponentProxy(target);
        }

        // 10. Fallback for objects with animatable properties
        if (this._hasAnimatableProperties(target)) {
          // console.log(`[AnimationTarget ${this.id}] Detected object with animatable properties`);
          return target;
        }

        // 11. Last resort: create proxy with warning
        this._logWarning(`Unknown target type, creating proxy with limited functionality for: ${this._getTargetDisplayName(target)}`, 'Target Preparation');
        return this._createReactComponentProxy(target);
      }, 'Target Preparation', null);
    },

    // Robust target type detection methods
    _isPixiSpriteNode: function(target) {
      return target && 
             target.pixiObject && 
             typeof target.pixiObject === 'object' &&
             typeof target.pixiObject.x === 'number' && 
             typeof target.pixiObject.alpha === 'number';
    },

    _isPixiTextNode: function(target) {
      return target && 
             target.textObject && 
             typeof target.textObject === 'object' &&
             typeof target.textObject.x === 'number' && 
             typeof target.textObject.alpha === 'number';
    },

    _isPixiGraphicsNode: function(target) {
      return target && 
             target.graphicsObject && 
             typeof target.graphicsObject === 'object' &&
             typeof target.graphicsObject.x === 'number' && 
             typeof target.graphicsObject.alpha === 'number';
    },

    _isPixiTilingSpriteNode: function(target) {
      return target && 
             target.tilingSpriteObject && 
             typeof target.tilingSpriteObject === 'object' &&
             typeof target.tilingSpriteObject.x === 'number' && 
             typeof target.tilingSpriteObject.alpha === 'number';
    },

    _isPixiParticleContainerNode: function(target) {
      return target && 
             target.containerObject && 
             typeof target.containerObject === 'object' &&
             typeof target.containerObject.x === 'number' && 
             typeof target.containerObject.alpha === 'number';
    },

    _isPixiAnimatedSpriteNode: function(target) {
      return target && 
             target.animatedSpriteObject && 
             typeof target.animatedSpriteObject === 'object' &&
             typeof target.animatedSpriteObject.x === 'number' && 
             typeof target.animatedSpriteObject.alpha === 'number';
    },

    _isPixiObject: function(target) {
      return target &&
             typeof target.x === 'number' && 
             typeof target.y === 'number' && 
             typeof target.alpha === 'number' &&
             target.constructor && 
             target.constructor.name && 
             (target.constructor.name.includes('Sprite') ||
              target.constructor.name.includes('Text') ||
              target.constructor.name.includes('Container') ||
              target.constructor.name.includes('Graphics') ||
              target.constructor.name.includes('ParticleEmitter'));
    },

    _isDomElementTarget: function(target) {
      return target && 
             target.domElement && 
             target.domElement.style &&
             typeof target.domElement.style === 'object';
    },

    _isReactComponentWithRef: function(target) {
      return target && 
             target.reactComponentRef && 
             (target.reactComponentRef.base || target.reactComponentRef.current);
    },

    _hasAnimatableProperties: function(target) {
      return target &&
             typeof target === 'object' &&
             (typeof target.x === 'number' || target.x === undefined) &&
             (typeof target.y === 'number' || target.y === undefined) &&
             (typeof target.alpha === 'number' || target.alpha === undefined);
    },

    _createReactComponentProxy: function(target) {
      // console.log(`[AnimationTarget ${this.id}] Creating React component proxy for:`, this._getTargetDisplayName(target));

      // Create a proxy object that GSAP can animate
      const proxy = {
        // Transform properties
        x: 0,
        y: 0,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        alpha: 1,
        skewX: 0,
        skewY: 0,
        
        // Store reference to target
        _target: target,
        _targetType: 'react'
      };

      // Get current values if possible
      try {
        if (target._currentTransform) {
          proxy.x = target._currentTransform.x || 0;
          proxy.y = target._currentTransform.y || 0;
          proxy.scaleX = target._currentTransform.scaleX || 1;
          proxy.scaleY = target._currentTransform.scaleY || 1;
          proxy.rotation = target._currentTransform.rotation || 0;
          proxy.alpha = target._currentTransform.alpha || 1;
        }
      } catch (error) {
        // console.log(`[AnimationTarget ${this.id}] Could not read current transform values:`, error);
      }

      // Override property setters to apply CSS transforms
      Object.defineProperty(proxy, 'x', {
        get: function() { return this._x || 0; },
        set: function(value) {
          this._x = value;
          this._updateTarget();
        }
      });

      Object.defineProperty(proxy, 'y', {
        get: function() { return this._y || 0; },
        set: function(value) {
          this._y = value;
          this._updateTarget();
        }
      });

      Object.defineProperty(proxy, 'scaleX', {
        get: function() { return this._scaleX || 1; },
        set: function(value) {
          this._scaleX = value;
          this._updateTarget();
        }
      });

      Object.defineProperty(proxy, 'scaleY', {
        get: function() { return this._scaleY || 1; },
        set: function(value) {
          this._scaleY = value;
          this._updateTarget();
        }
      });

      Object.defineProperty(proxy, 'rotation', {
        get: function() { return this._rotation || 0; },
        set: function(value) {
          this._rotation = value;
          this._updateTarget();
        }
      });

      Object.defineProperty(proxy, 'alpha', {
        get: function() { return this._alpha || 1; },
        set: function(value) {
          this._alpha = value;
          this._updateTargetOpacity();
        }
      });

      Object.defineProperty(proxy, 'skewX', {
        get: function() { return this._skewX || 0; },
        set: function(value) {
          this._skewX = value;
          this._updateTarget();
        }
      });

      Object.defineProperty(proxy, 'skewY', {
        get: function() { return this._skewY || 0; },
        set: function(value) {
          this._skewY = value;
          this._updateTarget();
        }
      });

      // Method to apply transform to target with robust error handling
      proxy._updateTarget = function() {
        const target = this._target;
        if (!target) {
          this._logTargetWarning('No target available for transform update');
          return;
        }

        const transformProps = {
          x: this._x || 0,
          y: this._y || 0,
          scaleX: this._scaleX || 1,
          scaleY: this._scaleY || 1,
          rotation: this._rotation || 0,
          skewX: this._skewX || 0,
          skewY: this._skewY || 0
        };

        const transformString = `translate(${transformProps.x}px, ${transformProps.y}px) scale(${transformProps.scaleX}, ${transformProps.scaleY}) rotate(${transformProps.rotation}rad) skew(${transformProps.skewX}rad, ${transformProps.skewY}rad)`;

        // console.log(`[AnimationTarget] Attempting to apply transform: ${transformString}`);

        // Try update methods in order of preference with error handling
        const updateMethods = [
          {
            name: 'setStyle',
            condition: () => target.setStyle && typeof target.setStyle === 'function',
            execute: () => target.setStyle({ transform: transformString })
          },
          {
            name: 'updateTransform',
            condition: () => target.updateTransform && typeof target.updateTransform === 'function',
            execute: () => {
              if (!target.transforms) target.transforms = {};
              target.transforms.x = transformProps.x + 'px';
              target.transforms.y = transformProps.y + 'px';
              target.transforms.scale = transformProps.scaleX;
              target.transforms.rotation = transformProps.rotation + 'rad';
              target.updateTransform();
            }
          },
          {
            name: 'directDOM',
            condition: () => {
              const element = target.getDOMElement?.() || target.domElement || target.element;
              return element && element.style;
            },
            execute: () => {
              const element = target.getDOMElement?.() || target.domElement || target.element;
              element.style.transform = transformString;
            }
          }
        ];

        let transformApplied = false;
        let lastError = null;

        for (const method of updateMethods) {
          try {
            if (method.condition()) {
              // console.log(`[AnimationTarget] Using ${method.name} method`);
              method.execute();
              transformApplied = true;
              break;
            }
          } catch (error) {
            console.warn(`[AnimationTarget] Method ${method.name} failed:`, error);
            lastError = error;
          }
        }

        if (transformApplied) {
          // console.log(`[AnimationTarget] Successfully applied transform`);
        } else {
          this._logTargetError(`Could not apply transform. Last error: ${lastError?.message || 'No suitable method found'}. Available methods: ${Object.keys(target).join(', ')}`);
        }
      };

      // Error logging helpers for proxy
      proxy._logTargetError = function(message) {
        console.error(`[AnimationTarget] Proxy Error: ${message}`);
      };

      proxy._logTargetWarning = function(message) {
        console.warn(`[AnimationTarget] Proxy Warning: ${message}`);
      };

      // Method to apply opacity to target
      proxy._updateTargetOpacity = function() {
        if (!this._target) {
          console.warn(`[AnimationTarget] No target available for opacity update`);
          return;
        }

        const alpha = this._alpha || 1;

        // console.log(`[AnimationTarget] Attempting to apply opacity: ${alpha}`);

        try {
          let opacityApplied = false;

          if (this._target.setStyle && typeof this._target.setStyle === 'function') {
            // console.log(`[AnimationTarget] Using setStyle method for opacity`);
            this._target.setStyle({ opacity: alpha });
            opacityApplied = true;
          } else {
            // Try to access DOM element directly
            let element = this._target.getDOMElement ? this._target.getDOMElement() : 
                         this._target.domElement ? this._target.domElement :
                         this._target.element ? this._target.element : null;

            // console.log(`[AnimationTarget] Trying direct DOM access for opacity, element:`, element);

            if (element && element.style) {
              // console.log(`[AnimationTarget] Applying opacity to DOM element`);
              element.style.opacity = alpha;
              opacityApplied = true;
            }
          }

          if (opacityApplied) {
            // console.log(`[AnimationTarget] Successfully applied opacity: ${alpha}`);
          } else {
            console.warn(`[AnimationTarget] Could not apply opacity - no suitable method found`);
          }
        } catch (error) {
          console.error(`[AnimationTarget] Error applying opacity:`, error);
          console.error(`[AnimationTarget] Target was:`, this._target);
        }
      };

      // console.log(`[AnimationTarget ${this.id}] Created proxy with initial values:`, proxy);
      return proxy;
    },

    _updateGSAPFromProperties: function() {
      // console.log(`[AnimationTarget ${this.id}] _updateGSAPFromProperties called`);

      if (this._internal.targetNodes.length === 0) {
        // console.log(`[AnimationTarget ${this.id}] No targets available for animation`);
        return;
      }

      // Clean up any existing animation
      if (this._gsapTween) {
        this._gsapTween.kill();
        this._gsapTween = null;
      }

      // Build base animation object from individual properties
      const baseVars = {
        duration: this._internal.gsapDuration ?? 2,
        delay: this._internal.gsapDelay ?? 0,
        repeat: this._internal.gsapRepeat ?? -1,
        yoyo: this._internal.gsapYoyo ?? true,
        ease: this._internal.gsapEase ?? 'power1.inOut',
        overwrite: this._internal.gsapOverwrite ?? 'auto',
        lazy: this._internal.gsapLazy ?? false,
        timeScale: this._internal.gsapTimeScale ?? 1
      };

      // Add target properties if they exist
      const targetProps = {};
      if (this._internal.gsapTargetX !== undefined) targetProps.x = this._internal.gsapTargetX;
      if (this._internal.gsapTargetY !== undefined) targetProps.y = this._internal.gsapTargetY;
      if (this._internal.gsapTargetAlpha !== undefined) targetProps.alpha = this._internal.gsapTargetAlpha;
      if (this._internal.gsapTargetRotation !== undefined) targetProps.rotation = this._internal.gsapTargetRotation;
      if (this._internal.gsapTargetScaleX !== undefined) targetProps.scaleX = this._internal.gsapTargetScaleX;
      if (this._internal.gsapTargetScaleY !== undefined) targetProps.scaleY = this._internal.gsapTargetScaleY;
      if (this._internal.gsapTargetSkewX !== undefined) targetProps.skewX = this._internal.gsapTargetSkewX;
      if (this._internal.gsapTargetSkewY !== undefined) targetProps.skewY = this._internal.gsapTargetSkewY;

      // Handle advanced features
      if (this._internal.gsapUseTimeline) {
        this._createTimelineAnimation(baseVars);
        return;
      }

      // Stagger configuration removed

      if (this._internal.gsapPathEnabled) {
        this._createPathAnimation(baseVars);
        return;
      }

      // Handle advanced easing
      if (this._internal.gsapAdvancedEase && this._internal.gsapAdvancedEase !== 'none') {
        if (this._internal.gsapAdvancedEase === 'custom') {
          // Ensure custom ease is compiled before using it
          if (!this._internal.compiledCustomEase) {
            this._compileCustomEase();
          }
          baseVars.ease = this._createCustomEase();
        } else {
          baseVars.ease = this._internal.gsapAdvancedEase;
        }
      }

      // If no target properties, don't create animation
      if (Object.keys(targetProps).length === 0) {
        // console.log(`[AnimationTarget ${this.id}] No target properties defined, skipping animation`);
        return;
      }

      // Merge target properties with base vars
      Object.assign(baseVars, targetProps);

      // console.log(`[AnimationTarget ${this.id}] Creating GSAP animation from properties:`, baseVars);

      this._createTargetAnimations(baseVars);
    },

    // --- Advanced GSAP Animation Methods ---
    _createTimelineAnimation: function(baseVars) {
      // console.log(`[AnimationTarget ${this.id}] Creating timeline animation`);

      const steps = this._safeJsonParse(this._internal.gsapTimelineSteps, [], 'Timeline Steps');
      if (!this._validateTimelineSteps(steps)) {
        this._logError(new Error('Invalid timeline steps format'), 'Timeline Creation');
        return;
      }

      try {
        const timeline = gsap.timeline({
          delay: baseVars.delay,
          repeat: baseVars.repeat,
          yoyo: baseVars.yoyo,
          timeScale: baseVars.timeScale
        });

        // Prepare target proxies
        const targetProxies = [];
        this._internal.targetNodes.forEach((target) => {
          if (!target) return;
          const proxy = this._prepareAnimationTarget(target);
          if (proxy) targetProxies.push(proxy);
        });

        if (targetProxies.length === 0) return;

        let currentTime = 0;
        steps.forEach((step, index) => {
          const stepVars = { ...step };
          delete stepVars.duration;

          if (Object.keys(stepVars).length > 0) {
            timeline.to(targetProxies, stepVars, currentTime);
          }
          currentTime += step.duration || 1;
        });

        this._gsapTween = timeline;
        // console.log(`[AnimationTarget ${this.id}] Timeline animation created with ${steps.length} steps`);
        // Ensure timeline starts automatically
        if (this._gsapTween && typeof this._gsapTween.play === 'function') {
          this._gsapTween.play();
        }
      } catch (error) {
        this._logError(error, 'Timeline Animation Creation');
      }
    },

    // Stagger animation removed

    _createPathAnimation: function(baseVars) {
      // console.log(`[AnimationTarget ${this.id}] Creating path animation`);

      const points = this._safeJsonParse(this._internal.gsapPathPoints, [], 'Path Points');
      const path = this._createPathFromPoints(points, this._internal.gsapPathType);

      if (!path) {
        this._logError(new Error('Invalid path points provided'), 'Path Animation Creation');
        return;
      }

      try {

        // Prepare target proxies
        const targetProxies = [];
        this._internal.targetNodes.forEach((target) => {
          if (!target) return;
          const proxy = this._prepareAnimationTarget(target);
          if (proxy) targetProxies.push(proxy);
        });

        if (targetProxies.length === 0) return;

        const pathVars = {
          ...baseVars,
          motionPath: {
            path: path,
            align: this._internal.gsapPathAlign,
            autoRotate: this._internal.gsapPathAutoRotate,
            alignOrigin: this._internal.gsapPathAlignOrigin
          }
        };

        this._gsapTween = gsap.to(targetProxies, pathVars);
        // console.log(`[AnimationTarget ${this.id}] Path animation created`);
      } catch (error) {
        this._logError(error, 'Path Animation Creation');
      }
    },

    // --- Advanced GSAP Utility Methods ---
    _createPathFromPoints: function(points, type) {
      if (!Array.isArray(points) || points.length < 2) {
        console.error(`[AnimationTarget ${this.id}] Invalid path points:`, points);
        return null;
      }

      const path = [];
      points.forEach((point, index) => {
        if (Array.isArray(point) && point.length >= 2) {
          path.push({ x: point[0], y: point[1] });
        }
      });

      return path;
    },

    _compileCustomEase: function() {
      // console.log(`[AnimationTarget ${this.id}] Compiling custom ease from curve editor`);
      
      try {
        const customEaseData = this._internal.gsapCustomEase;
        if (!customEaseData || !customEaseData.curve || !Array.isArray(customEaseData.curve)) {
          console.error(`[AnimationTarget ${this.id}] Invalid custom ease data:`, customEaseData);
          this._internal.compiledCustomEase = null;
          return;
        }

        const curve = customEaseData.curve;
        if (curve.length !== 4) {
          console.error(`[AnimationTarget ${this.id}] Custom ease curve must have 4 control points:`, curve);
          this._internal.compiledCustomEase = null;
          return;
        }

        // Create BezierEasing function from curve editor output (like states.js)
        this._internal.compiledCustomEase = BezierEasing(curve[0], curve[1], curve[2], curve[3]);
        // console.log(`[AnimationTarget ${this.id}] Custom ease compiled successfully:`, curve);

      } catch (error) {
        console.error(`[AnimationTarget ${this.id}] Error compiling custom ease:`, error);
        this._internal.compiledCustomEase = null;
      }
    },

    _createCustomEase: function() {
      if (this._internal.compiledCustomEase) {
        // console.log(`[AnimationTarget ${this.id}] Using compiled custom ease function`);
        return this._internal.compiledCustomEase;
      } else {
        console.warn(`[AnimationTarget ${this.id}] No compiled custom ease available, falling back to power1.inOut`);
        return 'power1.inOut';
      }
    },

    _validateTimelineSteps: function(steps) {
      if (!Array.isArray(steps)) {
        console.error(`[AnimationTarget ${this.id}] Timeline steps must be an array`);
        return false;
      }

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        if (typeof step !== 'object' || step === null) {
          console.error(`[AnimationTarget ${this.id}] Timeline step ${i} must be an object`);
          return false;
        }

        if (step.duration === undefined) {
          console.warn(`[AnimationTarget ${this.id}] Timeline step ${i} missing duration, using 1`);
          step.duration = 1;
        }
      }

      return true;
    },

    // --- GSAP Control Methods ---
    _gsapPlay: function() {
      if (this._gsapTween) {
        this._gsapTween.play();
      } else {
        console.warn('Animation Target - No GSAP animation to play');
      }
    },

    _gsapPause: function() {
      if (this._gsapTween) {
        this._gsapTween.pause();
      }
    },

    _gsapResume: function() {
      if (this._gsapTween) {
        this._gsapTween.resume();
      }
    },

    _gsapRestart: function() {
      if (this._gsapTween) {
        this._gsapTween.restart();
      }
    },

    _gsapReverse: function() {
      if (this._gsapTween) {
        this._gsapTween.reverse();
      }
    },

    _gsapStop: function() {
      if (this._gsapTween) {
        this._gsapTween.kill();
        this._gsapTween = null;
        // console.log(`[AnimationTarget ${this.id}] Main animation stopped and killed`);
        
        // Update animation state to reflect stopped state
        this._internal.animationState.isPlaying = false;
        this._internal.animationState.isPaused = false;
        this._internal.animationState.currentProgress = 0;
        this.flagOutputDirty('isPlaying');
        this.flagOutputDirty('isPaused');
        this.flagOutputDirty('currentProgress');
      } else {
        console.warn('Animation Target - No main GSAP animation to stop');
      }
    },

    _gsapStopAll: function() {
      // console.log(`[AnimationTarget ${this.id}] Stopping all animations (main + all targets)`);
      
      // Use the existing kill all method but also update state
      this._killAllAnimations();
      
      // Update animation state to reflect stopped state
      this._internal.animationState.isPlaying = false;
      this._internal.animationState.isPaused = false;
      this._internal.animationState.currentProgress = 0;
      this.flagOutputDirty('isPlaying');
      this.flagOutputDirty('isPaused');
      this.flagOutputDirty('currentProgress');
      
      // console.log(`[AnimationTarget ${this.id}] All animations stopped successfully`);
    },

    _gsapTogglePlay: function() {
      if (this._gsapTween) {
        if (this._gsapTween.paused()) {
          this._gsapTween.play();
        } else {
          this._gsapTween.pause();
        }
      }
    },

    _gsapPlayTarget: function(index) {
      if (this._targetTweens[index]) {
        this._targetTweens[index].play();
        // console.log(`[AnimationTarget ${this.id}] Target ${index + 1} animation played`);
      } else {
        console.warn(`[AnimationTarget ${this.id}] No tween found for target ${index + 1}. Create animation first.`);
      }
    },

    _gsapPauseTarget: function(index) {
      if (this._targetTweens[index]) {
        this._targetTweens[index].pause();
        // console.log(`[AnimationTarget ${this.id}] Target ${index + 1} animation paused`);
      } else {
        console.warn(`[AnimationTarget ${this.id}] No tween found for target ${index + 1}. Create animation first.`);
      }
    },

    _gsapResumeTarget: function(index) {
      if (this._targetTweens[index]) {
        this._targetTweens[index].resume();
        // console.log(`[AnimationTarget ${this.id}] Target ${index + 1} animation resumed`);
      } else {
        console.warn(`[AnimationTarget ${this.id}] No tween found for target ${index + 1}. Create animation first.`);
      }
    },

    _gsapRestartTarget: function(index) {
      if (this._targetTweens[index]) {
        this._targetTweens[index].restart();
        // console.log(`[AnimationTarget ${this.id}] Target ${index + 1} animation restarted`);
      } else {
        console.warn(`[AnimationTarget ${this.id}] No tween found for target ${index + 1}. Create animation first.`);
      }
    },

    _gsapReverseTarget: function(index) {
      if (this._targetTweens[index]) {
        this._targetTweens[index].reverse();
        // console.log(`[AnimationTarget ${this.id}] Target ${index + 1} animation reversed`);
      } else {
        console.warn(`[AnimationTarget ${this.id}] No tween found for target ${index + 1}. Create animation first.`);
      }
    },

    _gsapSetProgressTarget: function(index, progress) {
      if (this._targetTweens[index]) {
        this._targetTweens[index].progress(progress);
        // console.log(`[AnimationTarget ${this.id}] Target ${index + 1} progress set to ${progress}`);
      } else {
        console.warn(`[AnimationTarget ${this.id}] No tween found for target ${index + 1}. Create animation first.`);
      }
    },

    _gsapStopTarget: function(index) {
      if (this._targetTweens[index]) {
        this._targetTweens[index].kill();
        this._targetTweens[index] = null;
        this._targetProxies[index] = null;
        // console.log(`[AnimationTarget ${this.id}] Target ${index + 1} animation stopped and killed`);
        
        // Update animation state to reflect stopped state
        this._internal.animationState.isPlaying = false;
        this._internal.animationState.isPaused = false;
        this._internal.animationState.currentProgress = 0;
        this.flagOutputDirty('isPlaying');
        this.flagOutputDirty('isPaused');
        this.flagOutputDirty('currentProgress');
      } else {
        console.warn(`[AnimationTarget ${this.id}] No tween found for target ${index + 1}. Nothing to stop.`);
      }
    },

    _killAllAnimations: function() {
      // console.log(`[AnimationTarget ${this.id}] Killing all animations and cleaning up memory`);
      
      // Kill main animation
      if (this._gsapTween) {
        this._gsapTween.kill();
        this._gsapTween = null;
      }

      // Kill all target-specific animations with proper cleanup
      if (this._targetTweens && this._targetTweens.length > 0) {
        this._targetTweens.forEach((tween, index) => {
          this._safeExecute(() => {
            if (tween && typeof tween.kill === 'function') {
              tween.kill();
            }
          }, `Target Tween Cleanup ${index}`);
        });
        this._targetTweens.length = 0; // Clear array properly
      }

      // Clear proxies with proper cleanup
      if (this._targetProxies && this._targetProxies.length > 0) {
        this._targetProxies.forEach((proxy, index) => {
          this._safeExecute(() => {
            // Clear proxy references to prevent memory leaks
            if (proxy && proxy._target) {
              proxy._target = null;
            }
          }, `Proxy Cleanup ${index}`);
        });
        this._targetProxies.length = 0; // Clear array properly
      }

      // Reset animation state consistently
      this._internal.animationState.isPlaying = false;
      this._internal.animationState.isPaused = false;
      this._internal.animationState.currentProgress = 0;
      
      // Flag outputs for update
      this.flagOutputDirty('isPlaying');
      this.flagOutputDirty('isPaused');
      this.flagOutputDirty('currentProgress');
      
      // console.log(`[AnimationTarget ${this.id}] All animations killed and memory cleaned up`);
    },

    // Event-based animations removed

    // Test methods for debugging
    _testAnimation: function() {
      // console.log(`[AnimationTarget ${this.id}] Testing animation...`);
      // console.log(`[AnimationTarget ${this.id}] Available targets:`, this._internal.targetNodes.length);
      // console.log(`[AnimationTarget ${this.id}] GSAP available:`, typeof gsap);

      if (this._internal.targetNodes.length === 0) {
        console.warn('Animation Target - No targets connected for testing');
        return;
      }

      // Create a simple test animation
      const targetProxies = [];
      this._internal.targetNodes.forEach((target) => {
        if (!target) return;
        const proxy = this._prepareAnimationTarget(target);
        if (proxy) targetProxies.push(proxy);
      });

      if (targetProxies.length === 0) {
        console.warn('Animation Target - No valid target proxies created');
        return;
      }

      // console.log(`[AnimationTarget ${this.id}] Creating test animation for ${targetProxies.length} targets`);

      try {
        gsap.to(targetProxies, {
          duration: 2,
          x: 100,
          y: 50,
          scaleX: 1.2,
          scaleY: 1.2,
          rotation: 0.5,
          yoyo: true,
          repeat: 1,
          ease: 'power2.inOut',
          onStart: () => {
            // console.log(`[AnimationTarget ${this.id}] Test animation started`);
          },
          onComplete: () => {
            // console.log(`[AnimationTarget ${this.id}] Test animation completed`);
          }
        });
      } catch (error) {
        console.error(`[AnimationTarget ${this.id}] Error creating test animation:`, error);
      }
    },

    _testSimpleAnimation: function() {
      // console.log(`[AnimationTarget ${this.id}] Testing simple animation...`);

      if (this._internal.targetNodes.length === 0) {
        console.warn('Animation Target - No targets connected for simple testing');
        return;
      }

      const targetProxies = [];
      this._internal.targetNodes.forEach((target) => {
        if (!target) return;
        const proxy = this._prepareAnimationTarget(target);
        if (proxy) targetProxies.push(proxy);
      });

      if (targetProxies.length === 0) return;

      try {
        gsap.to(targetProxies, {
          duration: 1,
          x: 50,
          ease: 'power1.out',
          onComplete: () => {
            // console.log(`[AnimationTarget ${this.id}] Simple test animation completed`);
          }
        });
      } catch (error) {
        console.error(`[AnimationTarget ${this.id}] Error creating simple test animation:`, error);
      }
    },

    _createTargetSpecificAnimation: function(index) {
      // console.log(`[AnimationTarget ${this.id}] Creating target-specific animation for target ${index + 1}`);

      const target = this._internal.targetNodes[index];
      if (!target) {
        console.warn(`[AnimationTarget ${this.id}] No target found at index ${index}`);
        return;
      }

      const targetProxy = this._prepareAnimationTarget(target);
      if (!targetProxy) {
        console.warn(`[AnimationTarget ${this.id}] Could not prepare target proxy for index ${index}`);
        return;
      }

      // Check if this target should use timeline
      const useTimeline = this._internal[`target${index + 1}UseTimeline`];
      
      if (useTimeline) {
        // console.log(`[AnimationTarget ${this.id}] Target ${index + 1} using timeline animation`);
        this._createTargetTimelineAnimation(index, targetProxy);
      } else {
        // console.log(`[AnimationTarget ${this.id}] Target ${index + 1} using simple animation`);
        this._createTargetSimpleAnimation(index, targetProxy);
      }
    },

    _createTargetSimpleAnimation: function(index, targetProxy) {
      // console.log(`[AnimationTarget ${this.id}] Creating simple animation for target ${index + 1}`);
      
      let vars;
      try {
        const animationConfig = this._internal[`target${index + 1}AnimationVars`];
        if (animationConfig) {
          vars = JSON.parse(animationConfig);
          // console.log(`[AnimationTarget ${this.id}] Parsed target ${index + 1} animation vars:`, vars);
        } else {
          console.warn(`[AnimationTarget ${this.id}] No animation vars defined for target ${index + 1}`);
          return;
        }
      } catch (e) {
        console.error(`[AnimationTarget ${this.id}] Invalid target ${index + 1} animation vars JSON:`, e);
        return;
      }

      if (!vars || Object.keys(vars).length === 0) {
        console.warn(`[AnimationTarget ${this.id}] Target ${index + 1} animation vars is empty`);
        return;
      }

      // Clean up any existing tween for this target
      if (this._targetTweens[index]) {
        // console.log(`[AnimationTarget ${this.id}] Killing existing tween for target ${index + 1}`);
        this._targetTweens[index].kill();
      }

      // Add comprehensive callbacks
      const eventVars = { ...vars };
      
      eventVars.onUpdate = () => {
        this._internal.animationState.isPlaying = true;
        this._internal.animationState.isPaused = false;
        if (this._targetTweens[index]) {
          this._internal.animationState.currentProgress = this._targetTweens[index].progress();
        }
        this.flagOutputDirty('isPlaying');
        this.flagOutputDirty('isPaused');
        this.flagOutputDirty('currentProgress');
        this.sendSignalOnOutput('onUpdate');
        if (this._internal.gsapEventUpdate) this.sendSignalOnOutput('gsapEventUpdate');
      };

      eventVars.onStart = () => {
        // console.log(`[AnimationTarget ${this.id}] Target ${index + 1} animation started`);
        this._internal.animationState.isPlaying = true;
        this._internal.animationState.isPaused = false;
        this.flagOutputDirty('isPlaying');
        this.flagOutputDirty('isPaused');
        this.sendSignalOnOutput('onStart');
        if (this._internal.gsapEventStart) this.sendSignalOnOutput('gsapEventStart');
      };

      eventVars.onComplete = () => {
        // console.log(`[AnimationTarget ${this.id}] Target ${index + 1} animation completed`);
        this._internal.animationState.isPlaying = false;
        this._internal.animationState.currentProgress = 1;
        this.flagOutputDirty('isPlaying');
        this.flagOutputDirty('currentProgress');
        this.sendSignalOnOutput('onComplete');
        if (this._internal.gsapEventComplete) this.sendSignalOnOutput('gsapEventComplete');
      };

      eventVars.onRepeat = () => {
        if (this._internal.gsapEventRepeat) this.sendSignalOnOutput('gsapEventRepeat');
      };

      eventVars.onReverse = () => {
        if (this._internal.gsapEventReverse) this.sendSignalOnOutput('gsapEventReverse');
      };

      eventVars.onPause = () => {
        this._internal.animationState.isPaused = true;
        this.flagOutputDirty('isPaused');
        if (this._internal.gsapEventPause) this.sendSignalOnOutput('gsapEventPause');
      };

      eventVars.onResume = () => {
        this._internal.animationState.isPaused = false;
        this.flagOutputDirty('isPaused');
        if (this._internal.gsapEventResume) this.sendSignalOnOutput('gsapEventResume');
      };

      eventVars.onRestart = () => {
        if (this._internal.gsapEventRestart) this.sendSignalOnOutput('gsapEventRestart');
      };

      // console.log(`[AnimationTarget ${this.id}] Creating target ${index + 1} specific GSAP tween with vars:`, eventVars);
      // console.log(`[AnimationTarget ${this.id}] Target proxy for target ${index + 1}:`, targetProxy);

      try {
        // Create and store the new tween for this specific target
        this._targetTweens[index] = gsap.to(targetProxy, eventVars);
        this._targetProxies[index] = targetProxy; // Store proxy for reference
        
        // console.log(`[AnimationTarget ${this.id}] Target ${index + 1} specific GSAP tween created:`, this._targetTweens[index]);
        
        // Ensure target-specific animation starts playing immediately
        if (this._targetTweens[index]) {
          this._targetTweens[index].play();
          // console.log(`[AnimationTarget ${this.id}] Target ${index + 1} animation started playing`);
        }
      } catch (error) {
        console.error(`[AnimationTarget ${this.id}] Error creating target ${index + 1} specific GSAP tween:`, error);
        console.error(`[AnimationTarget ${this.id}] Target proxy was:`, targetProxy);
        console.error(`[AnimationTarget ${this.id}] Animation vars were:`, eventVars);
      }
    },

    _createTargetTimelineAnimation: function(index, targetProxy) {
      // console.log(`[AnimationTarget ${this.id}] Creating timeline animation for target ${index + 1}`);

      let timelineSteps;
      try {
        const timelineConfig = this._internal[`target${index + 1}TimelineSteps`];
        if (timelineConfig) {
          timelineSteps = JSON.parse(timelineConfig);
          // console.log(`[AnimationTarget ${this.id}] Parsed target ${index + 1} timeline steps:`, timelineSteps);
        } else {
          console.warn(`[AnimationTarget ${this.id}] No timeline steps defined for target ${index + 1}`);
          return;
        }
      } catch (e) {
        console.error(`[AnimationTarget ${this.id}] Invalid target ${index + 1} timeline steps JSON:`, e);
        return;
      }

      if (!Array.isArray(timelineSteps) || timelineSteps.length === 0) {
        console.warn(`[AnimationTarget ${this.id}] Target ${index + 1} timeline steps is empty or invalid`);
        return;
      }

      // Validate timeline steps
      if (!this._validateTimelineSteps(timelineSteps)) {
        console.error(`[AnimationTarget ${this.id}] Invalid timeline steps for target ${index + 1}`);
        return;
      }

      // Clean up any existing tween for this target
      if (this._targetTweens[index]) {
        this._targetTweens[index].kill();
      }

      // Create timeline
      const timeline = gsap.timeline({
        onUpdate: () => {
          this._internal.animationState.isPlaying = true;
          this._internal.animationState.isPaused = false;
          this.flagOutputDirty('isPlaying');
          this.flagOutputDirty('isPaused');
          this.sendSignalOnOutput('onUpdate');
          if (this._internal.gsapEventUpdate) this.sendSignalOnOutput('gsapEventUpdate');
        },
        onStart: () => {
          // console.log(`[AnimationTarget ${this.id}] Target ${index + 1} timeline animation started`);
          this._internal.animationState.isPlaying = true;
          this._internal.animationState.isPaused = false;
          this.flagOutputDirty('isPlaying');
          this.flagOutputDirty('isPaused');
          this.sendSignalOnOutput('onStart');
          if (this._internal.gsapEventStart) this.sendSignalOnOutput('gsapEventStart');
        },
        onComplete: () => {
          // console.log(`[AnimationTarget ${this.id}] Target ${index + 1} timeline animation completed`);
          this._internal.animationState.isPlaying = false;
          this._internal.animationState.currentProgress = 1;
          this.flagOutputDirty('isPlaying');
          this.flagOutputDirty('currentProgress');
          this.sendSignalOnOutput('onComplete');
          if (this._internal.gsapEventComplete) this.sendSignalOnOutput('gsapEventComplete');
        },
        onRepeat: () => {
          if (this._internal.gsapEventRepeat) this.sendSignalOnOutput('gsapEventRepeat');
        },
        onReverse: () => {
          if (this._internal.gsapEventReverse) this.sendSignalOnOutput('gsapEventReverse');
        },
        onPause: () => {
          this._internal.animationState.isPaused = true;
          this.flagOutputDirty('isPaused');
          if (this._internal.gsapEventPause) this.sendSignalOnOutput('gsapEventPause');
        },
        onResume: () => {
          this._internal.animationState.isPaused = false;
          this.flagOutputDirty('isPaused');
          if (this._internal.gsapEventResume) this.sendSignalOnOutput('gsapEventResume');
        },
        onRestart: () => {
          if (this._internal.gsapEventRestart) this.sendSignalOnOutput('gsapEventRestart');
        }
      });

      // Add each step to the timeline
      let currentTime = 0;
      timelineSteps.forEach((step, stepIndex) => {
        const stepVars = { ...step };
        const duration = stepVars.duration || 1;
        delete stepVars.duration; // Remove duration as it's used for timing

        if (Object.keys(stepVars).length > 0) {
          timeline.to(targetProxy, stepVars, currentTime);
          // console.log(`[AnimationTarget ${this.id}] Added timeline step ${stepIndex + 1} for target ${index + 1}:`, stepVars);
        }
        currentTime += duration;
      });

      // Store the timeline as the target's tween
      this._targetTweens[index] = timeline;
      this._targetProxies[index] = targetProxy;

      // console.log(`[AnimationTarget ${this.id}] Target ${index + 1} timeline animation created with ${timelineSteps.length} steps and auto-playing`);

      // Ensure timeline starts playing immediately
      if (this._targetTweens[index]) {
        this._targetTweens[index].play();
      }
    },

    _testCustomEase: function() {
      // console.log(`[AnimationTarget ${this.id}] Testing custom ease curve...`);
      
      if (this._internal.targetNodes.length === 0) {
        console.warn('Animation Target - No targets connected for custom ease testing');
        return;
      }

      // Test the curve editor integration
      // console.log(`[AnimationTarget ${this.id}] Current custom ease data:`, this._internal.gsapCustomEase);
      
      // Compile and test the custom ease
      this._compileCustomEase();
      
      if (!this._internal.compiledCustomEase) {
        console.error('Animation Target - Failed to compile custom ease for testing');
        return;
      }

      const targetProxies = [];
      this._internal.targetNodes.forEach((target) => {
        if (!target) return;
        const proxy = this._prepareAnimationTarget(target);
        if (proxy) targetProxies.push(proxy);
      });

      if (targetProxies.length === 0) return;

      try {
        // Create a test animation using the custom ease curve
        gsap.to(targetProxies, {
          duration: 2,
          x: 150,
          y: 75,
          scaleX: 1.3,
          scaleY: 1.3,
          ease: this._internal.compiledCustomEase,
          yoyo: true,
          repeat: 1,
          onStart: () => {
            // console.log(`[AnimationTarget ${this.id}] Custom ease test animation started`);
          },
          onComplete: () => {
            // console.log(`[AnimationTarget ${this.id}] Custom ease test animation completed`);
          },
          onUpdate: () => {
            // Test the ease function at different progress points
            const progress = gsap.getProperty(targetProxies[0], 'progress') || 0;
            if (progress % 0.25 < 0.01) { // Log every 25% progress
              // console.log(`[AnimationTarget ${this.id}] Custom ease progress: ${(progress * 100).toFixed(1)}%`);
            }
          }
        });
        
        // console.log(`[AnimationTarget ${this.id}] Custom ease test animation created successfully`);
      } catch (error) {
        console.error(`[AnimationTarget ${this.id}] Error creating custom ease test animation:`, error);
      }
    }
  },
  // Add dynamic input ports for conditional visibility
  dynamicports: [
    // Target-based animations (always visible when enabled)
    {
      condition: 'enableTargetBasedAnimations = true',
      inputs: [
        'target1CreateAnimation',
        'target2CreateAnimation',
        'target3CreateAnimation',
        'target4CreateAnimation',
        'target5CreateAnimation'
      ]
    },
    // JSON inputs for target animations (only when both enabled)
    {
      condition: 'enableTargetBasedAnimations = true && enableCustomJSON = true',
      inputs: [
        'target1AnimationVars',
        'target1UseTimeline',
        'target1TimelineSteps',
        'target2AnimationVars',
        'target2UseTimeline',
        'target2TimelineSteps',
        'target3AnimationVars',
        'target3UseTimeline',
        'target3TimelineSteps',
        'target4AnimationVars',
        'target4UseTimeline',
        'target4TimelineSteps',
        'target5AnimationVars',
        'target5UseTimeline',
        'target5TimelineSteps'
      ]
    },
    // Main animation JSON inputs (only when custom JSON enabled)
    {
      condition: 'enableCustomJSON = true',
      inputs: [
        'gsapVars',
        'gsapTimelineSteps',
        'gsapPathPoints'
      ]
    }
  ]
};

module.exports = {
  node: AnimationTarget
};