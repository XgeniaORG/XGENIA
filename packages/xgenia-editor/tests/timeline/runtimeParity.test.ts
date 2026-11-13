import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as EditorModel from '../../src/editor/src/utils/timelineModel';
import RuntimeEvalModule from '../../../xgenia-viewer-react/src/nodes/std-library/timeline-eval.js';
import RuntimeNodeModule from '../../../xgenia-viewer-react/src/nodes/std-library/timeline.js';

// The editor (timelineModel.ts) and the runtime (timeline-eval.js, used by the Timeline node)
// evaluate the same JSON. These tests run both on the same tracks; a mismatch means the dock
// shows one pose and the game plays another.
const RuntimeEval: any = (RuntimeEvalModule as any).default ?? RuntimeEvalModule;
const TimelineNode: any = ((RuntimeNodeModule as any).default ?? RuntimeNodeModule).node;

const EASES: any[] = [undefined, 'linear', 'easeIn', 'easeOut', 'easeInOut', 'step', [0.42, 0, 0.58, 1], [0.25, 0.1, 0.25, 1], [0.9, -0.3, 0.1, 1.4], [0, 0, 1, 1]];

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

function randomDocJson(seed: number): string {
  const r = rng(seed);
  const tracks = [];
  const nTracks = 1 + Math.floor(r() * 4);
  for (let i = 0; i < nTracks; i++) {
    const keys = [];
    const nKeys = Math.floor(r() * 6);
    for (let k = 0; k < nKeys; k++) {
      const key: any = { t: Math.round(r() * 300) / 100, v: Math.round((r() * 400 - 200) * 100) / 100 };
      const ease = EASES[Math.floor(r() * EASES.length)];
      if (ease !== undefined) key.ease = ease;
      keys.push(key);
    }
    tracks.push({ id: `t${i}`, nodeId: `n${i % 2}`, param: ['transformX', 'opacity', 'x', 'transformRotation'][i % 4], unit: i % 2 ? null : 'px', keys });
  }
  return JSON.stringify({ v: 1, tracks });
}

test('editor and runtime parse the same JSON to the same document', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const json = randomDocJson(seed);
    assert.deepEqual(RuntimeEval.parseTimeline(json), EditorModel.parseTimeline(json), `seed ${seed}`);
  }
  for (const bad of ['', '{', 'null', '{"tracks":5}', '[]']) {
    assert.deepEqual(RuntimeEval.parseTimeline(bad), EditorModel.parseTimeline(bad));
  }
});

test('editor and runtime evaluate every ease to the same value at the same time', () => {
  let checked = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const json = randomDocJson(seed);
    const editorDoc = EditorModel.parseTimeline(json);
    const runtimeDoc = RuntimeEval.parseTimeline(json);
    for (let i = 0; i < editorDoc.tracks.length; i++) {
      for (let t = -0.25; t <= 3.5; t += 0.0137) {
        const a = EditorModel.evaluateTrack(editorDoc.tracks[i], t);
        const b = RuntimeEval.evaluateTrack(runtimeDoc.tracks[i], t);
        if (a === undefined || b === undefined) {
          assert.equal(a, b);
        } else {
          assert.ok(Math.abs(a - b) < 1e-9, `seed ${seed} track ${i} t=${t}: editor ${a} runtime ${b}`);
        }
        checked++;
      }
    }
  }
  assert.ok(checked > 1000);
});

test('ease curves match point for point', () => {
  for (const ease of EASES) {
    for (let u = 0; u <= 1.0001; u += 0.01) {
      const a = EditorModel.easeProgress(ease, u);
      const b = RuntimeEval.easeProgress(ease, u);
      assert.ok(Math.abs(a - b) < 1e-12, `${JSON.stringify(ease)} u=${u}`);
    }
  }
});

test('valuesAt shape matches what the runtime queues on the target', () => {
  const json = randomDocJson(7);
  const editorDoc = EditorModel.parseTimeline(json);
  const runtimeDoc = RuntimeEval.parseTimeline(json);
  for (const track of runtimeDoc.tracks) {
    const v = RuntimeEval.evaluateTrack(track, 1.1);
    if (v === undefined) continue;
    const editorValue = EditorModel.valuesAt(editorDoc, track.nodeId, 1.1)[track.param];
    assert.deepEqual(RuntimeEval.valueForTrack(track, v), editorValue);
  }
});

// ---- the runtime node, against fake targets ---------------------------------------------------

function fakeTarget(parameters: Record<string, any>, defaults: Record<string, any> = {}) {
  return {
    queued: [] as [string, any][],
    model: { type: 'Group', parameters },
    context: { getDefaultValueForInput: (_type: string, name: string) => defaults[name] },
    hasInput: () => true,
    queueInput(name: string, value: any) {
      this.queued.push([name, value]);
    }
  };
}

function makeTimeline(targets: Record<string, any>, runningInEditor = true) {
  const signals: string[] = [];
  const deleteListeners: Function[] = [];
  const timers: any[] = [];
  const self: any = {
    id: 'tl1',
    _internal: {},
    context: {
      runningInEditor,
      timerScheduler: {
        createTimer(args: any) {
          const timer = { ...args, running: false, start() { this.running = true; }, stop() { this.running = false; } };
          timers.push(timer);
          return timer;
        }
      }
    },
    nodeScope: { findNodeWithId: (id: string) => targets[id] },
    flagOutputDirty() {},
    sendSignalOnOutput(name: string) {
      signals.push(name);
    },
    scheduleAfterInputsHaveUpdated(cb: () => void) {
      cb();
    },
    addDeleteListener(fn: Function) {
      deleteListeners.push(fn);
    }
  };
  Object.assign(self, TimelineNode.methods);
  TimelineNode.initialize.call(self);
  const set = (name: string, value: any) => TimelineNode.inputs[name].set.call(self, value);
  const signal = (name: string) => TimelineNode.inputs[name].valueChangedToTrue.call(self);
  const output = (name: string) => TimelineNode.outputs[name].getter.call(self);
  return { self, set, signal, output, signals, deleteListeners, ticker: timers[0] };
}

const TRACKS = JSON.stringify({
  v: 1,
  tracks: [
    { id: 'a', nodeId: 'box', param: 'transformX', unit: 'px', keys: [{ t: 0, v: 0 }, { t: 1, v: 100 }] },
    { id: 'b', nodeId: 'sprite', param: 'alpha', unit: null, keys: [{ t: 0, v: 1 }, { t: 1, v: 0, ease: 'step' }] }
  ]
});

test('runtime node: scrub poses targets with units, endScrub restores base values', () => {
  const box = fakeTarget({ transformX: { value: 7, unit: 'px' } });
  const sprite = fakeTarget({}, { alpha: 1 });
  const tl = makeTimeline({ box, sprite });
  tl.set('tracks', TRACKS);

  const state = tl.self._internal.editorApi.scrub(0.5);
  assert.deepEqual(box.queued.pop(), ['transformX', { value: 50, unit: 'px' }]);
  assert.deepEqual(sprite.queued.pop(), ['alpha', 1], 'step holds until its key');
  assert.equal(state.scrubbing, true);
  assert.equal(tl.output('time'), 0.5);
  assert.equal(tl.output('progress'), 0.25, 'default duration 2 s');

  tl.self._internal.editorApi.endScrub();
  assert.deepEqual(box.queued.pop(), ['transformX', { value: 7, unit: 'px' }], 'model parameter');
  assert.deepEqual(sprite.queued.pop(), ['alpha', 1], 'port default');
  assert.equal(tl.output('time'), 0);
});

test('runtime node: new tracks while scrubbing re-apply at the scrub time; removed tracks restore', () => {
  const box = fakeTarget({ transformX: 3 });
  const sprite = fakeTarget({ alpha: 0.4 });
  const tl = makeTimeline({ box, sprite });
  tl.set('tracks', TRACKS);
  tl.self._internal.editorApi.scrub(0.25);
  box.queued.length = 0;
  sprite.queued.length = 0;

  const onlyBox = JSON.stringify({ v: 1, tracks: [{ id: 'a', nodeId: 'box', param: 'transformX', unit: 'px', keys: [{ t: 0, v: 0 }, { t: 1, v: 200 }] }] });
  tl.set('tracks', onlyBox);
  assert.deepEqual(box.queued, [['transformX', { value: 50, unit: 'px' }]]);
  assert.deepEqual(sprite.queued, [['alpha', 0.4]], 'its track is gone: back to base');

  // scrub() may carry tracks ahead of the parameter round trip
  box.queued.length = 0;
  tl.self._internal.editorApi.scrub(0.5, TRACKS);
  assert.deepEqual(box.queued, [['transformX', { value: 50, unit: 'px' }]]);
});

test('runtime node: playback advances, finishes once, loops when asked', () => {
  const box = fakeTarget({});
  const tl = makeTimeline({ box });
  tl.set('tracks', TRACKS);
  tl.set('duration', 1);
  tl.signal('play');
  assert.equal(tl.output('playing'), true);
  assert.equal(tl.ticker.running, true);

  tl.self._internal.lastTick = performance.now() - 400;
  tl.self._tick();
  assert.ok(Math.abs(tl.output('time') - 0.4) < 0.05, `time ${tl.output('time')}`);

  tl.self._internal.lastTick = performance.now() - 2000;
  tl.self._tick();
  assert.equal(tl.output('time'), 1);
  assert.equal(tl.output('playing'), false);
  assert.equal(tl.ticker.running, false);
  assert.deepEqual(tl.signals, ['finished']);
  assert.deepEqual(box.queued.pop(), ['transformX', { value: 100, unit: 'px' }]);

  tl.set('loop', true);
  tl.signal('restart');
  tl.self._internal.lastTick = performance.now() - 1250;
  tl.self._tick();
  assert.ok(Math.abs(tl.output('time') - 0.25) < 0.05, `looped time ${tl.output('time')}`);
  assert.equal(tl.output('playing'), true);
  assert.deepEqual(tl.signals, ['finished'], 'a loop does not finish');

  tl.signal('stop');
  assert.equal(tl.output('time'), 0);
  assert.equal(tl.output('playing'), false);
});

test('runtime node: registers in window.__XGENIA_TIMELINES only in the editor, and unregisters on delete', () => {
  const g = globalThis as any;
  const hadWindow = 'window' in g;
  const prev = g.window;
  g.window = g;
  try {
    delete g.__XGENIA_TIMELINES;
    const outside = makeTimeline({}, false);
    assert.equal(g.__XGENIA_TIMELINES, undefined);

    const box = fakeTarget({ transformX: 1 });
    const a = makeTimeline({ box });
    const b = makeTimeline({ box: fakeTarget({}) });
    a.set('tracks', TRACKS);
    b.set('tracks', TRACKS);
    const api = g.__XGENIA_TIMELINES.get('tl1');
    assert.ok(api, 'registered under the node id');
    assert.equal(api._instances.size, 2, 'two instances of one component share an entry');
    api.scrub(1);
    assert.deepEqual(box.queued.pop(), ['transformX', { value: 100, unit: 'px' }]);
    assert.equal(api.getState().time, 1);

    a.deleteListeners.forEach((fn) => fn.call(a.self));
    assert.deepEqual(box.queued.pop(), ['transformX', 1], 'delete restores base');
    assert.equal(g.__XGENIA_TIMELINES.get('tl1')._instances.size, 1);
    b.deleteListeners.forEach((fn) => fn.call(b.self));
    assert.equal(g.__XGENIA_TIMELINES.has('tl1'), false);
    void outside;
  } finally {
    delete g.__XGENIA_TIMELINES;
    if (hadWindow) g.window = prev;
    else delete g.window;
  }
});
