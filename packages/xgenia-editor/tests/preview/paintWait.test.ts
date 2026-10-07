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
