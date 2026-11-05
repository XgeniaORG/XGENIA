import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStakeExportManifest,
  parseStakePlaySetups,
  stakeModesWithSetups,
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

// (2026-11-03) A Mines `Bet` only opens a board; the round is AutoBet with fixed inputs, and a
// provably-fair seed minted per book. Play setups name that request; XGENIA RGS validates and plays it.
test('play setups: blank is none, a list is parsed, a malformed one is refused with the reason', () => {
  assert.deepEqual(parseStakePlaySetups('   '), { setups: [], error: null });
  const ok = parseStakePlaySetups(
    '[{"name":"base","trigger":"AutoBet","inputs":{"mines":3,"autoTiles":[0,1,2,3,4]},"before":[{"trigger":"Restore"}]},' +
      '{"name":"mines10_reveal3","trigger":" AutoBet ","inputs":{"mines":10,"autoTiles":[6,7,8]}}]'
  );
  assert.equal(ok.error, null);
  assert.deepEqual(ok.setups[0], { name: 'base', trigger: 'AutoBet', inputs: { mines: 3, autoTiles: [0, 1, 2, 3, 4] }, before: [{ trigger: 'Restore' }] });
  assert.equal(ok.setups[1].trigger, 'AutoBet', 'the trigger is trimmed');
  assert.equal(parseStakePlaySetups('{"name":"base","trigger":"AutoBet"}').setups.length, 1, 'a single object is one setup');
  for (const [text, pattern] of [
    ['[{', /not valid JSON/],
    ['[{"name":"Base Game","trigger":"AutoBet"}]', /needs a "name" of 1-40 characters/],
    ['[{"name":"base"}]', /needs a "trigger"/],
    ['[{"name":"base","trigger":"AutoBet","inputs":[1]}]', /inputs must be an object/],
    ['[{"name":"base","trigger":"AutoBet","before":{"trigger":"Restore"}}]', /before must be a list/],
    ['[{"name":"base","trigger":"AutoBet","before":[{}]}]', /before\[0\] needs a "trigger"/],
    ['[{"name":"base","trigger":"A"},{"name":"base","trigger":"B"}]', /Two play setups are named "base"/]
  ] as const) {
    const r = parseStakePlaySetups(text);
    assert.ok(r.error && pattern.test(r.error), `${text} → ${r.error}`);
    assert.deepEqual(r.setups, [], 'nothing half-parsed is exported');
  }
});

test('play setups replace the guessed base round as 1x modes, keep priced options, and reach the manifest', () => {
  const declared = [
    { name: 'base', cost: 1, kind: 'base' as const, optionId: null, label: 'Base game' },
    { name: 'bonus_buy', cost: 20, kind: 'buy' as const, optionId: 'Bonus Buy', label: 'Buy' }
  ];
  assert.equal(stakeModesWithSetups(declared, []), declared, 'no setups: the declared modes, untouched');
  const setups = parseStakePlaySetups('[{"name":"base","trigger":"AutoBet","inputs":{"mines":3},"before":[{"trigger":"Restore"}]}]').setups;
  const modes = stakeModesWithSetups(declared, setups);
  assert.deepEqual(modes.map((m) => [m.name, m.cost, m.kind]), [['base', 1, 'base'], ['bonus_buy', 20, 'buy']]);
  assert.deepEqual(modes[0].roundRequest, { trigger: 'AutoBet', inputs: { mines: 3 }, before: [{ trigger: 'Restore' }] });
  assert.equal(modes[1].roundRequest, undefined, 'a priced option keeps playing its own request');
  const m = buildStakeExportManifest({
    game: null, deploymentId: 'd', functionSlug: 'MinesMaths', functionName: null, scriptSha256: null,
    masterSeed: 'ab'.repeat(32), bet: 100, maxWinMultiplier: null, choicePolicy: 'default', declaredRtp: null,
    modes: modes.map((mode) => ({ mode, rows: [], stats, jsonlBytes: 1 })), skippedOptions: []
  }) as any;
  assert.deepEqual(m.modes[0].round_request, { trigger: 'AutoBet', inputs: { mines: 3 }, before: [{ trigger: 'Restore' }] });
  assert.equal(m.modes[1].round_request, null);
});
