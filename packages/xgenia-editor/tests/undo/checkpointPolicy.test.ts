import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUTO_EVERY_CHANGES, AUTO_EVERY_MS, pruneCheckpoints, shouldAutoCheckpoint } from '../../src/editor/src/models/checkpointPolicy';

test('auto checkpoint after enough changes or enough time, never with no changes', () => {
  assert.equal(shouldAutoCheckpoint(0, AUTO_EVERY_MS * 10), false);
  assert.equal(shouldAutoCheckpoint(AUTO_EVERY_CHANGES - 1, 1000), false);
  assert.equal(shouldAutoCheckpoint(AUTO_EVERY_CHANGES, 1000), true);
  assert.equal(shouldAutoCheckpoint(1, AUTO_EVERY_MS), true);
});

test('pruning keeps the newest manual and automatic checkpoints separately', () => {
  const index = [];
  for (let i = 0; i < 40; i++) index.push({ id: 'm' + i, label: 'm', createdAt: i, auto: false });
  for (let i = 0; i < 30; i++) index.push({ id: 'a' + i, label: 'a', createdAt: 100 + i, auto: true });
  const [kept, dropped] = pruneCheckpoints(index);
  assert.equal(kept.filter((c) => !c.auto).length, 30);
  assert.equal(kept.filter((c) => c.auto).length, 20);
  assert.equal(dropped.length, 20);
  assert.equal(kept[0].id, 'a29'); // newest first
  assert.ok(!kept.some((c) => c.id === 'm0'), 'oldest manual dropped');
});
