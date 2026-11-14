import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TimelineStateModel, type TimelineNodeLike } from '../../src/editor/src/models/timelineState';
import type { TimelinePreviewBridge } from '../../src/editor/src/utils/timelinePreview';
import { parseTimeline, serializeTimeline, trackFor, upsertKey, emptyTimeline } from '../../src/editor/src/utils/timelineModel';
import { activeRecording, recordingParamsFor, recordWrites } from '../../src/editor/src/utils/timelineRecord';
import { animatableParams, baseValue, unitForParam } from '../../src/editor/src/utils/timelineTargets';

interface Write {
  node: string;
  name: string;
  value: any;
  args: any;
}

function fakeWorld() {
  const writes: Write[] = [];
  const previewCalls: any[][] = [];
  const componentA = { name: 'A' };
  const componentB = { name: 'B' };
  const graphA = { owner: componentA };
  const graphB = { owner: componentB };

  const make = (id: string, graph: any, parameters: Record<string, any>, typename = 'Group', ports: any[] = []): TimelineNodeLike => {
    const node: TimelineNodeLike = {
      id,
      typename,
      owner: graph,
      label: id.toUpperCase(),
      parameters,
      setParameter(name, value, args) {
        writes.push({ node: id, name, value, args });
        if (value === undefined) delete parameters[name];
        else parameters[name] = value;
      },
      getPort(name) {
        return ports.find((p) => p.name === name);
      }
    };
    return node;
  };

  const domPorts = [
    { name: 'transformX', displayName: 'Pos X', type: { name: 'number', units: ['px', '%'], defaultUnit: 'px' }, default: 0 },
    { name: 'transformY', displayName: 'Pos Y', type: { name: 'number', units: ['px', '%'], defaultUnit: 'px' }, default: 0 },
    { name: 'transformRotation', displayName: 'Rotation', type: { name: 'number', units: ['deg'], defaultUnit: 'deg' }, default: 0 },
    { name: 'transformScale', displayName: 'Scale', type: { name: 'number' }, default: 1 },
    { name: 'opacity', displayName: 'Opacity', type: 'number', default: 1 },
    { name: 'sizeMode', displayName: 'Size Mode', type: { name: 'enum' } }
  ];

  const timeline = make('tl', graphA, {}, 'net.xgenia.timeline');
  const box = make('box', graphA, { transformX: { value: 10, unit: 'px', isFixed: true }, sizeMode: 'contentSize' }, 'Group', domPorts);
  const sprite = make('sprite', graphA, { x: 5 }, 'pixi.Sprite', [
    { name: 'x', displayName: 'X', type: 'number', default: 0 },
    { name: 'rotation', displayName: 'Rotation (rad)', type: 'number', default: 0 }
  ]);
  const elsewhere = make('other', graphB, { transformX: 0 }, 'Group', domPorts);
  const nodes: Record<string, TimelineNodeLike> = { tl: timeline, box, sprite, other: elsewhere };

  const bridge: TimelinePreviewBridge = {
    scrub: (...a) => previewCalls.push(['scrub', ...a]),
    endScrub: (...a) => previewCalls.push(['endScrub', ...a]),
    play: (...a) => previewCalls.push(['play', ...a]),
    pause: (...a) => previewCalls.push(['pause', ...a]),
    stop: (...a) => previewCalls.push(['stop', ...a]),
    getState: (_id, cb) => cb(null)
  };

  const state = new TimelineStateModel();
  state.setNodeLookup((id) => nodes[id]);
  state.setPreviewBridge(bridge);
  return { state, writes, previewCalls, timeline, box, sprite, elsewhere };
}

test('not recording: no override params and no handled writes', () => {
  const w = fakeWorld();
  w.state.openOn('tl');
  assert.equal(recordingParamsFor(w.box, w.state), null);
  assert.equal(recordWrites(w.box, [{ param: 'transformX', value: { value: 50, unit: 'px' } }], 'G', { state: w.state }), false);
  assert.equal(w.writes.length, 0);
});

test('recording needs an open dock, a live timeline, and the same component', () => {
  const w = fakeWorld();
  w.state.set({ recording: true, timelineNodeId: 'tl', open: false });
  assert.equal(activeRecording(w.box, w.state), null, 'dock closed');
  w.state.set({ open: true });
  assert.ok(activeRecording(w.box, w.state));
  assert.equal(activeRecording(w.elsewhere, w.state), null, 'other component');
  assert.equal(activeRecording(w.timeline, w.state), null, 'the timeline itself');
  w.state.set({ timelineNodeId: 'gone' });
  assert.equal(activeRecording(w.box, w.state), null, 'timeline deleted');
});

test('recordingParamsFor overlays the values at the playhead, keeping the rest of a dimension', () => {
  const w = fakeWorld();
  let doc = upsertKey(emptyTimeline(), { nodeId: 'box', param: 'transformX', unit: 'px', t: 0, v: 0 });
  doc = upsertKey(doc, { nodeId: 'box', param: 'transformX', t: 2, v: 200 });
  doc = upsertKey(doc, { nodeId: 'box', param: 'opacity', unit: null, t: 0, v: 0.5 });
  w.timeline.parameters!.tracks = serializeTimeline(doc);
  w.state.openOn('tl');
  w.state.setTime(1);
  w.state.setRecording(true);

  const params = recordingParamsFor(w.box, w.state)!;
  assert.deepEqual(params.transformX, { value: 100, unit: 'px', isFixed: true });
  assert.equal(params.opacity, 0.5);
  assert.equal(params.sizeMode, 'contentSize', 'untracked params pass through');
  assert.deepEqual(w.box.parameters!.transformX, { value: 10, unit: 'px', isFixed: true }, 'node params untouched');

  // A recording node with no tracks gets a plain copy of its params.
  assert.deepEqual(recordingParamsFor(w.sprite, w.state), { x: 5 });
});

test('turning Record on poses the preview at the playhead', () => {
  const w = fakeWorld();
  w.state.openOn('tl');
  w.state.setTime(0.75);
  w.state.setRecording(true);
  assert.deepEqual(w.previewCalls, [['scrub', 'tl', 0.75, undefined]]);
  assert.equal(w.state.get().previewing, true);
});

test('recordWrites keys numeric writes at the playhead in one undoable tracks write', () => {
  const w = fakeWorld();
  w.state.openOn('tl');
  w.state.setTime(0.5);
  w.state.setRecording(true);
  w.previewCalls.length = 0;

  const group = { label: 'gesture' };
  const handled = recordWrites(
    w.box,
    [
      { param: 'transformX', value: { value: 40, unit: 'px', isFixed: false } },
      { param: 'transformY', value: { value: 25, unit: '%', isFixed: false } },
      { param: 'transformRotation', value: 15 },
      { param: 'sizeMode', value: 'explicit' }
    ],
    group,
    { state: w.state, label: 'Move' }
  );
  assert.equal(handled, true);

  const tracksWrites = w.writes.filter((x) => x.node === 'tl');
  assert.equal(tracksWrites.length, 1, 'all keys land in one write');
  assert.equal(tracksWrites[0].name, 'tracks');
  assert.equal(tracksWrites[0].args.undo, group);
  assert.equal(tracksWrites[0].args.label, 'Move');

  const doc = parseTimeline(w.timeline.parameters!.tracks);
  assert.deepEqual(trackFor(doc, 'box', 'transformX')?.keys, [{ t: 0.5, v: 40 }]);
  assert.equal(trackFor(doc, 'box', 'transformX')?.unit, 'px');
  assert.equal(trackFor(doc, 'box', 'transformY')?.unit, '%');
  assert.equal(trackFor(doc, 'box', 'transformRotation')?.unit, 'deg', 'bare number on a deg param');

  // Non-numeric writes still reach the node, in the same undo group; base transformX does not change.
  const boxWrites = w.writes.filter((x) => x.node === 'box');
  assert.deepEqual(boxWrites.map((x) => [x.name, x.value, x.args.undo]), [['sizeMode', 'explicit', group]]);
  assert.deepEqual(w.box.parameters!.transformX, { value: 10, unit: 'px', isFixed: true });

  // The preview is re-posed with the new tracks straight away.
  assert.equal(w.previewCalls.length, 1);
  assert.equal(w.previewCalls[0][0], 'scrub');
  assert.equal(w.previewCalls[0][2], 0.5);
  assert.equal(w.previewCalls[0][3], w.timeline.parameters!.tracks);
});

test('recording again at the same time replaces the key; another time adds one', () => {
  const w = fakeWorld();
  w.state.openOn('tl');
  w.state.setRecording(true);
  recordWrites(w.sprite, [{ param: 'x', value: 100 }], undefined, { state: w.state });
  recordWrites(w.sprite, [{ param: 'x', value: 120 }], undefined, { state: w.state });
  w.state.setTime(1);
  recordWrites(w.sprite, [{ param: 'x', value: 300 }], undefined, { state: w.state });
  const tr = trackFor(parseTimeline(w.timeline.parameters!.tracks), 'sprite', 'x')!;
  assert.equal(tr.unit, null, 'pixi numbers stay unitless');
  assert.deepEqual(tr.keys, [
    { t: 0, v: 120 },
    { t: 1, v: 300 }
  ]);
});

test('recordWrites declines when nothing is keyable, or for a node in another component', () => {
  const w = fakeWorld();
  w.state.openOn('tl');
  w.state.setRecording(true);
  assert.equal(recordWrites(w.box, [{ param: 'alignX', value: 'center' }], 'G', { state: w.state }), false);
  assert.equal(recordWrites(w.box, [], 'G', { state: w.state }), false);
  assert.equal(recordWrites(w.elsewhere, [{ param: 'transformX', value: 5 }], 'G', { state: w.state }), false);
  assert.equal(w.writes.length, 0);
});

test('closing the dock ends recording and releases the preview', () => {
  const w = fakeWorld();
  w.state.openOn('tl');
  w.state.setRecording(true);
  w.previewCalls.length = 0;
  w.state.close();
  assert.equal(w.state.get().recording, false);
  assert.equal(w.state.get().previewing, false);
  assert.deepEqual(w.previewCalls, [['endScrub', 'tl']]);
});

test('switching timelines releases the previous one and resets the playhead', () => {
  const w = fakeWorld();
  w.state.openOn('tl');
  w.state.setTime(1.2);
  w.state.scrubPreview();
  w.previewCalls.length = 0;
  w.state.openOn('tl2');
  assert.deepEqual(w.previewCalls, [['endScrub', 'tl']]);
  assert.equal(w.state.get().time, 0);
  assert.equal(w.state.get().timelineNodeId, 'tl2');
});

test('target helpers: animatable params, units and base values', () => {
  const w = fakeWorld();
  assert.deepEqual(
    animatableParams(w.box).map((p) => [p.param, p.label, p.unit]),
    [
      ['transformX', 'Pos X', 'px'],
      ['transformY', 'Pos Y', 'px'],
      ['transformRotation', 'Rotation', 'deg'],
      ['transformScale', 'Scale', null],
      ['opacity', 'Opacity', null]
    ]
  );
  assert.deepEqual(
    animatableParams(w.sprite).map((p) => p.param),
    ['x', 'rotation']
  );
  assert.deepEqual(baseValue(w.box, 'transformX'), { value: 10, unit: 'px' });
  assert.deepEqual(baseValue(w.box, 'transformRotation'), { value: 0, unit: 'deg' });
  assert.deepEqual(baseValue(w.box, 'transformScale'), { value: 1, unit: null });
  assert.equal(unitForParam(w.sprite, 'x'), null);
});
