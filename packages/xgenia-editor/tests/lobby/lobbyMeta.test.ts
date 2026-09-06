import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  taglineFromTitle,
  summariseChatIndex,
  TAGLINE_MAX
} from '../../src/editor/src/models/lobby/lobbyMeta.core';

test('the instruction to the AI is stripped, leaving a description', () => {
  assert.equal(taglineFromTitle('Create a crash game with a space theme'), 'Crash game with a space theme');
  assert.equal(taglineFromTitle('make me an blackjack table'), 'Blackjack table');
  assert.equal(taglineFromTitle('Please can you build a wheel of fortune'), 'Wheel of fortune');
  assert.equal(taglineFromTitle('Design a keno board'), 'Keno board');
});

test('the pronoun form of the opener is stripped too', () => {
  assert.equal(taglineFromTitle('I want a keno board with 40 numbers'), 'Keno board with 40 numbers');
  assert.equal(taglineFromTitle('I need to build a crash game'), 'Crash game');
});

test('a truncated title is cut back off its dangling tail', () => {
  // Both of these are real titles from projects on this machine. Left alone the first reads
  // "…slot game called" and the second "…and what I", which is worse than no tagline at all.
  assert.equal(
    taglineFromTitle('Build a polished 5-reel, 3-row slot game called...'),
    'Polished 5-reel, 3-row slot game…'
  );
  assert.equal(taglineFromTitle('So I want an amazing 5x3 reel game, and what I ...'), 'Amazing 5x3 reel game…');
});

test('a complete title keeps its last word and gains no ellipsis', () => {
  assert.equal(taglineFromTitle('Build a slot with sticky wilds'), 'Slot with sticky wilds');
});

test('a title that is not an instruction is left alone', () => {
  assert.equal(taglineFromTitle('Reels never stop spinning'), 'Reels never stop spinning');
});

test('nothing usable yields nothing, never a crash', () => {
  assert.equal(taglineFromTitle(undefined), undefined);
  assert.equal(taglineFromTitle(''), undefined);
  assert.equal(taglineFromTitle('   …  '), undefined);
  assert.equal(taglineFromTitle('build a'), undefined);
  assert.equal(taglineFromTitle(42 as unknown as string), undefined);
});

test('a long tagline is cut at a word boundary', () => {
  const long = taglineFromTitle(
    'Build a 5-reel 3-row slot with a neon Miami skyline, cluster pays, a free-spins bonus and sticky wilds'
  )!;

  assert.ok(long.length <= TAGLINE_MAX + 1, `got ${long.length}`);
  assert.ok(long.endsWith('…'));
  assert.ok(!long.includes(' …'), 'no dangling space before the ellipsis');
});

test('the FIRST conversation supplies the tagline and every one supplies the count', () => {
  // The first conversation says what the game is; every later one is an edit to it. Taking the
  // newest produced taglines describing yesterday's bug fix.
  const raw = [
    { title: 'Build a slot game', messageCount: 30, lastActivity: 100 },
    { title: 'Fix the reel controller', messageCount: 12, lastActivity: 500 }
  ];

  assert.deepEqual(summariseChatIndex(raw), { tagline: 'Slot game', messageCount: 42 });
});

test('both index shapes are accepted', () => {
  const entries = [{ title: 'Build a wheel', messageCount: 3, lastActivity: 1 }];

  assert.equal(summariseChatIndex(entries).tagline, 'Wheel');
  assert.equal(summariseChatIndex({ conversations: entries }).tagline, 'Wheel');
});

test('a missing, empty or malformed index is not an error', () => {
  assert.deepEqual(summariseChatIndex(null), { tagline: undefined, messageCount: 0 });
  assert.deepEqual(summariseChatIndex([]), { tagline: undefined, messageCount: 0 });
  assert.deepEqual(summariseChatIndex('nonsense'), { tagline: undefined, messageCount: 0 });
  assert.deepEqual(summariseChatIndex([null, 7, {}]), { tagline: undefined, messageCount: 0 });
});

test('a bad message count never poisons the total', () => {
  const raw = [
    { title: 'Build a slot', messageCount: Number.NaN, lastActivity: 2 },
    { title: 'Build a wheel', messageCount: -5, lastActivity: 1 },
    { title: 'Build a crash game', messageCount: 4, lastActivity: 0 }
  ];

  assert.equal(summariseChatIndex(raw).messageCount, 4);
});

test('conversations without a lastActivity still yield a tagline', () => {
  assert.equal(summariseChatIndex([{ title: 'Build a keno board' }]).tagline, 'Keno board');
});
