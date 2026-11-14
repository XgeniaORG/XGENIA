import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampZoom,
  dragDelta,
  majorTickStep,
  MAX_PX_PER_SECOND,
  MIN_PX_PER_SECOND,
  rulerTicks,
  scrollForZoom,
  snapTime
} from '../../src/editor/src/views/TimelineDock/timelineDockMath';
import { timelineCallCode } from '../../src/editor/src/utils/timelinePreview';

test('zoom clamps and tick spacing stays readable', () => {
  assert.equal(clampZoom(1), MIN_PX_PER_SECOND);
  assert.equal(clampZoom(1e9), MAX_PX_PER_SECOND);
  assert.equal(majorTickStep(160), 0.5);
  assert.equal(majorTickStep(64), 1);
  assert.equal(majorTickStep(2400), 0.05);
  const ticks = rulerTicks(2, 160);
  assert.equal(ticks[0].t, 0);
  assert.ok(ticks[0].major);
  assert.ok(ticks.some((t) => !t.major));
  assert.ok(Math.abs(ticks[ticks.length - 1].t - 2) < 1e-9);
});

test('snapping lands on 60 fps frames; a drag never pushes a key below 0', () => {
  assert.equal(snapTime(0.5049), 0.5);
  assert.equal(snapTime(-1), 0);
  assert.equal(snapTime(0.50123, false), 0.5012);
  assert.ok(Math.abs(dragDelta(1, 0.26, 1, true) - (1.2666666666666666 - 1)) < 1e-9);
  assert.equal(dragDelta(1, -5, 0.5, true), -0.5);
});

test('zoom keeps the time under the cursor in place', () => {
  // t=2 s at 100 px/s under a cursor 300 px in, lane starting 212 px into the content
  assert.equal(scrollForZoom(2, 200, 300, 212), 312);
  assert.equal(scrollForZoom(0, 200, 300, 212), 0);
});

test('preview call code finds the api by id, passes JSON args and swallows errors', () => {
  const code = timelineCallCode("a'b", 'scrub', [1.5, '{"v":1}']);
  const calls: any[] = [];
  const win: any = {
    __XGENIA_TIMELINES: new Map([["a'b", { scrub: (...a: any[]) => (calls.push(a), { time: a[0] }) }]])
  };
  // eslint-disable-next-line no-new-func
  const run = new Function('window', `return ${code};`);
  assert.equal(run(win), JSON.stringify({ time: 1.5 }));
  assert.deepEqual(calls, [[1.5, '{"v":1}']]);
  assert.equal(run({}), null, 'no registry');
  assert.equal(new Function('window', `return ${timelineCallCode('zz', 'play')};`)(win), null, 'unknown id');
  const throwing: any = { __XGENIA_TIMELINES: new Map([['x', { stop: () => { throw new Error('boom'); } }]]) };
  assert.equal(new Function('window', `return ${timelineCallCode('x', 'stop')};`)(throwing), null);
});
