import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatHistoryLabel,
  historyJump,
  historyRows,
  jumpToastText,
  pointerForEntry
} from '../../src/editor/src/views/panels/HistoryPanel/historyModel';

test('rows mark the entry before the pointer as current, later ones as undone', () => {
  const rows = historyRows(['drag nodes', 'delete nodes', 'paste'], 2);
  assert.deepEqual(
    rows.map((r) => r.state),
    ['done', 'current', 'undone']
  );
  assert.deepEqual(
    rows.map((r) => r.label),
    ['Drag nodes', 'Delete nodes', 'Paste']
  );
});

test('pointer at 0: nothing is current (the Start row is)', () => {
  assert.deepEqual(
    historyRows(['a', 'b'], 0).map((r) => r.state),
    ['undone', 'undone']
  );
});

test('pointer at the end: the newest entry is current', () => {
  assert.deepEqual(
    historyRows(['a', 'b'], 2).map((r) => r.state),
    ['done', 'current']
  );
});

test('clicking an entry targets the pointer just after it; Start targets 0', () => {
  assert.equal(pointerForEntry(0), 1);
  assert.equal(pointerForEntry(4), 5);
  assert.equal(pointerForEntry(-1), 0);
});

test('jump computes direction and step count', () => {
  assert.deepEqual(historyJump(5, 8, 2), { kind: 'undo', steps: 3 });
  assert.deepEqual(historyJump(2, 8, 7), { kind: 'redo', steps: 5 });
  assert.deepEqual(historyJump(3, 8, 3), { kind: 'none', steps: 0 });
  assert.deepEqual(historyJump(3, 8, 0), { kind: 'undo', steps: 3 });
});

test('jump clamps to the queue', () => {
  assert.deepEqual(historyJump(2, 4, 99), { kind: 'redo', steps: 2 });
  assert.deepEqual(historyJump(2, 4, -5), { kind: 'undo', steps: 2 });
});

test('labels are tidied, with a fallback for empty ones', () => {
  assert.equal(formatHistoryLabel('  nudge nodes '), 'Nudge nodes');
  assert.equal(formatHistoryLabel(''), 'Change');
  assert.equal(formatHistoryLabel(undefined), 'Change');
  assert.equal(formatHistoryLabel('Reparent'), 'Reparent');
});

test('toast text matches Cmd+Z for one step and counts several', () => {
  assert.equal(jumpToastText({ kind: 'undo', steps: 1 }, 'drag nodes'), 'Undo drag nodes');
  assert.equal(jumpToastText({ kind: 'redo', steps: 1 }, ''), 'Redo change');
  assert.equal(jumpToastText({ kind: 'undo', steps: 4 }, 'x'), 'Undo 4 steps');
  assert.equal(jumpToastText({ kind: 'none', steps: 0 }, 'x'), null);
});
