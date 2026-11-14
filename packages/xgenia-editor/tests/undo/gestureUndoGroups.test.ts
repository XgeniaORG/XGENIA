import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UndoActionGroup, UndoQueue } from '../../src/editor/src/models/undo-queue-model';
import { GestureUndoGroups, NUDGE_COALESCE_MS } from '../../src/editor/src/utils/gestureUndoGroups';

/** A parameter on a fake node, written the way NodeGraphNode.setParameter records undo. */
function param(initial: number) {
  const box = { value: initial };
  const write = (group: UndoActionGroup, value: number) => {
    const old = box.value;
    box.value = value;
    group.push({ do: () => (box.value = value), undo: () => (box.value = old) });
  };
  return { box, write };
}

function setup() {
  const queue = new UndoQueue();
  let clock = 1000;
  const groups = new GestureUndoGroups(queue, () => clock);
  return { queue, groups, tick: (ms: number) => (clock += ms) };
}

test('a gesture is one undo entry', () => {
  const { queue, groups } = setup();
  const x = param(0);
  const req = { label: 'Move element' };
  const { group, reused } = groups.begin(req);
  x.write(group, 10);
  const id = groups.end(group, reused, req);
  assert.ok(id);
  assert.equal(queue.getHistory().length, 1);
  queue.undo();
  assert.equal(x.box.value, 0);
});

test('a resize correction joins the resize, so one Cmd+Z takes back both', () => {
  const { queue, groups } = setup();
  const width = param(100);
  const offset = param(0);
  const first = groups.begin({ label: 'Resize element' });
  width.write(first.group, 140);
  const id = groups.end(first.group, first.reused, {})!;

  const fix = groups.begin({ amendGroupId: id });
  assert.equal(fix.reused, true);
  offset.write(fix.group, -40);
  assert.equal(groups.end(fix.group, fix.reused, {}), id);

  assert.equal(queue.getHistory().length, 1);
  queue.undo();
  assert.equal(width.box.value, 100);
  assert.equal(offset.box.value, 0);
  queue.redo();
  assert.equal(width.box.value, 140);
  assert.equal(offset.box.value, -40);
});

test('a correction after something else was recorded starts its own entry', () => {
  const { queue, groups } = setup();
  const width = param(100);
  const first = groups.begin({});
  width.write(first.group, 140);
  const id = groups.end(first.group, first.reused, {})!;

  queue.push(new UndoActionGroup({ label: 'property edit', do: () => {}, undo: () => {} }));
  const fix = groups.begin({ amendGroupId: id });
  assert.equal(fix.reused, false);
});

test('a run of nudges is one entry; a pause starts a new one', () => {
  const { queue, groups, tick } = setup();
  const x = param(0);
  for (let i = 1; i <= 5; i++) {
    const req = { coalesce: 'nudge:n1' };
    const { group, reused } = groups.begin(req);
    x.write(group, i);
    groups.end(group, reused, req);
    tick(100);
  }
  assert.equal(queue.getHistory().length, 1);

  tick(NUDGE_COALESCE_MS + 1);
  const req = { coalesce: 'nudge:n1' };
  const { group, reused } = groups.begin(req);
  assert.equal(reused, false);
  x.write(group, 6);
  groups.end(group, reused, req);
  assert.equal(queue.getHistory().length, 2);

  queue.undo();
  assert.equal(x.box.value, 5);
  queue.undo();
  assert.equal(x.box.value, 0);
});

test('nudging a different node does not join the previous run', () => {
  const { groups } = setup();
  const a = groups.begin({ coalesce: 'nudge:a' });
  param(0).write(a.group, 1);
  groups.end(a.group, a.reused, { coalesce: 'nudge:a' });
  assert.equal(groups.begin({ coalesce: 'nudge:b' }).reused, false);
});

test('after an undo the next nudge does not write into the undone entry', () => {
  const { queue, groups } = setup();
  const a = groups.begin({ coalesce: 'nudge:a' });
  param(0).write(a.group, 1);
  groups.end(a.group, a.reused, { coalesce: 'nudge:a' });
  queue.undo();
  assert.equal(groups.begin({ coalesce: 'nudge:a' }).reused, false);
});

test('a blocked gesture records nothing and returns no id', () => {
  const { queue, groups } = setup();
  const { group, reused } = groups.begin({});
  assert.equal(groups.end(group, reused, {}), null);
  assert.equal(queue.getHistory().length, 0);
});
