import { test } from 'node:test';
import assert from 'node:assert/strict';
import { badgeFor, tooltipSuffixFor } from '../../src/editor/src/views/Rail/railBadges';

const noAi = { active: false, label: '' };
const workingAi = { active: true, label: 'AI working' };

test('badgeFor: unseen dot alone', () => {
  const badge = badgeFor({ itemId: 'assets', presenceEntry: { unseen: 2, lastAt: 100 }, gitCount: null, ai: noAi });
  assert.deepEqual(badge, { unseen: true });
});

test('badgeFor: count alone', () => {
  const badge = badgeFor({ itemId: 'versioncontrol', presenceEntry: undefined, gitCount: 5, ai: noAi });
  assert.deepEqual(badge, { count: 5 });
});

test('badgeFor: ring alone', () => {
  const badge = badgeFor({ itemId: 'chat-panel', presenceEntry: undefined, gitCount: null, ai: workingAi });
  assert.deepEqual(badge, { ring: true });
});

test('badgeFor: chat carries BOTH a ring and an unseen dot at once', () => {
  // Not a real-world combination today (RailPresence never records a family for
  // 'chat-panel'), but badgeFor must not drop either field if it ever did — that is
  // exactly the "one badge={{...}} clobbers another" failure mode this module exists
  // to close off.
  const badge = badgeFor({ itemId: 'chat-panel', presenceEntry: { unseen: 3, lastAt: 200 }, gitCount: null, ai: workingAi });
  assert.deepEqual(badge, { unseen: true, ring: true });
});

test('badgeFor: version control carries a count and NEVER an unseen dot', () => {
  // Even with a (hypothetical, upstream-should-never-happen) presence entry attached to
  // 'versioncontrol', the badge must stay count-only: an unseen dot on top of a live
  // count would be noise.
  const badge = badgeFor({ itemId: 'versioncontrol', presenceEntry: { unseen: 7, lastAt: 300 }, gitCount: 4, ai: noAi });
  assert.deepEqual(badge, { count: 4 });
});

test('badgeFor: an item with nothing returns no badge', () => {
  const badge = badgeFor({ itemId: 'image-editor', presenceEntry: undefined, gitCount: null, ai: noAi });
  assert.deepEqual(badge, {});
});

test('badgeFor: version control with zero uncommitted files still returns count 0, not undefined', () => {
  const badge = badgeFor({ itemId: 'versioncontrol', presenceEntry: undefined, gitCount: 0, ai: noAi });
  assert.deepEqual(badge, { count: 0 });
});

test('badgeFor: version control with no git status (null) omits count entirely', () => {
  const badge = badgeFor({ itemId: 'versioncontrol', presenceEntry: undefined, gitCount: null, ai: noAi });
  assert.deepEqual(badge, { count: undefined });
});

test('tooltipSuffixFor: unseen dot alone', () => {
  const suffix = tooltipSuffixFor({ itemId: 'assets', presenceEntry: { unseen: 2, lastAt: 100 }, gitCount: null });
  assert.equal(suffix, '· 2 new since you looked');
});

test('tooltipSuffixFor: count alone (pluralised)', () => {
  assert.equal(tooltipSuffixFor({ itemId: 'versioncontrol', presenceEntry: undefined, gitCount: 5 }), '· 5 uncommitted files');
  assert.equal(tooltipSuffixFor({ itemId: 'versioncontrol', presenceEntry: undefined, gitCount: 1 }), '· 1 uncommitted file');
});

test('tooltipSuffixFor: ring alone (chat item with no presence entry) has no static suffix', () => {
  // The chat item's live "· AI working · 14s" text is produced separately (ChatRailButton
  // in Rail.tsx) so a per-second tick never re-renders the rest of the rail; this pure
  // function only ever returns a suffix for the chat item if it happens to carry a
  // presence entry, which it never does in practice.
  const suffix = tooltipSuffixFor({ itemId: 'chat-panel', presenceEntry: undefined, gitCount: null });
  assert.equal(suffix, undefined);
});

test('tooltipSuffixFor: chat carrying an unseen dot still gets the "new since you looked" text', () => {
  const suffix = tooltipSuffixFor({ itemId: 'chat-panel', presenceEntry: { unseen: 3, lastAt: 200 }, gitCount: null });
  assert.equal(suffix, '· 3 new since you looked');
});

test('tooltipSuffixFor: version control never shows the presence text, even with a stray entry', () => {
  const suffix = tooltipSuffixFor({ itemId: 'versioncontrol', presenceEntry: { unseen: 7, lastAt: 300 }, gitCount: 4 });
  assert.equal(suffix, '· 4 uncommitted files');
});

test('tooltipSuffixFor: version control with zero uncommitted files has no suffix', () => {
  assert.equal(tooltipSuffixFor({ itemId: 'versioncontrol', presenceEntry: undefined, gitCount: 0 }), undefined);
});

test('tooltipSuffixFor: an item with nothing returns no suffix', () => {
  const suffix = tooltipSuffixFor({ itemId: 'image-editor', presenceEntry: undefined, gitCount: null });
  assert.equal(suffix, undefined);
});
