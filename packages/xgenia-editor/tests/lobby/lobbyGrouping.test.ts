import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  arrangeLobby,
  timeBucketOf,
  matchesQuery,
  looksLikeCreateIntent,
  rankMatches,
  type LobbyEntry,
  type LobbyItem
} from '../../src/editor/src/models/lobby/lobbyGrouping';

// Fixed clock: 2026-09-06 14:30 local. Buckets are calendar days in the host timezone, so the
// reference has to be built the same way rather than from a UTC epoch literal.
const NOW = new Date(2026, 8, 6, 14, 30).getTime();
const DAY = 24 * 60 * 60 * 1000;
const startOfToday = new Date(2026, 8, 6, 0, 0, 0, 0).getTime();

function entry(id: string, name: string, latestAccessed: number): LobbyEntry {
  return { id, name, latestAccessed };
}

function item(name: string, tagline?: string): LobbyItem {
  return { id: name, name, latestAccessed: NOW, meta: tagline ? { tagline } : {}, pinned: false };
}

test('buckets are calendar days, not rolling windows', () => {
  assert.equal(timeBucketOf(NOW, NOW), 'today');
  assert.equal(timeBucketOf(startOfToday, NOW), 'today');
  // One millisecond before midnight is Yesterday even though it is only 14.5 hours ago.
  assert.equal(timeBucketOf(startOfToday - 1, NOW), 'yesterday');
  assert.equal(timeBucketOf(startOfToday - DAY, NOW), 'yesterday');
  assert.equal(timeBucketOf(startOfToday - DAY - 1, NOW), 'week');
  assert.equal(timeBucketOf(startOfToday - 6 * DAY, NOW), 'week');
  assert.equal(timeBucketOf(startOfToday - 6 * DAY - 1, NOW), 'earlier');
});

test('a future timestamp reads as today rather than falling through to earlier', () => {
  assert.equal(timeBucketOf(NOW + 5 * DAY, NOW), 'today');
});

test('groups in fixed order, empty ones dropped but still counted', () => {
  const entries = [
    entry('a', 'Today game', NOW - 60_000),
    entry('b', 'Old game', startOfToday - 20 * DAY),
    entry('c', 'Also today', NOW - 120_000)
  ];

  const { groups, counts } = arrangeLobby({ entries, now: NOW });

  assert.deepEqual(groups.map((g) => g.id), ['today', 'earlier']);
  assert.equal(counts.today, 2);
  assert.equal(counts.yesterday, 0);
  assert.equal(counts.earlier, 1);
});

test('pinned wins over the time bucket and is never counted twice', () => {
  const entries = [entry('a', 'Pinned old', startOfToday - 30 * DAY), entry('b', 'Fresh', NOW)];

  const { groups, counts, flat } = arrangeLobby({ entries, pinnedIds: ['a'], now: NOW });

  assert.deepEqual(groups.map((g) => g.id), ['pinned', 'today']);
  assert.equal(counts.pinned, 1);
  assert.equal(counts.earlier, 0);
  assert.equal(flat.length, 2);
});

test('pinned stays in recency order even when sorting by name', () => {
  const entries = [entry('a', 'Zebra', NOW), entry('b', 'Apple', NOW - 60_000)];

  const { groups } = arrangeLobby({ entries, pinnedIds: ['a', 'b'], sort: 'name', now: NOW });

  assert.deepEqual(groups[0].items.map((i) => i.name), ['Zebra', 'Apple']);
});

test('sorts by name naturally and case-insensitively', () => {
  const entries = [entry('a', 'Slot 10', NOW), entry('b', 'slot 2', NOW), entry('c', 'Amazing', NOW)];

  const { flat } = arrangeLobby({ entries, sort: 'name', now: NOW });

  assert.deepEqual(flat.map((i) => i.name), ['Amazing', 'slot 2', 'Slot 10']);
});

test('sorting by messages falls back to recency on a tie', () => {
  const entries = [entry('a', 'Old quiet', NOW - 1000), entry('b', 'New quiet', NOW), entry('c', 'Chatty', NOW - 5000)];

  const { flat } = arrangeLobby({
    entries,
    metaById: { c: { messageCount: 40 } },
    sort: 'messages',
    now: NOW
  });

  assert.deepEqual(flat.map((i) => i.name), ['Chatty', 'New quiet', 'Old quiet']);
});

test('query matches every term across name and tagline', () => {
  const neon = item('NeonReels Slot', 'Cherry-and-bar classic, 20 lines');

  assert.ok(matchesQuery(neon, 'neon slot'));
  assert.ok(matchesQuery(neon, 'CHERRY'));
  assert.ok(matchesQuery(neon, ''));
  assert.ok(!matchesQuery(neon, 'neon blackjack'));
});

test('a tagline makes an unhelpfully named game findable', () => {
  // The real motivation: "Amazing thing." is a blackjack table.
  const entries = [entry('a', 'Amazing thing.', NOW), entry('b', 'NeonReels Slot', NOW)];

  const { flat, total } = arrangeLobby({
    entries,
    metaById: { a: { tagline: 'Blackjack table, single deck' } },
    query: 'blackjack',
    now: NOW
  });

  assert.deepEqual(flat.map((i) => i.name), ['Amazing thing.']);
  // `total` is the unfiltered count, so the tab can still read "Games 2".
  assert.equal(total, 2);
});

test('create intent needs a sentence, not a keystroke', () => {
  assert.ok(!looksLikeCreateIntent('n'));
  assert.ok(!looksLikeCreateIntent('neon miami'));
  assert.ok(looksLikeCreateIntent('a neon miami slot'));
  assert.ok(!looksLikeCreateIntent('   '));
});

test('search falls back to partial matches rather than claiming there are none', () => {
  const items = [
    { ...item('AmazingSlot', 'Amazing slot game about a monopoly style board'), latestAccessed: NOW },
    { ...item('MaltaSlots', 'Wde are producding slot fgor the UK Market'), latestAccessed: NOW - 1000 },
    { ...item('Amazing thing.', 'Blackjack table, single deck'), latestAccessed: NOW - 2000 }
  ];

  // Every term present: only the exact match comes back.
  assert.deepEqual(rankMatches(items, 'slot game').map((i) => i.name), ['AmazingSlot']);

  // "with" appears in nothing, so an AND would answer "no matches" while two of these clearly
  // are slot games. The fallback ranks by how many terms hit.
  assert.deepEqual(rankMatches(items, 'slot game with').map((i) => i.name), ['AmazingSlot', 'MaltaSlots']);

  // A query that matches nothing at all still matches nothing.
  assert.deepEqual(rankMatches(items, 'zzzz').map((i) => i.name), []);
});

test('an empty query returns the list unchanged, capped', () => {
  const items = [item('One'), item('Two'), item('Three')];
  assert.equal(rankMatches(items, '  ', 2).length, 2);
});
