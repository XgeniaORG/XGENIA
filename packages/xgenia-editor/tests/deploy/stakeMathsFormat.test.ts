import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStakeExportManifest,
  lookupTableCsv,
  stakeIndexJson,
  summariseStakeModes,
  verifyStakeMode
} from '../../src/editor/src/utils/stake/stakeMathsFormat';

// The files Stake's uploader checks (stake-sdk/math-sdk docs/rgs_docs/data_format.md, utils/rgs_verification.py).
// These shapes are mirrored on XGENIA RGS (_shared/stake-books.ts); a drift between the two would write a
// package the platform's own suite says is valid and Stake refuses.

test('index.json names each mode and its two files, in the enforced shape', () => {
  const index = JSON.parse(stakeIndexJson([{ name: 'base', cost: 1 }, { name: 'bonus_buy', cost: 20 }]));
  assert.deepEqual(index, {
    modes: [
      { name: 'base', cost: 1, events: 'books_base.jsonl.zst', weights: 'lookUpTable_base_0.csv' },
      { name: 'bonus_buy', cost: 20, events: 'books_bonus_buy.jsonl.zst', weights: 'lookUpTable_bonus_buy_0.csv' }
    ]
  });
});

test('the lookup table is id,weight,payout per line with weight 1 and no header', () => {
  assert.equal(lookupTableCsv([{ id: 0, payout: 0 }, { id: 1, payout: 20 }, { id: 2, payout: 140, weight: 7 }]), '0,1,0\n1,1,20\n2,7,140\n');
  assert.equal(lookupTableCsv([]), '');
});

test("verification refuses what Stake's uploader refuses, and accepts a clean package", () => {
  assert.deepEqual(verifyStakeMode('0,1,0\n1,1,20\n2,1,140\n', [0, 20, 140]), []);
  const problems = verifyStakeMode('0,1,0\n1,1,25\n2,1,5\n3,x,10\n', [0, 20, 5]);
  assert.ok(problems.some((p) => /row 1: payout 25 is not a multiple of 10/.test(p)), problems.join('\n'));
  assert.ok(problems.some((p) => /row 2: non-zero payout 5 is below the minimum/.test(p)), problems.join('\n'));
  assert.ok(problems.some((p) => /row 1: lookup payout 25 does not match the book's payoutMultiplier 20/.test(p)), problems.join('\n'));
  assert.ok(problems.some((p) => /row 3: weight 'x'/.test(p)), problems.join('\n'));
  assert.ok(problems.some((p) => /4 rows but there are 3 books/.test(p)), problems.join('\n'));
});

const stats = {
  books: 10000, evaluate_calls: 11200, rtp: 0.9612, rtp_raw: 0.9601, hit_rate: 0.312,
  feature_books: 400, feature_rounds: 1200, choice_books: 0, truncated_books: 0, rounded_books: 37, capped_books: 0,
  max_multiplier: 500, elapsed_ms: 1234
};
const mode = { name: 'base', cost: 1, kind: 'base' as const, optionId: null, label: 'Base game' };

test('the manifest carries everything a book needs to be re-derived, and names the limitations', () => {
  const m = buildStakeExportManifest({
    game: { id: 'g1', slug: 'gem-slot', name: 'Gem Slot' },
    deploymentId: 'd1', functionSlug: 'GemSlotMaths', functionName: 'Gem Slot Maths', scriptSha256: 'abc',
    masterSeed: 'ab'.repeat(32), bet: 100, maxWinMultiplier: 5000, choicePolicy: 'default', declaredRtp: '96.00',
    modes: [{ mode, rows: [], stats, jsonlBytes: 1 }], skippedOptions: ['broken: no price'], exportedAt: '2026-10-24T00:00:00Z'
  }) as any;
  assert.equal(m.reproduction.master_seed, 'ab'.repeat(32));
  assert.equal(m.reproduction.bet_minor_units, 100);
  assert.equal(m.component.script_sha256, 'abc');
  assert.equal(m.modes[0].files.events, 'books_base.jsonl.zst');
  assert.equal(m.modes[0].stats.rounded_books, 37);
  assert.deepEqual(m.skipped_options, ['broken: no price']);
  assert.ok(m.limitations.some((l: string) => /tenths of the bet/.test(l)));
  assert.ok(m.limitations.some((l: string) => /does not carry between books/.test(l)));
});

test('the summary says the RTP Stake will pay and flags the rounding, with the raw figure beside it', () => {
  const line = summariseStakeModes([{ mode, rows: [], stats, jsonlBytes: 1 }]);
  assert.match(line, /^base: 10,000 books, RTP 96\.12%, hit 31\.2%/);
  assert.match(line, /37 rounded to Stake's 0\.1× grid \(raw RTP 96\.01%\)/);
});
