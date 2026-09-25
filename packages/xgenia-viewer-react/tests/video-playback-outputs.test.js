// The Video node's playback outputs have to fire from the element's own media
// events. A user asked the AI to swap to an image "when the video ends"; with no
// ended output the AI fell back to a hard-coded Timer. On Play / On Pause /
// Playback Position were declared but never reached the <video> element, so they
// never fired either.
//
// These tests drive the real node (runtime NodeDefinition + the Video node's
// output wiring) and the real Video component, with a fake media element that
// dispatches the DOM events a browser would.
global.XGENIA = global.XGENIA || { deployed: false };

class FakeVideo extends EventTarget {
  constructor() {
    super();
    this.paused = true;
    this.ended = false;
    this.loop = false;
    this.currentTime = 0;
    this.duration = NaN;
    this.videoWidth = 0;
    this.videoHeight = 0;
  }
  emit(type) {
    this.dispatchEvent(new Event(type));
  }
}
class FakeImage extends EventTarget {}
global.HTMLVideoElement = FakeVideo;
global.HTMLImageElement = FakeImage;

const NodeDefinition = require('@xgenia/runtime/src/nodedefinition');
const videoModule = require('../src/nodes/visual/video.js');
const { Video } = require('../src/components/visual/Video');

const definition = (videoModule.default || videoModule).node;

function mountVideo() {
  const Node = NodeDefinition.defineNode(definition);
  const node = new Node(undefined, 'video-1');

  const signals = [];
  const values = [];
  // What a downstream node would read from the value outputs at the moment each
  // signal goes out.
  const seenAtSignal = {};
  node.sendSignalOnOutput = (name) => {
    signals.push(name);
    seenAtSignal[name] = {
      isPlaying: node.getOutput('isPlaying').value,
      position: node.getOutput('onTimeUpdate').value
    };
  };
  node.flagOutputDirty = (name) => values.push([name, node.getOutput(name).value]);

  const component = new Video({ ...node.props, style: {} });
  const attach = (element) => component.render().props.innerRef(element);

  return { node, component, attach, signals, values, seenAtSignal };
}

const emitted = (values, name) => values.filter(([n]) => n === name).map(([, v]) => v);

let now = 0;
beforeEach(() => {
  now = 1000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
});
afterEach(() => jest.restoreAllMocks());

test('the node declares the playback outputs in the Playback group', () => {
  const outputs = definition.outputs;
  const expected = {
    onEnded: 'signal',
    onPlay: 'signal',
    onPause: 'signal',
    onTimeUpdate: 'number',
    duration: 'number',
    isPlaying: 'boolean'
  };
  for (const [name, type] of Object.entries(expected)) {
    expect(outputs[name]).toBeDefined();
    expect(outputs[name].type).toBe(type);
    expect(outputs[name].group).toBe('Playback');
  }
});

test('ended fires On Ended, clears Is Playing and flushes the final position', () => {
  const { attach, node, signals, seenAtSignal } = mountVideo();
  const video = new FakeVideo();
  attach(video);

  video.duration = 1.1;
  video.emit('loadedmetadata');
  expect(node.getOutput('duration').value).toBe(1.1);

  video.paused = false;
  video.emit('play');
  video.emit('playing');
  expect(signals).toEqual(['onPlay']);
  expect(node.getOutput('isPlaying').value).toBe(true);

  // What a browser dispatches at the end of a non-looping video: paused flips,
  // then `pause`, then `ended` — with `ended` already true during `pause`.
  video.currentTime = 1.1;
  video.paused = true;
  video.ended = true;
  video.emit('pause');
  video.emit('ended');

  expect(signals).toEqual(['onPlay', 'onEnded']);
  expect(node.getOutput('isPlaying').value).toBe(false);
  expect(node.getOutput('onTimeUpdate').value).toBe(1.1);
  // State is settled before the signal goes out, so a handler reading the
  // outputs on On Ended sees the finished values.
  expect(seenAtSignal.onEnded).toEqual({ isPlaying: false, position: 1.1 });
});

test('pause (not at the end) fires On Pause and clears Is Playing', () => {
  const { attach, node, signals } = mountVideo();
  const video = new FakeVideo();
  attach(video);

  video.paused = false;
  video.emit('play');
  video.currentTime = 0.4;
  video.paused = true;
  video.emit('pause');

  expect(signals).toEqual(['onPlay', 'onPause']);
  expect(node.getOutput('isPlaying').value).toBe(false);
  expect(node.getOutput('onTimeUpdate').value).toBe(0.4);
});

test('a looping video never fires On Ended', () => {
  const { attach, signals } = mountVideo();
  const video = new FakeVideo();
  video.loop = true;
  attach(video);

  video.paused = false;
  video.emit('play');
  // Browsers do not dispatch `ended` while looping; even if one did, the node
  // must not report an end that playback never reached.
  video.emit('ended');

  expect(signals).toEqual(['onPlay']);
});

test('Playback Position is throttled to at most 4 updates per second', () => {
  const { attach, node, values } = mountVideo();
  const video = new FakeVideo();
  attach(video);
  video.paused = false;
  video.emit('play');

  // One second of 60 Hz timeupdates (Firefox can fire that often), with the
  // node re-rendering in between — a re-render must not reset the throttle.
  for (let i = 1; i <= 60; i++) {
    now += 16;
    attach(video);
    video.currentTime = i / 60;
    video.emit('timeupdate');
  }
  const updates = emitted(values, 'onTimeUpdate');
  expect(updates.length).toBeGreaterThan(0);
  expect(updates.length).toBeLessThanOrEqual(4);

  // A seek reports the new position straight away.
  now += 1;
  video.currentTime = 0.2;
  video.emit('seeked');
  expect(node.getOutput('onTimeUpdate').value).toBe(0.2);
});

test('duration reports 0 while unknown or unbounded', () => {
  const { attach, node } = mountVideo();
  const video = new FakeVideo();
  attach(video);

  video.duration = NaN;
  video.emit('durationchange');
  expect(node.getOutput('duration').value).toBe(0);

  video.duration = Infinity;
  video.emit('durationchange');
  expect(node.getOutput('duration').value).toBe(0);

  video.duration = 3;
  video.emit('durationchange');
  expect(node.getOutput('duration').value).toBe(3);
});

test('re-renders do not double-subscribe; element swaps and unmount unsubscribe', () => {
  const { attach, component, signals } = mountVideo();
  const first = new FakeVideo();
  attach(first);
  attach(first); // every render hands the same element back through the ref
  first.emit('play');
  expect(signals).toEqual(['onPlay']);

  const second = new FakeVideo();
  attach(second);
  first.emit('play');
  expect(signals).toEqual(['onPlay']);
  second.emit('play');
  expect(signals).toEqual(['onPlay', 'onPlay']);

  component.componentWillUnmount();
  second.emit('play');
  second.emit('ended');
  expect(signals).toEqual(['onPlay', 'onPlay']);
});
