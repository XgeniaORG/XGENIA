'use strict';

// Timeline: Unity-style keyframe animation. The `tracks` JSON (see timeline-eval.js) names a
// target node, one of its inputs and keyframes; every frame while playing the evaluated value
// goes through the target's real input setter (queueInput), the same path node-transitions.js
// and the States node use. Stop puts each animated input back to its base value.
//
// The editor's Timeline dock drives the preview through window.__XGENIA_TIMELINES (editor
// only): scrub(t) poses the targets at t without playing, endScrub() restores them.

var TimelineEval = require('./timeline-eval');

var REGISTRY_KEY = '__XGENIA_TIMELINES';
// The ticker is one long timer that runs while playing; time is measured, not taken from t.
var TICKER_DURATION_MS = 1e9;

function now() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

/**
 * window.__XGENIA_TIMELINES: Map nodeId -> api. A component used twice puts two runtime
 * Timeline nodes under one model id, so each entry fans out to every live instance.
 */
function registerTimeline(id, instance) {
  if (typeof window === 'undefined' || !id) return;
  var map = window[REGISTRY_KEY];
  if (!(map instanceof Map)) {
    map = new Map();
    window[REGISTRY_KEY] = map;
  }
  var entry = map.get(id);
  if (!entry || !entry._instances) {
    var instances = new Set();
    var each = function (method, args) {
      var result = null;
      instances.forEach(function (inst) {
        try {
          var r = inst[method].apply(inst, args);
          if (result === null && r !== undefined) result = r;
        } catch (e) {
          console.warn('[Timeline] ' + method + ' failed', e);
        }
      });
      return result;
    };
    entry = {
      _instances: instances,
      scrub: function (t, tracks) {
        return each('scrub', [t, tracks]);
      },
      endScrub: function () {
        return each('endScrub', []);
      },
      play: function () {
        return each('play', []);
      },
      pause: function () {
        return each('pause', []);
      },
      stop: function () {
        return each('stop', []);
      },
      getState: function () {
        var first = null;
        instances.forEach(function (inst) {
          if (!first) first = inst.getState();
        });
        return first;
      }
    };
    map.set(id, entry);
  }
  entry._instances.add(instance);
}

function unregisterTimeline(id, instance) {
  if (typeof window === 'undefined' || !id) return;
  var map = window[REGISTRY_KEY];
  if (!(map instanceof Map)) return;
  var entry = map.get(id);
  if (!entry || !entry._instances) return;
  entry._instances.delete(instance);
  if (entry._instances.size === 0) map.delete(id);
}

/** What an animated input goes back to: its connection value, else the model's, else the default. */
function baseValueOf(target, param) {
  if (
    typeof target._hasInputBeenSetFromAConnection === 'function' &&
    target._hasInputBeenSetFromAConnection(param)
  ) {
    return target._valuesFromConnections[param];
  }
  var model = target.model;
  if (!model) return undefined;
  if (model.parameters && Object.prototype.hasOwnProperty.call(model.parameters, param)) {
    return model.parameters[param];
  }
  var variant = target.variant;
  if (variant && variant.parameters && Object.prototype.hasOwnProperty.call(variant.parameters, param)) {
    return variant.parameters[param];
  }
  if (target.context && typeof target.context.getDefaultValueForInput === 'function') {
    return target.context.getDefaultValueForInput(model.type, param);
  }
  return undefined;
}

var TimelineNode = {
  name: 'net.xgenia.timeline',
  displayName: 'Timeline',
  shortDesc: 'Keyframe animation of other nodes’ properties over time. Edit it in the Timeline dock.',
  category: 'Animation',
  // Module-level names the node's functions use, so an edited Script still compiles.
  scriptScope: {
    TimelineEval: TimelineEval,
    registerTimeline: registerTimeline,
    unregisterTimeline: unregisterTimeline,
    baseValueOf: baseValueOf,
    now: now,
    TICKER_DURATION_MS: TICKER_DURATION_MS
  },
  initialize: function () {
    var self = this;
    var internal = this._internal;

    internal.doc = TimelineEval.emptyDoc();
    internal.duration = 2;
    internal.loop = false;
    internal.speed = 1;
    internal.autoplay = false;
    internal.time = 0;
    internal.playing = false;
    internal.scrubbing = false;
    internal.applied = false;
    // nodeId|param -> {nodeId, param}: every input this timeline has written, to restore.
    internal.touched = {};

    internal.ticker = this.context.timerScheduler.createTimer({
      duration: TICKER_DURATION_MS,
      onRunning: function () {
        self._tick();
      },
      onFinish: function () {
        // ~11 days of continuous play: keep going.
        if (internal.playing) internal.ticker.start();
      }
    });

    internal.editorApi = {
      scrub: function (t, tracks) {
        return self._scrub(t, tracks);
      },
      endScrub: function () {
        return self._endScrub();
      },
      play: function () {
        internal.scrubbing = false;
        self._play();
        return self._state();
      },
      pause: function () {
        self._pause();
        return self._state();
      },
      stop: function () {
        self._stop();
        return self._state();
      },
      getState: function () {
        return self._state();
      }
    };

    if (this.context.runningInEditor) registerTimeline(this.id, internal.editorApi);

    this.addDeleteListener(function () {
      internal.playing = false;
      internal.ticker.stop();
      self._restoreBase();
      unregisterTimeline(self.id, internal.editorApi);
    });
  },
  getInspectInfo: function () {
    var internal = this._internal;
    return internal.time.toFixed(2) + ' / ' + internal.duration + ' s' + (internal.playing ? ' (playing)' : '');
  },
  inputs: {
    tracks: {
      // Edited in the Timeline dock, not as raw JSON in the property panel (allowConnectionsOnly
      // keeps it out of the inspector; the dock still writes the parameter).
      type: { name: 'string', allowConnectionsOnly: true },
      displayName: 'Tracks',
      group: 'Timeline',
      default: '',
      set: function (value) {
        var internal = this._internal;
        internal.doc = TimelineEval.parseTimeline(value);
        this._restoreUntracked();
        // A key added in the editor while posed shows at once.
        if (internal.scrubbing || (!internal.playing && internal.applied)) this._apply(internal.time);
      }
    },
    duration: {
      type: 'number',
      displayName: 'Duration (s)',
      group: 'Timeline',
      default: 2,
      set: function (value) {
        var n = Number(value);
        this._internal.duration = isFinite(n) && n > 0 ? n : 0;
        this.flagOutputDirty('progress');
      }
    },
    loop: {
      type: 'boolean',
      displayName: 'Loop',
      group: 'Timeline',
      default: false,
      set: function (value) {
        this._internal.loop = !!value;
      }
    },
    autoplay: {
      type: 'boolean',
      displayName: 'Autoplay',
      group: 'Timeline',
      default: false,
      set: function (value) {
        var self = this;
        var internal = this._internal;
        internal.autoplay = !!value;
        if (internal.autoplay && !internal.autoplayed) {
          internal.autoplayed = true;
          this.scheduleAfterInputsHaveUpdated(function () {
            if (internal.autoplay && !internal.scrubbing && !internal.playing) self._play();
          });
        }
      }
    },
    speed: {
      type: 'number',
      displayName: 'Speed',
      group: 'Timeline',
      default: 1,
      set: function (value) {
        var n = Number(value);
        this._internal.speed = isFinite(n) ? n : 1;
      }
    },
    play: {
      displayName: 'Play',
      group: 'Actions',
      valueChangedToTrue: function () {
        this._internal.scrubbing = false;
        this._play();
      }
    },
    pause: {
      displayName: 'Pause',
      group: 'Actions',
      valueChangedToTrue: function () {
        this._pause();
      }
    },
    stop: {
      displayName: 'Stop',
      group: 'Actions',
      valueChangedToTrue: function () {
        this._stop();
      }
    },
    restart: {
      displayName: 'Restart',
      group: 'Actions',
      valueChangedToTrue: function () {
        this._internal.scrubbing = false;
        this._internal.time = this._internal.speed < 0 ? this._internal.duration : 0;
        this._play();
      }
    }
  },
  outputs: {
    finished: {
      type: 'signal',
      displayName: 'Finished',
      group: 'Events'
    },
    time: {
      type: 'number',
      displayName: 'Time (s)',
      group: 'Status',
      getter: function () {
        return this._internal.time;
      }
    },
    progress: {
      type: 'number',
      displayName: 'Progress',
      group: 'Status',
      getter: function () {
        var internal = this._internal;
        return internal.duration > 0 ? Math.min(1, Math.max(0, internal.time / internal.duration)) : 0;
      }
    },
    playing: {
      type: 'boolean',
      displayName: 'Playing',
      group: 'Status',
      getter: function () {
        return this._internal.playing;
      }
    }
  },
  methods: {
    _state: function () {
      var internal = this._internal;
      return {
        time: internal.time,
        duration: internal.duration,
        playing: internal.playing,
        scrubbing: internal.scrubbing
      };
    },
    _setPlaying: function (playing) {
      if (this._internal.playing === playing) return;
      this._internal.playing = playing;
      this.flagOutputDirty('playing');
    },
    _flagTime: function () {
      this.flagOutputDirty('time');
      this.flagOutputDirty('progress');
    },
    /** Pose every target at time t through its real input setter. */
    _apply: function (t) {
      var internal = this._internal;
      var tracks = internal.doc.tracks;
      for (var i = 0; i < tracks.length; i++) {
        var track = tracks[i];
        var v = TimelineEval.evaluateTrack(track, t);
        if (v === undefined) continue;
        var target = this.nodeScope && this.nodeScope.findNodeWithId(track.nodeId);
        if (!target || target === this || target._deleted) continue;
        if (typeof target.hasInput === 'function' && !target.hasInput(track.param)) {
          if (typeof target.registerInputIfNeeded === 'function') target.registerInputIfNeeded(track.param);
          if (!target.hasInput(track.param)) continue;
        }
        internal.touched[track.nodeId + '|' + track.param] = { nodeId: track.nodeId, param: track.param };
        target.queueInput(track.param, TimelineEval.valueForTrack(track, v));
      }
      internal.applied = true;
    },
    _restoreEntry: function (entry) {
      var target = this.nodeScope && this.nodeScope.findNodeWithId(entry.nodeId);
      if (!target || target._deleted) return;
      var base = baseValueOf(target, entry.param);
      if (base !== undefined) target.queueInput(entry.param, base);
    },
    /** Put every input this timeline wrote back to its base value. */
    _restoreBase: function () {
      var internal = this._internal;
      var touched = internal.touched;
      internal.touched = {};
      internal.applied = false;
      for (var key in touched) this._restoreEntry(touched[key]);
    },
    /** A track removed from the JSON leaves its target where the last frame put it: restore it. */
    _restoreUntracked: function () {
      var internal = this._internal;
      var live = {};
      for (var i = 0; i < internal.doc.tracks.length; i++) {
        var tr = internal.doc.tracks[i];
        live[tr.nodeId + '|' + tr.param] = true;
      }
      for (var key in internal.touched) {
        if (live[key]) continue;
        var entry = internal.touched[key];
        delete internal.touched[key];
        this._restoreEntry(entry);
      }
    },
    _play: function () {
      var internal = this._internal;
      var dur = internal.duration;
      // Play from the end (or start, reversed) of a finished run starts over.
      if (internal.speed >= 0 && dur > 0 && internal.time >= dur) internal.time = 0;
      if (internal.speed < 0 && internal.time <= 0) internal.time = dur;
      internal.lastTick = now();
      this._setPlaying(true);
      this._apply(internal.time);
      this._flagTime();
      internal.ticker.start();
    },
    _pause: function () {
      var internal = this._internal;
      internal.ticker.stop();
      this._setPlaying(false);
    },
    _stop: function () {
      var internal = this._internal;
      internal.ticker.stop();
      internal.scrubbing = false;
      internal.time = 0;
      this._setPlaying(false);
      this._restoreBase();
      this._flagTime();
    },
    _tick: function () {
      var internal = this._internal;
      if (!internal.playing) return;
      var t = now();
      var dt = Math.max(0, (t - (internal.lastTick || t)) / 1000);
      internal.lastTick = t;

      var dur = internal.duration;
      var time = internal.time + dt * internal.speed;
      var finished = false;

      if (dur <= 0) {
        time = 0;
        finished = true;
      } else if (internal.speed >= 0 && time >= dur) {
        if (internal.loop) time = time % dur;
        else {
          time = dur;
          finished = true;
        }
      } else if (internal.speed < 0 && time <= 0) {
        if (internal.loop) time = dur + (time % dur);
        else {
          time = 0;
          finished = true;
        }
      }

      internal.time = time;
      this._apply(time);
      this._flagTime();

      if (finished) {
        internal.ticker.stop();
        this._setPlaying(false);
        this.sendSignalOnOutput('finished');
      }
    },
    _scrub: function (t, tracks) {
      var internal = this._internal;
      if (tracks !== undefined && tracks !== null) {
        internal.doc = TimelineEval.parseTimeline(tracks);
        this._restoreUntracked();
      }
      if (internal.playing) this._pause();
      var n = Number(t);
      internal.time = isFinite(n) ? Math.max(0, n) : 0;
      internal.scrubbing = true;
      this._apply(internal.time);
      this._flagTime();
      return this._state();
    },
    _endScrub: function () {
      var internal = this._internal;
      internal.scrubbing = false;
      internal.ticker.stop();
      internal.time = 0;
      this._setPlaying(false);
      this._restoreBase();
      this._flagTime();
      return this._state();
    }
  }
};

module.exports = {
  node: TimelineNode
};
