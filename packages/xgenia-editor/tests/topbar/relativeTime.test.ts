import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatAgo } from '../../src/editor/src/views/EditorTopbar/topbar/relativeTime';

const S = 1000, M = 60 * S, H = 60 * M, D = 24 * H;
test('under a minute', () => { assert.equal(formatAgo(0), 'now'); assert.equal(formatAgo(59 * S), 'now'); });
test('minutes', () => { assert.equal(formatAgo(M), '1m'); assert.equal(formatAgo(59 * M), '59m'); });
test('hours', () => { assert.equal(formatAgo(H), '1h'); assert.equal(formatAgo(23 * H), '23h'); });
test('days', () => { assert.equal(formatAgo(D), '1d'); assert.equal(formatAgo(6 * D), '6d'); });
test('weeks and beyond', () => { assert.equal(formatAgo(7 * D), '1w'); assert.equal(formatAgo(60 * D), '8w'); assert.equal(formatAgo(370 * D), '1y'); });
test('negative clamps to now', () => { assert.equal(formatAgo(-5000), 'now'); });

// --- regression tests added after the adversarial review ---
import { isAbsoluteAge, formatAgePhrase } from '../../src/editor/src/views/EditorTopbar/topbar/relativeTime';

test('composes with " ago" for every duration output', () => {
  // The old 'yesterday' return produced "Published yesterday ago" for a full day.
  for (const d of [0, 30 * S, M, 90 * M, H, 25 * H, 30 * H, 47 * H, 2 * D, 6 * D, 10 * D, 400 * D]) {
    const f = formatAgo(d);
    if (!isAbsoluteAge(f)) assert.match(f, /^(\d+[mhdwy]|99y\+)$/, `not composable: ${f}`);
  }
});
test('24-47h reads as hours, not a word', () => {
  assert.equal(formatAgo(24 * H), '1d');
  assert.equal(formatAgo(30 * H), '1d');
});
test('non-finite input never leaks into the UI', () => {
  for (const bad of [NaN, Infinity, -Infinity]) assert.equal(formatAgo(bad), 'now');
});
test('huge finite values stay in plain notation, never exponential', () => {
  assert.equal(formatAgo(1e30), '99y+');
  assert.equal(formatAgo(400 * D), '1y');
  for (const d of [1e15, 1e20, 1e30, Number.MAX_SAFE_INTEGER]) {
    assert.doesNotMatch(formatAgo(d), /e\+/, `exponential leaked: ${formatAgo(d)}`);
  }
});
test('formatAgePhrase composes correctly', () => {
  assert.equal(formatAgePhrase(0), 'just now');
  assert.equal(formatAgePhrase(5 * M), '5m ago');
  assert.equal(formatAgePhrase(30 * H), '1d ago');
  assert.equal(formatAgePhrase(NaN), 'just now');
});
