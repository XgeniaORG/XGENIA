'use strict';

// GSAP (CommonJS interop, consistent with existing nodes)
let gsap = null;
let MotionPathPlugin = null;
let CustomEase = null;
try {
  gsap = require('gsap').gsap || require('gsap');
} catch (e) {
  // leave null; node will log a warning at initialize
}
try { MotionPathPlugin = require('gsap/MotionPathPlugin').MotionPathPlugin; } catch (e) {}
try { CustomEase = require('gsap/CustomEase').CustomEase; } catch (e) {}
if (gsap && (MotionPathPlugin || CustomEase)) {
  try { if (MotionPathPlugin) gsap.registerPlugin(MotionPathPlugin); } catch (e) {}
  try { if (CustomEase) gsap.registerPlugin(CustomEase); } catch (e) {}
}

// Optional: support curve-editor bezier ease function as a direct function ease
let BezierEasing = null;
try { BezierEasing = require('bezier-easing'); } catch (e) {}

const MAX_TARGETS = 6;

const GsapAnimatorNode = {
  name: 'net.xgenia.gsapAnimator',
  displayName: 'GSAP Animator',
  shortDesc: 'Animate one or many targets (max 6) with GSAP with deterministic controls.',
  category: 'Animation',
  usePortAsLabel: 'animationName',
  connectionPanel: {
    groupPriority: [
      'General',
      'Targets',
      'Properties',
      'Properties | Target',
      'Timeline',
      'Stagger',
      'Path',
      'Easing',
      'Control',
      'Events',
      'State'
    ]
  },
  nodeDoubleClickAction: { focusPort: 'animationName' },
  initialize: function() {
    this._internal = this._internal || {};

    // General
    this._internal.animationName = 'Animation';
    this._internal.autoplay = true;
    this._internal.autoApply = true;
    this._internal.method = 'to'; // to | from | fromTo
    this._internal.configMode = 'properties'; // properties | json | timeline

    // GSAP base
    this._internal.duration = 1;
    this._internal.delay = 0;
    this._internal.repeat = 0;
    this._internal.repeatDelay = 0;
    this._internal.yoyo = false;
    this._internal.ease = 'power1.out';
    this._internal.timeScale = 1;
    this._internal.pendingProgress = null;
    this._internal.pendingSeek = null;

    // Targets
    this._targets = new Array(MAX_TARGETS).fill(null);
    this._proxies = new Array(MAX_TARGETS).fill(null);

    // Per-target props (only set what is defined)
    this._internal.targetProps = { x: undefined, y: undefined, scaleX: undefined, scaleY: undefined, rotation: undefined, alpha: undefined, skewX: undefined, skewY: undefined };

    // Advanced
    this._internal.staggerEnabled = false;
    this._internal.staggerEach = 0.1;
    this._internal.staggerFrom = 'start'; // start|end|center|edges|random

    this._internal.timelineEnabled = false;
    this._internal.timelineSteps = JSON.stringify([{ duration: 1, x: 100, ease: 'power1.out' }], null, 2);

    this._internal.pathEnabled = false;
    this._internal.pathPoints = JSON.stringify([[0,0],[100,0],[100,100]], null, 2);
    this._internal.pathAutoRotate = false;
    this._internal.pathAlignOrigin = [0.5, 0.5];

    this._internal.advancedEase = 'none'; // none | custom | gsapString
    this._internal.customCurve = { curve: [0.25, 0.1, 0.25, 1], dur: 1000, delay: 0 };
    this._compiledEase = null;

    // JSON override (when configMode === 'json')
    this._internal.varsJSON = JSON.stringify({ duration: 1, x: 100, ease: 'power1.out' }, null, 2);

    // Lifecycle flags
    this._forceBuildOnce = false;
    this._playOnBuildOnce = false;
    this._internal.pendingBuild = false;
    this._internal.pendingPlay = false;

    // Tween references
    this._tween = null;
    this._targetTweens = new Array(MAX_TARGETS).fill(null);

    // State
    this._internal.state = { isPlaying: false, isPaused: false, progress: 0, duration: 0 };

    if (!gsap) {
      console.warn('[GSAP Animator] gsap not available');
    }
  },
  getInspectInfo() {
    const n = this._internal?.animationName || 'Animation';
    const count = this._targets.filter(Boolean).length;
    const status = this._internal.state.isPlaying ? 'Playing' : 'Stopped';
    return `${n} -> ${count} target(s) - ${status}`;
  },
  inputs: (function() {
    const inputs = {
      // General
      animationName: { group: 'General', type: 'string', displayName: 'Name', default: 'Animation', set(v){ this._internal.animationName = v || 'Animation'; } },
      autoplay: { group: 'General', type: 'boolean', displayName: 'Autoplay', default: true, set(v){ this._internal.autoplay = !!v; } },
      autoApply: { group: 'General', type: 'boolean', displayName: 'Auto Apply', default: true, set(v){ this._internal.autoApply = !!v; } },
      method: { group: 'General', type: { name: 'enum', enums: ['to','from','fromTo'] }, default: 'to', set(v){ this._internal.method = v || 'to'; this._autoUpdate(); } },
      configMode: { group: 'General', type: { name: 'enum', enums: ['properties','json','timeline','perTarget'] }, default: 'properties', set(v){ this._internal.configMode = v || 'properties'; this._autoUpdate(); } },

      // Targets 1..6
      target1: { group: 'Targets', type: 'node', displayName: 'Target 1', set(v){ this._setTarget(0, v); } },
      target2: { group: 'Targets', type: 'node', displayName: 'Target 2', set(v){ this._setTarget(1, v); } },
      target3: { group: 'Targets', type: 'node', displayName: 'Target 3', set(v){ this._setTarget(2, v); } },
      target4: { group: 'Targets', type: 'node', displayName: 'Target 4', set(v){ this._setTarget(3, v); } },
      target5: { group: 'Targets', type: 'node', displayName: 'Target 5', set(v){ this._setTarget(4, v); } },
      target6: { group: 'Targets', type: 'node', displayName: 'Target 6', set(v){ this._setTarget(5, v); } },

      // Base properties
      duration: { group: 'Properties', type: 'number', default: 1, min: 0, set(v){ this._internal.duration = Math.max(0, v || 0); this._autoUpdate(); } },
      delay: { group: 'Properties', type: 'number', default: 0, min: 0, set(v){ this._internal.delay = Math.max(0, v || 0); this._autoUpdate(); } },
      repeat: { group: 'Properties', type: 'number', default: 0, set(v){ this._internal.repeat = Number(v||0); this._autoUpdate(); } },
      repeatDelay: { group: 'Properties', type: 'number', default: 0, min: 0, set(v){ this._internal.repeatDelay = Math.max(0, v || 0); this._autoUpdate(); } },
      yoyo: { group: 'Properties', type: 'boolean', default: false, set(v){ this._internal.yoyo = !!v; this._autoUpdate(); } },
      ease: { group: 'Properties', type: { name: 'enum', enums: ['none','power1.in','power1.out','power1.inOut','power2.in','power2.out','power2.inOut','power3.in','power3.out','power3.inOut','power4.in','power4.out','power4.inOut','back.in','back.out','back.inOut','elastic.in','elastic.out','elastic.inOut','bounce.in','bounce.out','bounce.inOut','sine.in','sine.out','sine.inOut','expo.in','expo.out','expo.inOut','circ.in','circ.out','circ.inOut'] }, default: 'power1.out', set(v){ this._internal.ease = v || 'power1.out'; this._autoUpdate(); } },
      timeScale: { group: 'Properties', type: 'number', default: 1, min: 0, set(v){ this._internal.timeScale = Math.max(0, v==null?1:v); if (this._tween && this._tween.timeScale) this._tween.timeScale(this._internal.timeScale); } },

      // Target props (optional, only applied when defined)
      x: { group: 'Properties | Target', type: 'number', set(v){ this._internal.targetProps.x = v; this._autoUpdate(); } },
      y: { group: 'Properties | Target', type: 'number', set(v){ this._internal.targetProps.y = v; this._autoUpdate(); } },
      scaleX: { group: 'Properties | Target', type: 'number', set(v){ this._internal.targetProps.scaleX = v; this._autoUpdate(); } },
      scaleY: { group: 'Properties | Target', type: 'number', set(v){ this._internal.targetProps.scaleY = v; this._autoUpdate(); } },
      rotation: { group: 'Properties | Target', type: 'number', set(v){ this._internal.targetProps.rotation = v; this._autoUpdate(); } },
      alpha: { group: 'Properties | Target', type: 'number', min: 0, max: 1, set(v){ this._internal.targetProps.alpha = v; this._autoUpdate(); } },
      skewX: { group: 'Properties | Target', type: 'number', set(v){ this._internal.targetProps.skewX = v; this._autoUpdate(); } },
      skewY: { group: 'Properties | Target', type: 'number', set(v){ this._internal.targetProps.skewY = v; this._autoUpdate(); } },

      // JSON mode
      varsJSON: { group: 'Properties', type: { name: 'string', allowEditOnly: true, codeeditor: 'json' }, multiline: true, default: JSON.stringify({ duration: 1, x: 100, ease: 'power1.out' }, null, 2), set(v){ this._internal.varsJSON = v; this._autoUpdate(); } },

      // Timeline mode
      timelineEnabled: { group: 'Timeline', type: 'boolean', default: false, set(v){ this._internal.timelineEnabled = !!v; this._autoUpdate(); } },
      timelineSteps: { group: 'Timeline', type: { name: 'string', allowEditOnly: true, codeeditor: 'json' }, multiline: true, default: JSON.stringify([{ duration: 1, x: 100, ease: 'power1.out' }], null, 2), set(v){ this._internal.timelineSteps = v; this._autoUpdate(); } },

      // Per-target configuration (used when configMode = 'perTarget')
      t1UseTimeline: { group: 'Timeline', type: 'boolean', default: false, set(v){ this._internal.t1UseTimeline = !!v; this._autoUpdate(); } },
      t1VarsJSON: { group: 'Timeline', type: { name: 'string', allowEditOnly: true, codeeditor: 'json' }, multiline: true, default: JSON.stringify({ duration: 1, x: 100, ease: 'power1.out' }, null, 2), set(v){ this._internal.t1VarsJSON = v; this._autoUpdate(); } },
      t1TimelineSteps: { group: 'Timeline', type: { name: 'string', allowEditOnly: true, codeeditor: 'json' }, multiline: true, default: JSON.stringify([{ duration: 1, x: 100 }], null, 2), set(v){ this._internal.t1TimelineSteps = v; this._autoUpdate(); } },

      t2UseTimeline: { group: 'Timeline', type: 'boolean', default: false, set(v){ this._internal.t2UseTimeline = !!v; this._autoUpdate(); } },
      t2VarsJSON: { group: 'Timeline', type: { name: 'string', allowEditOnly: true, codeeditor: 'json' }, multiline: true, default: JSON.stringify({ duration: 1, x: 100, ease: 'power1.out' }, null, 2), set(v){ this._internal.t2VarsJSON = v; this._autoUpdate(); } },
      t2TimelineSteps: { group: 'Timeline', type: { name: 'string', allowEditOnly: true, codeeditor: 'json' }, multiline: true, default: JSON.stringify([{ duration: 1, x: 100 }], null, 2), set(v){ this._internal.t2TimelineSteps = v; this._autoUpdate(); } },

      t3UseTimeline: { group: 'Timeline', type: 'boolean', default: false, set(v){ this._internal.t3UseTimeline = !!v; this._autoUpdate(); } },
      t3VarsJSON: { group: 'Timeline', type: { name: 'string', allowEditOnly: true, codeeditor: 'json' }, multiline: true, default: JSON.stringify({ duration: 1, x: 100, ease: 'power1.out' }, null, 2), set(v){ this._internal.t3VarsJSON = v; this._autoUpdate(); } },
      t3TimelineSteps: { group: 'Timeline', type: { name: 'string', allowEditOnly: true, codeeditor: 'json' }, multiline: true, default: JSON.stringify([{ duration: 1, x: 100 }], null, 2), set(v){ this._internal.t3TimelineSteps = v; this._autoUpdate(); } },

      t4UseTimeline: { group: 'Timeline', type: 'boolean', default: false, set(v){ this._internal.t4UseTimeline = !!v; this._autoUpdate(); } },
      t4VarsJSON: { group: 'Timeline', type: { name: 'string', allowEditOnly: true, codeeditor: 'json' }, multiline: true, default: JSON.stringify({ duration: 1, x: 100, ease: 'power1.out' }, null, 2), set(v){ this._internal.t4VarsJSON = v; this._autoUpdate(); } },
      t4TimelineSteps: { group: 'Timeline', type: { name: 'string', allowEditOnly: true, codeeditor: 'json' }, multiline: true, default: JSON.stringify([{ duration: 1, x: 100 }], null, 2), set(v){ this._internal.t4TimelineSteps = v; this._autoUpdate(); } },

      t5UseTimeline: { group: 'Timeline', type: 'boolean', default: false, set(v){ this._internal.t5UseTimeline = !!v; this._autoUpdate(); } },
      t5VarsJSON: { group: 'Timeline', type: { name: 'string', allowEditOnly: true, codeeditor: 'json' }, multiline: true, default: JSON.stringify({ duration: 1, x: 100, ease: 'power1.out' }, null, 2), set(v){ this._internal.t5VarsJSON = v; this._autoUpdate(); } },
      t5TimelineSteps: { group: 'Timeline', type: { name: 'string', allowEditOnly: true, codeeditor: 'json' }, multiline: true, default: JSON.stringify([{ duration: 1, x: 100 }], null, 2), set(v){ this._internal.t5TimelineSteps = v; this._autoUpdate(); } },

      t6UseTimeline: { group: 'Timeline', type: 'boolean', default: false, set(v){ this._internal.t6UseTimeline = !!v; this._autoUpdate(); } },
      t6VarsJSON: { group: 'Timeline', type: { name: 'string', allowEditOnly: true, codeeditor: 'json' }, multiline: true, default: JSON.stringify({ duration: 1, x: 100, ease: 'power1.out' }, null, 2), set(v){ this._internal.t6VarsJSON = v; this._autoUpdate(); } },
      t6TimelineSteps: { group: 'Timeline', type: { name: 'string', allowEditOnly: true, codeeditor: 'json' }, multiline: true, default: JSON.stringify([{ duration: 1, x: 100 }], null, 2), set(v){ this._internal.t6TimelineSteps = v; this._autoUpdate(); } },

      // Stagger
      staggerEnabled: { group: 'Stagger', type: 'boolean', default: false, set(v){ this._internal.staggerEnabled = !!v; this._autoUpdate(); } },
      staggerEach: { group: 'Stagger', type: 'number', default: 0.1, min: 0, set(v){ this._internal.staggerEach = Math.max(0, v || 0.1); this._autoUpdate(); } },
      staggerFrom: { group: 'Stagger', type: { name: 'enum', enums: ['start','end','center','edges','random'] }, default: 'start', set(v){ this._internal.staggerFrom = v || 'start'; this._autoUpdate(); } },

      // Path
      pathEnabled: { group: 'Path', type: 'boolean', default: false, set(v){ this._internal.pathEnabled = !!v; this._autoUpdate(); } },
      pathPoints: { group: 'Path', type: { name: 'string', allowEditOnly: true, codeeditor: 'json' }, multiline: true, default: JSON.stringify([[0,0],[100,0],[100,100]], null, 2), set(v){ this._internal.pathPoints = v; this._autoUpdate(); } },
      pathAutoRotate: { group: 'Path', type: 'boolean', default: false, set(v){ this._internal.pathAutoRotate = !!v; this._autoUpdate(); } },
      pathAlignOrigin: { group: 'Path', type: 'array', default: [0.5, 0.5], set(v){ this._internal.pathAlignOrigin = v; this._autoUpdate(); } },

      // Easing
      advancedEase: { group: 'Easing', type: { name: 'enum', enums: ['none','custom','gsapString'] }, default: 'none', set(v){ this._internal.advancedEase = v || 'none'; this._compileEase(); this._autoUpdate(); } },
      customEaseCurve: { group: 'Easing', type: 'curve', default: { curve: [0.25,0.1,0.25,1], dur: 1000, delay: 0 }, set(v){ this._internal.customCurve = v; this._compileEase(); this._autoUpdate(); } },

      // Controls
      apply: { group: 'Control', type: 'signal', displayName: 'Apply/Rebuild', valueChangedToTrue(){ this._forceBuildOnce = true; this._internal.pendingBuild = true; this._update(); } },
      play: { group: 'Control', type: 'signal', valueChangedToTrue(){ this._internal.pendingPlay = true; this._play(); } },
      pause: { group: 'Control', type: 'signal', valueChangedToTrue(){ this._pause(); } },
      resume: { group: 'Control', type: 'signal', valueChangedToTrue(){ this._resume(); } },
      restart: { group: 'Control', type: 'signal', valueChangedToTrue(){ this._restart(); } },
      reverse: { group: 'Control', type: 'signal', valueChangedToTrue(){ this._reverse(); } },
      stop: { group: 'Control', type: 'signal', valueChangedToTrue(){ this._stop(); } },
      setProgress: { group: 'Control', type: 'number', min: 0, max: 1, displayName: 'Set Progress (0-1)', set(v){ const p = Math.max(0, Math.min(1, Number(v||0))); if (this._tween && this._tween.progress) { this._tween.progress(p); } else { this._internal.pendingProgress = p; } this._setState({ progress: p }); } },
      seekTime: { group: 'Control', type: 'number', min: 0, displayName: 'Seek Time (s)', set(v){ const t = Math.max(0, Number(v||0)); if (this._tween && this._tween.seek) { this._tween.seek(t); } else { this._internal.pendingSeek = t; } } },
    };
    return inputs;
  })(),
  outputs: {
    onStart: { group: 'Events', type: 'signal', displayName: 'On Start' },
    onUpdate: { group: 'Events', type: 'signal', displayName: 'On Update' },
    onComplete: { group: 'Events', type: 'signal', displayName: 'On Complete' },
    isPlaying: { group: 'State', type: 'boolean', getter(){ return !!this._internal.state.isPlaying; } },
    isPaused: { group: 'State', type: 'boolean', getter(){ return !!this._internal.state.isPaused; } },
    progress: { group: 'State', type: 'number', getter(){ return this._tween ? this._tween.progress() : this._internal.state.progress || 0; } },
    duration: { group: 'State', type: 'number', getter(){ return this._tween ? this._tween.duration?.() : this._internal.state.duration || 0; } },
  },
  onNodeDestroy: function() { this._killAll(); },
  methods: {
    _autoUpdate: function(){ if (this._internal.autoApply) this._update(); },

    _setTarget: function(idx, node){
      this._targets[idx] = node || null;
      this._proxies[idx] = null; // refresh on rebuild
      const shouldBuild = this._internal.autoApply || this._internal.autoplay || this._internal.pendingBuild || this._internal.pendingPlay;
      if (shouldBuild) {
        this._forceBuildOnce = true;
        // If user requested play, prioritize that; else follow autoplay
        this._playOnBuildOnce = !!(this._internal.pendingPlay || this._internal.autoplay);
        this._update();
      }
    },

    _compileEase: function(){
      this._compiledEase = null;
      if (this._internal.advancedEase === 'custom') {
        const c = this._internal.customCurve;
        if (c && Array.isArray(c.curve) && c.curve.length === 4) {
          if (CustomEase && CustomEase.create) {
            try { this._compiledEase = CustomEase.create(null, `M0,0 C${c.curve[0]},${c.curve[1]} ${c.curve[2]},${c.curve[3]} 1,1`); } catch(e) {}
          }
          if (!this._compiledEase && BezierEasing) {
            try { this._compiledEase = BezierEasing(c.curve[0], c.curve[1], c.curve[2], c.curve[3]); } catch(e) {}
          }
        }
      }
    },

    _update: function(){
      if (!gsap) return;
      if (!this._shouldBuild()) return;
      this._killAll();

      const proxies = this._prepareTargets();
      if (proxies.length === 0) {
        // Remember the intent to build/play for when targets arrive
        if (this._forceBuildOnce || this._internal.autoApply) this._internal.pendingBuild = true;
        if (this._playOnBuildOnce || this._internal.autoplay) this._internal.pendingPlay = this._internal.pendingPlay || this._playOnBuildOnce || this._internal.autoplay;
        return;
      }

      // Mode switches
      if (this._internal.configMode === 'perTarget') {
        this._buildPerTarget();
        return;
      }
      if (this._internal.configMode === 'timeline' || this._internal.timelineEnabled) {
        this._buildTimeline(proxies);
        return;
      }
      if (this._internal.configMode === 'json') {
        const vars = this._parseJSON(this._internal.varsJSON, {});
        if (!vars || Object.keys(vars).length === 0) return;
        this._buildTween(proxies, vars);
        return;
      }

      // properties mode
      const base = {
        duration: this._internal.duration,
        delay: this._internal.delay,
        repeat: this._internal.repeat,
        repeatDelay: this._internal.repeatDelay,
        yoyo: this._internal.yoyo,
        ease: this._resolveEase(),
      };
      const targetVars = {};
      const p = this._internal.targetProps;
      for (const k in p) if (p[k] !== undefined) targetVars[k] = p[k];

      const vars = Object.assign({}, base, targetVars);

      // Path support
      if (this._internal.pathEnabled && MotionPathPlugin) {
        const points = this._parseJSON(this._internal.pathPoints, []);
        const path = Array.isArray(points) ? points.filter(a=>Array.isArray(a)&&a.length>=2).map(a=>({x:a[0],y:a[1]})) : [];
        if (path.length >= 2) {
          vars.motionPath = {
            path,
            autoRotate: !!this._internal.pathAutoRotate,
            alignOrigin: this._internal.pathAlignOrigin || [0.5, 0.5]
          };
        }
      }

      this._buildTween(proxies, vars);
    },

    _getUniversalBaseVars: function(){
      const base = {
        duration: this._internal.duration,
        delay: this._internal.delay,
        repeat: this._internal.repeat,
        repeatDelay: this._internal.repeatDelay,
        yoyo: this._internal.yoyo,
        ease: this._resolveEase(),
      };
      const targetVars = {};
      const p = this._internal.targetProps;
      for (const k in p) if (p[k] !== undefined) targetVars[k] = p[k];
      const vars = Object.assign({}, base, targetVars);
      if (this._internal.pathEnabled && MotionPathPlugin) {
        const points = this._parseJSON(this._internal.pathPoints, []);
        const path = Array.isArray(points) ? points.filter(a=>Array.isArray(a)&&a.length>=2).map(a=>({x:a[0],y:a[1]})) : [];
        if (path.length >= 2) {
          vars.motionPath = { path, autoRotate: !!this._internal.pathAutoRotate, alignOrigin: this._internal.pathAlignOrigin || [0.5, 0.5] };
        }
      }
      return vars;
    },

    _buildPerTarget: function(){
      const pairs = [];
      for (let i=0;i<MAX_TARGETS;i++) {
        const node = this._targets[i];
        if (!node) continue;
        const proxy = this._ensureProxy(i, node);
        if (proxy) pairs.push([i, proxy]);
      }
      if (pairs.length === 0) {
        if (this._forceBuildOnce || this._internal.autoApply) this._internal.pendingBuild = true;
        if (this._playOnBuildOnce || this._internal.autoplay) this._internal.pendingPlay = this._internal.pendingPlay || this._playOnBuildOnce || this._internal.autoplay;
        return;
      }

      // Kill previous per-target tweens
      for (let i=0;i<MAX_TARGETS;i++) { try { if (this._targetTweens[i]?.kill) this._targetTweens[i].kill(); } catch(e) {} this._targetTweens[i] = null; }

      const universalFallback = this._getUniversalBaseVars();

      for (const [i, proxy] of pairs) {
        const useTimeline = !!this._internal[`t${i+1}UseTimeline`];
        const varsJSON = this._parseJSON(this._internal[`t${i+1}VarsJSON`], null);
        const steps = this._parseJSON(this._internal[`t${i+1}TimelineSteps`], []);

        try {
          if (useTimeline && Array.isArray(steps) && steps.length > 0) {
            const tl = gsap.timeline({ defaults: { ease: this._resolveEase() } });
            let t = 0;
            for (const step of steps) {
              if (!step || typeof step !== 'object') continue;
              const s = Object.assign({}, step);
              const d = Math.max(0, Number(s.duration || 0));
              delete s.duration;
              tl.to(proxy, s, t);
              t += d > 0 ? d : 0;
            }
            this._attachPerTargetCallbacks(i, tl);
            this._targetTweens[i] = tl;
            if (this._internal.autoplay || this._playOnBuildOnce || this._internal.pendingPlay) tl.play(); else tl.pause(0);
            if (tl.timeScale && this._internal.timeScale != null) tl.timeScale(this._internal.timeScale);
          } else if (varsJSON && Object.keys(varsJSON).length > 0) {
            const tw = gsap.to(proxy, varsJSON);
            this._attachPerTargetCallbacks(i, tw);
            this._targetTweens[i] = tw;
            if (this._internal.autoplay || this._playOnBuildOnce || this._internal.pendingPlay) tw.play(); else tw.pause(0);
            if (tw.timeScale && this._internal.timeScale != null) tw.timeScale(this._internal.timeScale);
          } else {
            const tw = gsap.to(proxy, universalFallback);
            this._attachPerTargetCallbacks(i, tw);
            this._targetTweens[i] = tw;
            if (this._internal.autoplay || this._playOnBuildOnce || this._internal.pendingPlay) tw.play(); else tw.pause(0);
            if (tw.timeScale && this._internal.timeScale != null) tw.timeScale(this._internal.timeScale);
          }
        } catch(e) {}
      }

      // Clear pending flags after successful build
      this._internal.pendingBuild = false;
      if (this._playOnBuildOnce || this._internal.autoplay || this._internal.pendingPlay) this._internal.pendingPlay = false;
      this._playOnBuildOnce = false;
    },

    _attachPerTargetCallbacks: function(index, tween){
      if (!tween || !tween.eventCallback) return;
      tween.eventCallback('onStart', () => { this._setState({ isPlaying: true, isPaused: false }); this.sendSignalOnOutput('onStart'); });
      tween.eventCallback('onUpdate', () => { this._setState({ progress: tween.progress?.() || 0, duration: tween.duration?.() || 0 }); this.sendSignalOnOutput('onUpdate'); });
      tween.eventCallback('onComplete', () => { this._setState({ isPlaying: this._anyActiveTweens(), progress: 1 }); this.sendSignalOnOutput('onComplete'); });
    },

    _anyActiveTweens: function(){
      if (this._tween && this._tween.isActive?.()) return true;
      for (let i=0;i<MAX_TARGETS;i++) { if (this._targetTweens[i]?.isActive?.()) return true; }
      return false;
    },

    _buildTween: function(proxies, vars){
      const method = this._internal.method || 'to';
      const hasStagger = this._internal.staggerEnabled && proxies.length > 1;
      const fullVars = Object.assign({}, vars);

      if (hasStagger) {
        fullVars.stagger = { each: Math.max(0, this._internal.staggerEach || 0.1), from: this._internal.staggerFrom || 'start' };
      }

      const applyStartPause = (tween) => {
        if (!tween) return;
        if (this._internal.autoplay || this._playOnBuildOnce) {
          tween.play();
          this._setState({ isPlaying: true, isPaused: false });
        } else {
          tween.pause(0);
          this._setState({ isPlaying: false, isPaused: true });
        }
      };

      const attachCallbacks = (dest) => {
        const onStart = () => { this._setState({ isPlaying: true, isPaused: false }); this.sendSignalOnOutput('onStart'); };
        const onUpdate = () => { this._setState({ progress: dest.progress?.() || 0, duration: dest.duration?.() || 0 }); this.sendSignalOnOutput('onUpdate'); };
        const onComplete = () => { this._setState({ isPlaying: false, progress: 1 }); this.sendSignalOnOutput('onComplete'); };
        dest.eventCallback && dest.eventCallback('onStart', onStart);
        dest.eventCallback && dest.eventCallback('onUpdate', onUpdate);
        dest.eventCallback && dest.eventCallback('onComplete', onComplete);
      };

      try {
        if (proxies.length === 1) {
          const target = proxies[0];
          if (method === 'from') this._tween = gsap.from(target, fullVars);
          else if (method === 'fromTo') this._tween = gsap.fromTo(target, {}, fullVars);
          else this._tween = gsap.to(target, fullVars);
        } else {
          if (method === 'from') this._tween = gsap.from(proxies, fullVars);
          else if (method === 'fromTo') this._tween = gsap.fromTo(proxies, {}, fullVars);
          else this._tween = gsap.to(proxies, fullVars);
        }
        if (this._tween) {
          attachCallbacks(this._tween);
          applyStartPause(this._tween);
          if (this._tween.timeScale && this._internal.timeScale != null) this._tween.timeScale(this._internal.timeScale);
          if (this._internal.pendingProgress != null && this._tween.progress) { this._tween.progress(this._internal.pendingProgress); this._internal.pendingProgress = null; }
          if (this._internal.pendingSeek != null && this._tween.seek) { this._tween.seek(this._internal.pendingSeek); this._internal.pendingSeek = null; }
          // Clear pending flags after successful build
          this._internal.pendingBuild = false;
          // Only clear pendingPlay if we actually started or have a tween ready now
          if (this._playOnBuildOnce || this._internal.autoplay || this._internal.pendingPlay) {
            this._internal.pendingPlay = false;
          }
          this._playOnBuildOnce = false;
        }
      } catch (e) {
        // Swallow to avoid crashing graph
      }
    },

    _buildTimeline: function(proxies){
      try {
        const tl = gsap.timeline({
          defaults: { ease: this._resolveEase() },
          repeat: this._internal.repeat,
          repeatDelay: this._internal.repeatDelay,
          yoyo: this._internal.yoyo,
          delay: this._internal.delay
        });

        const steps = this._parseJSON(this._internal.timelineSteps, []);
        let t = 0;
        for (const step of steps) {
          if (!step || typeof step !== 'object') continue;
          const s = Object.assign({}, step);
          const d = Math.max(0, Number(s.duration || 0));
          delete s.duration;
          if (this._internal.staggerEnabled && proxies.length > 1) {
            s.stagger = { each: Math.max(0, this._internal.staggerEach || 0.1), from: this._internal.staggerFrom || 'start' };
          }
          tl.to(proxies, s, t);
          t += d > 0 ? d : 0;
        }

        // callbacks
        tl.eventCallback('onStart', () => { this._setState({ isPlaying: true, isPaused: false }); this.sendSignalOnOutput('onStart'); });
        tl.eventCallback('onUpdate', () => { this._setState({ progress: tl.progress(), duration: tl.duration() }); this.sendSignalOnOutput('onUpdate'); });
        tl.eventCallback('onComplete', () => { this._setState({ isPlaying: false, progress: 1 }); this.sendSignalOnOutput('onComplete'); });

        this._tween = tl;
        if (this._internal.autoplay || this._playOnBuildOnce || this._internal.pendingPlay) tl.play(); else tl.pause(0);
        // Clear pending flags after successful build
        this._internal.pendingBuild = false;
        this._internal.pendingPlay = false;
        this._playOnBuildOnce = false;
      } catch (e) {}
    },

    _resolveEase: function(){
      if (this._internal.advancedEase === 'custom' && this._compiledEase) return this._compiledEase;
      if (this._internal.advancedEase === 'gsapString' && typeof this._internal.ease === 'string') return this._internal.ease;
      return this._internal.ease || 'power1.out';
    },

    _prepareTargets: function(){
      const proxies = [];
      for (let i = 0; i < MAX_TARGETS; i++) {
        const node = this._targets[i];
        if (!node) continue;
        const proxy = this._ensureProxy(i, node);
        if (proxy) proxies.push(proxy);
      }
      return proxies;
    },

    _ensureProxy: function(index, node){
      if (this._proxies[index]) return this._proxies[index];
      const proxy = this._makeProxyForNode(node);
      this._proxies[index] = proxy;
      return proxy;
    },

    _makeProxyForNode: function(node){
      // PIXI nodes
      try {
        if (node?.pixiObject && typeof node.pixiObject === 'object') return node.pixiObject;
        if (node?.textObject && typeof node.textObject === 'object') return node.textObject;
        if (node?.graphicsObject && typeof node.graphicsObject === 'object') return node.graphicsObject;
        if (node?.tilingSpriteObject && typeof node.tilingSpriteObject === 'object') return node.tilingSpriteObject;
        if (node?.containerObject && typeof node.containerObject === 'object') return node.containerObject;
        if (node?.animatedSpriteObject && typeof node.animatedSpriteObject === 'object') return node.animatedSpriteObject;
      } catch (e) {}

      // DOM-like target proxy (CSS transform)
      const element = node?.getDOMElement?.() || node?.domElement || node?.element;
      const setStyle = node?.setStyle;
      if (element?.style || typeof setStyle === 'function') {
        const proxy = { _n: node, _el: element || null, _sx:1,_sy:1,_x:0,_y:0,_r:0,_a:1,_kx:0,_ky:0 };
        const apply = () => {
          const tr = `translate(${proxy._x}px, ${proxy._y}px) scale(${proxy._sx}, ${proxy._sy}) rotate(${proxy._r}rad) skew(${proxy._kx}rad, ${proxy._ky}rad)`;
          if (typeof setStyle === 'function') setStyle.call(node, { transform: tr, opacity: proxy._a });
          else if (proxy._el && proxy._el.style) { proxy._el.style.transform = tr; proxy._el.style.opacity = proxy._a; }
        };
        Object.defineProperties(proxy, {
          x: { get(){return this._x;}, set(v){ this._x = v||0; apply(); } },
          y: { get(){return this._y;}, set(v){ this._y = v||0; apply(); } },
          scaleX: { get(){return this._sx;}, set(v){ this._sx = v||1; apply(); } },
          scaleY: { get(){return this._sy;}, set(v){ this._sy = v||1; apply(); } },
          rotation: { get(){return this._r;}, set(v){ this._r = v||0; apply(); } },
          alpha: { get(){return this._a;}, set(v){ this._a = v==null?1:v; apply(); } },
          skewX: { get(){return this._kx;}, set(v){ this._kx = v||0; apply(); } },
          skewY: { get(){return this._ky;}, set(v){ this._ky = v||0; apply(); } },
        });
        return proxy;
      }

      // Fallback: animate plain object if it looks numeric
      if (node && typeof node === 'object') return node;
      return null;
    },

    _parseJSON: function(str, def){
      try { if (typeof str !== 'string') return def; return JSON.parse(str); } catch(e) { return def; }
    },

    _shouldBuild: function(){
      if (this._forceBuildOnce) { this._forceBuildOnce = false; return true; }
      return !!this._internal.autoApply;
    },

    _setState: function(s){
      const st = this._internal.state;
      if (s.isPlaying !== undefined) st.isPlaying = !!s.isPlaying;
      if (s.isPaused !== undefined) st.isPaused = !!s.isPaused;
      if (s.progress !== undefined) st.progress = Math.max(0, Math.min(1, Number(s.progress||0)));
      if (s.duration !== undefined) st.duration = Math.max(0, Number(s.duration||0));
      this.flagOutputDirty('isPlaying');
      this.flagOutputDirty('isPaused');
      this.flagOutputDirty('progress');
      this.flagOutputDirty('duration');
    },

    _killAll: function(){
      try { if (this._tween && this._tween.kill) this._tween.kill(); } catch(e) {}
      this._tween = null;
      for (let i=0;i<MAX_TARGETS;i++) { try { if (this._targetTweens[i]?.kill) this._targetTweens[i].kill(); } catch(e) {} this._targetTweens[i] = null; }
      this._setState({ isPlaying: false, isPaused: false, progress: 0 });
    },

    // Controls
    _play: function(){ if (this._tween) { this._tween.play(); this._setState({ isPlaying: true, isPaused: false }); } else { this._forceBuildOnce = true; this._playOnBuildOnce = true; this._internal.pendingPlay = true; this._internal.pendingBuild = true; this._update(); } },
    _pause: function(){ if (this._tween) { this._tween.pause(); this._setState({ isPaused: true }); } },
    _resume: function(){ if (this._tween) { this._tween.resume?.(); this._setState({ isPaused: false }); } },
    _restart: function(){ if (this._tween) { this._tween.restart(); this._setState({ isPlaying: true, isPaused: false }); } },
    _reverse: function(){ if (this._tween) { this._tween.reverse(); } },
    _stop: function(){ this._killAll(); },
  }
};

module.exports = { node: GsapAnimatorNode };
module.exports.default = { node: GsapAnimatorNode };


