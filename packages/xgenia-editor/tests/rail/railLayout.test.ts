import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reduceRailLayout, activePanelId, RailLayout } from '../../src/editor/src/views/Rail/railLayout';

const state = (activeId = 'chat-panel', homeId = 'chat-panel', open = true): RailLayout => ({ activeId, homeId, open });

// click branch 1: a different id always switches to it and opens the card.
test('click on a different id shows it and opens the card', () => {
  const s = reduceRailLayout(state(), { type: 'click', id: 'components' });
  assert.deepEqual(s, { activeId: 'components', homeId: 'chat-panel', open: true });
  assert.equal(activePanelId(s), 'components');
});

test('click on a non-registered-but-different id still switches (the reducer does not validate ids)', () => {
  const s = reduceRailLayout(state(), { type: 'click', id: 'not-a-real-panel' });
  assert.deepEqual(s, { activeId: 'not-a-real-panel', homeId: 'chat-panel', open: true });
});

// click branch 2: same id, card closed, just opens it back up on the same panel.
test('click on the active id while closed just opens the card', () => {
  const s = reduceRailLayout(state('components', 'chat-panel', false), { type: 'click', id: 'components' });
  assert.deepEqual(s, { activeId: 'components', homeId: 'chat-panel', open: true });
});

// click branch 3: same id, open, and it is not home -> go home.
test('click on the open active id that is not home goes home', () => {
  const s = reduceRailLayout(state('components', 'chat-panel', true), { type: 'click', id: 'components' });
  assert.deepEqual(s, { activeId: 'chat-panel', homeId: 'chat-panel', open: true });
});

// click branch 4: same id, open, and it IS home -> collapse.
test('click on the open home id collapses the card', () => {
  const s = reduceRailLayout(state('chat-panel', 'chat-panel', true), { type: 'click', id: 'chat-panel' });
  assert.deepEqual(s, { activeId: 'chat-panel', homeId: 'chat-panel', open: false });
});

test('home from a tool panel returns to home and opens the card', () => {
  const s = reduceRailLayout(state('components', 'chat-panel', true), { type: 'home' });
  assert.deepEqual(s, { activeId: 'chat-panel', homeId: 'chat-panel', open: true });
});

test('home from home itself is a no-op returning the same reference', () => {
  const s = state('chat-panel', 'chat-panel', true);
  assert.equal(reduceRailLayout(s, { type: 'home' }), s);
});

test('home while closed reopens on the home panel', () => {
  const s = reduceRailLayout(state('components', 'chat-panel', false), { type: 'home' });
  assert.deepEqual(s, { activeId: 'chat-panel', homeId: 'chat-panel', open: true });
});

test('toggle flips open both directions', () => {
  assert.deepEqual(reduceRailLayout(state('components', 'chat-panel', true), { type: 'toggle' }), state('components', 'chat-panel', false));
  assert.deepEqual(reduceRailLayout(state('components', 'chat-panel', false), { type: 'toggle' }), state('components', 'chat-panel', true));
});

test('close when open collapses the card', () => {
  const s = reduceRailLayout(state('components', 'chat-panel', true), { type: 'close' });
  assert.deepEqual(s, state('components', 'chat-panel', false));
});

test('close when already closed is a no-op returning the same reference', () => {
  const s = state('components', 'chat-panel', false);
  assert.equal(reduceRailLayout(s, { type: 'close' }), s);
});

test('restore replaces every field', () => {
  const s = reduceRailLayout(state('components', 'chat-panel', false), {
    type: 'restore',
    homeId: 'chat-panel',
    activeId: 'assets',
    open: true
  });
  assert.deepEqual(s, { activeId: 'assets', homeId: 'chat-panel', open: true });
});

test('restore to an identical state is a no-op returning the same reference', () => {
  const s = state('assets', 'chat-panel', true);
  const result = reduceRailLayout(s, { type: 'restore', homeId: 'chat-panel', activeId: 'assets', open: true });
  assert.equal(result, s);
});

test('activePanelId agrees with activeId', () => {
  const s = state('assets', 'chat-panel', true);
  assert.equal(activePanelId(s), s.activeId);
});

test('reducer never mutates its input', () => {
  const before = state();
  const frozen = Object.freeze({ ...before });
  reduceRailLayout(frozen, { type: 'click', id: 'components' });
  assert.deepEqual(frozen, before);
});
