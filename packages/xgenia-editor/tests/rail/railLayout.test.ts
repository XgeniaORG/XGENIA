import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reduceRailLayout, activePanelId, RailLayout } from '../../src/editor/src/views/Rail/railLayout';

const docked = (id = 'chat-panel', open = true): RailLayout => ({ dockedId: id, peekId: null, open });

test('click on another id opens it as a peek', () => {
  const s = reduceRailLayout(docked(), { type: 'click', id: 'components' });
  assert.deepEqual(s, { dockedId: 'chat-panel', peekId: 'components', open: true });
  assert.equal(activePanelId(s), 'components');
});

test('click on the peeked id closes the peek', () => {
  const s = reduceRailLayout({ dockedId: 'chat-panel', peekId: 'components', open: true }, { type: 'click', id: 'components' });
  assert.deepEqual(s, docked());
});

test('click on the docked id toggles the card when nothing is peeking', () => {
  assert.equal(reduceRailLayout(docked(), { type: 'click', id: 'chat-panel' }).open, false);
  assert.equal(reduceRailLayout(docked('chat-panel', false), { type: 'click', id: 'chat-panel' }).open, true);
});

test('click on the docked id while peeking closes the peek and keeps the card open', () => {
  const s = reduceRailLayout({ dockedId: 'chat-panel', peekId: 'search', open: true }, { type: 'click', id: 'chat-panel' });
  assert.deepEqual(s, docked());
});

test('click while the card is closed opens it with a peek', () => {
  const s = reduceRailLayout(docked('chat-panel', false), { type: 'click', id: 'assets' });
  assert.deepEqual(s, { dockedId: 'chat-panel', peekId: 'assets', open: true });
});

test('pin docks the peek', () => {
  const s = reduceRailLayout({ dockedId: 'chat-panel', peekId: 'components', open: true }, { type: 'pin' });
  assert.deepEqual(s, docked('components'));
});

test('pin with no peek is a no-op', () => {
  assert.deepEqual(reduceRailLayout(docked(), { type: 'pin' }), docked());
});

test('close closes the peek first, then the card', () => {
  const peeking: RailLayout = { dockedId: 'chat-panel', peekId: 'components', open: true };
  const s1 = reduceRailLayout(peeking, { type: 'close' });
  assert.deepEqual(s1, docked());
  const s2 = reduceRailLayout(s1, { type: 'close' });
  assert.deepEqual(s2, docked('chat-panel', false));
});

test('esc only closes a peek', () => {
  assert.deepEqual(reduceRailLayout({ dockedId: 'chat-panel', peekId: 'x', open: true }, { type: 'esc' }), docked());
  assert.deepEqual(reduceRailLayout(docked(), { type: 'esc' }), docked());
});

test('toggle flips open and drops any peek', () => {
  assert.deepEqual(reduceRailLayout({ dockedId: 'chat-panel', peekId: 'x', open: true }, { type: 'toggle' }), docked('chat-panel', false));
  assert.deepEqual(reduceRailLayout(docked('chat-panel', false), { type: 'toggle' }), docked());
});

test('peek opens the card and sets the peek even for the docked id', () => {
  const s = reduceRailLayout(docked('chat-panel', false), { type: 'peek', id: 'chat-panel' });
  assert.deepEqual(s, { dockedId: 'chat-panel', peekId: 'chat-panel', open: true });
});

test('dock replaces the docked id, opens, and drops the peek', () => {
  const s = reduceRailLayout({ dockedId: 'a', peekId: 'b', open: false }, { type: 'dock', id: 'c' });
  assert.deepEqual(s, docked('c'));
});

test('reducer never mutates its input', () => {
  const before = docked();
  const frozen = Object.freeze({ ...before });
  reduceRailLayout(frozen, { type: 'click', id: 'components' });
  assert.deepEqual(frozen, before);
});
