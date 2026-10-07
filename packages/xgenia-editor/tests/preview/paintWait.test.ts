import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afterNextPaint } from '../../src/editor/src/views/VisualCanvas/paintWait';

/** A frame clock driven by hand: each tick runs the callbacks queued before it. */
function frames() {
  let queue: Array<() => void> = [];
  return {
    raf: (cb: () => void) => queue.push(cb),
    tick() {
      const run = queue;
      queue = [];
      for (const cb of run) cb();
    }
  };
}

const settled = async (p: Promise<void>) => {
  let done = false;
  p.then(() => (done = true));
  await new Promise((r) => setImmediate(r));
  return done;
};

test('a capture waits for the frame that carries the change, not the one being built', async () => {
  const clock = frames();
  const wait = afterNextPaint(clock.raf, 10_000);
  assert.equal(await settled(wait), false, 'nothing painted yet');
  clock.tick(); // the first callback runs BEFORE this frame is painted
  assert.equal(await settled(wait), false, 'still the frame being built');
  clock.tick();
  assert.equal(await settled(wait), true);
});

test('a window producing no frames does not hang the capture', async () => {
  const t0 = Date.now();
  await afterNextPaint(() => undefined, 30);
  assert.ok(Date.now() - t0 >= 25);
});

import { waitUntilSettled } from '../../src/editor/src/views/VisualCanvas/paintWait';

test('the design capture waits for the game canvas to follow the resize', async () => {
  // The viewport already says 1440x810; the canvas redraws three ticks later.
  const sizes = [{ w: 383, h: 215 }, { w: 383, h: 215 }, { w: 383, h: 215 }, { w: 1440, h: 810 }];
  let i = 0;
  const before = sizes[0];
  const r = await waitUntilSettled(
    async () => sizes[Math.min(i, sizes.length - 1)],
    (c) => Math.abs(c.w - before.w) > 2 || Math.abs(c.h - before.h) > 2,
    { timeoutMs: 10_000, tick: async () => { i++; } }
  );
  assert.equal(r.settled, true);
  assert.deepEqual(r.value, { w: 1440, h: 810 });
  assert.equal(i, 3);
});

test('a canvas that never changes does not hold the capture past the limit', async () => {
  let t = 0;
  const r = await waitUntilSettled(async () => 1, () => false, { timeoutMs: 50, tick: async () => { t += 20; }, now: () => t });
  assert.equal(r.settled, false);
  assert.ok(t >= 50 && t <= 80);
});
