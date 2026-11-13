import { test } from 'node:test';
import assert from 'node:assert/strict';
import { platformWarningsFor, winPortFor } from '../../src/editor/src/utils/rgs/mathsPorts';

test('the win port is found at the top level first, by name precedence and in any case', () => {
  assert.equal(winPortFor({ win: 0, totalWinnings: 0 }), 'win');
  assert.equal(winPortFor({ TotalWinnings: 0 }), 'TotalWinnings');
  assert.equal(winPortFor({ reels: [], spinWinnings: 3 }), 'spinWinnings');
});

test('a win nested one level inside an output becomes a dotted path the RGS reads on every path', () => {
  // "Feed Zeus": one output, the win inside it.
  assert.equal(winPortFor({ finalResult: { totalWinnings: 0, totalBets: 0 } }), 'finalResult.totalWinnings');
  // A top-level win always wins over a nested one.
  assert.equal(winPortFor({ win: 0, finalResult: { totalWinnings: 0 } }), 'win');
  // Not a number → not a win.
  assert.equal(winPortFor({ finalResult: { totalWinnings: 'x' } }), null);
  assert.equal(winPortFor({ grid: [[1]] }), null);
  assert.equal(winPortFor({}), null);
});

test('platform notes reach the studio in words, instead of a stripped console.warn', () => {
  const notes = platformWarningsFor(
    'Reels',
    [{ from: 'Math.random()', to: 'rgsRandom()', count: 3, reason: 'only the certified generator may decide outcomes' }],
    { verdict: 'not_responsive', reason: 'the output was identical for 8 different streams' }
  );
  assert.equal(notes.length, 2);
  assert.match(notes[0], /^Reels: XGENIA RGS replaced Math\.random\(\) with rgsRandom\(\) \(3×\) — only the certified generator/);
  assert.match(notes[1], /cannot be certified/);
  assert.deepEqual(platformWarningsFor('X', undefined, { verdict: 'responsive' }), []);
});
