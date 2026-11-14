import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UndoActionGroup, UndoQueue } from '../../src/editor/src/models/undo-queue-model';

/** A value edited through the queue, the way setParameter records undo. */
function edit(queue: UndoQueue, box: { v: number }, to: number, label = 'set ' + to) {
  const from = box.v;
  const g = new UndoActionGroup({ label, do: () => (box.v = to), undo: () => (box.v = from) });
  queue.pushAndDo(g);
}

test('a new edit after undo keeps the undone steps as a branch', () => {
  const q = new UndoQueue();
  const box = { v: 0 };
  edit(q, box, 1);
  edit(q, box, 2);
  edit(q, box, 3);
  q.undo();
  q.undo(); // back at 1
  edit(q, box, 10);
  assert.equal(box.v, 10);
  assert.equal(q.getBranches().length, 1);
  assert.equal(q.getBranches()[0].forkAt, 1);
  assert.equal(q.getBranches()[0].actions.length, 2);
});

test('switching to the branch replays it, and the replaced steps become a branch', () => {
  const q = new UndoQueue();
  const box = { v: 0 };
  edit(q, box, 1);
  edit(q, box, 2);
  edit(q, box, 3);
  q.undo();
  q.undo();
  edit(q, box, 10);
  edit(q, box, 11);

  assert.equal(q.switchToBranch(0), true);
  assert.equal(box.v, 3);
  assert.deepEqual(q.getHistory().map((g) => g.label), ['set 1', 'set 2', 'set 3']);
  assert.equal(q.getBranches().length, 1);
  assert.deepEqual(q.getBranches()[0].actions.map((g) => g.label), ['set 10', 'set 11']);

  // and back again
  assert.equal(q.switchToBranch(0), true);
  assert.equal(box.v, 11);
  q.undo();
  q.undo();
  assert.equal(box.v, 1);
});

test('a branch forked inside an abandoned tail is re-rooted and still replays', () => {
  const q = new UndoQueue();
  const box = { v: 0 };
  edit(q, box, 1); // [1]
  edit(q, box, 2); // [1,2]
  edit(q, box, 3); // [1,2,3]
  q.undo(); // at 2
  edit(q, box, 20); // branch A {forkAt 2: [3]}, history [1,2,20]
  q.undo();
  q.undo(); // at 1
  edit(q, box, 100); // abandons [2,20]; A re-rooted to forkAt 1: [2,3]
  const branches = q.getBranches();
  assert.equal(branches.length, 2);
  const a = branches.find((b) => b.actions.map((g) => g.label).join() === 'set 2,set 3');
  assert.ok(a, 'branch A re-rooted with its prefix');
  assert.equal(a!.forkAt, 1);
  assert.equal(q.switchToBranch(branches.indexOf(a!)), true);
  assert.equal(box.v, 3);
});

test('clear drops branches', () => {
  const q = new UndoQueue();
  const box = { v: 0 };
  edit(q, box, 1);
  q.undo();
  edit(q, box, 2);
  q.clear();
  assert.equal(q.getBranches().length, 0);
  assert.equal(q.switchToBranch(0), false);
});
