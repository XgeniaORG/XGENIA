import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStakeExportManifest,
  parseStakePlaySetups,
  stakeModesWithSetups,
  lookupTableCsv,
  stakeIndexJson,
  summariseStakeModes,
  reweightSampledBooks,
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

// (2026-11-09) Oversampled runs, the editor half of XRGS SYSTEM_MAP I-138: weights from the simulation's counts.
import { RARE_BOOK_WEIGHT, lookupTableRtp, strataWeightedRows } from '../../src/editor/src/utils/stake/stakeMathsFormat';

test('oversampled: each stratum is weighted back to its simulated share, rare books count once', () => {
  // 1,000 rounds simulated: 900 "no_win" (paid 0), 98 "win_1x" (paid 1x), 2 rare (paid 50x).
  // Kept: 90 no_win, 10 win_1x, both rare.
  const rows = [
    ...Array.from({ length: 90 }, (_, i) => ({ id: i, payout: 0, stratum: 'no_win' })),
    ...Array.from({ length: 10 }, (_, i) => ({ id: 90 + i, payout: 100, stratum: 'win_1x' })),
    { id: 100, payout: 5000, stratum: null },
    { id: 101, payout: 5000, stratum: null }
  ];
  const w = strataWeightedRows(rows, [{ stratum: 'no_win', simulations: 900 }, { stratum: 'win_1x', simulations: 98 }], 10);
  assert.equal(w[0].weight, RARE_BOOK_WEIGHT * 10);
  assert.equal(w[90].weight, RARE_BOOK_WEIGHT * 9.8);
  assert.equal(w[100].weight, RARE_BOOK_WEIGHT);
  // The simulation paid (98 × 1 + 2 × 50) / 1000 = 0.198 per round.
  assert.ok(Math.abs(lookupTableRtp(w, 1) - 0.198) < 1e-9, String(lookupTableRtp(w, 1)));
  assert.ok(w.every((r) => Number.isInteger(r.weight)));
});

test('oversample 1 is the uniform table; a stratum the platform did not count is refused, not guessed', () => {
  assert.deepEqual(strataWeightedRows([{ id: 0, payout: 0, stratum: 'no_win' }], [], 1).map((r) => r.weight), [1]);
  assert.throws(() => strataWeightedRows([{ id: 0, payout: 0, stratum: 'no_win' }], [], 10), /no simulated rounds/);
});

test('an oversampled mode\'s summary shows the simulated RTP and how far the package landed from it', () => {
  const stats = { books: 113_473, evaluate_calls: 0, rtp: 1.06621, rtp_raw: 1.066, hit_rate: 0.33, feature_books: 0, feature_rounds: 0, choice_books: 0, truncated_books: 0, rounded_books: 0, capped_books: 0, max_multiplier: 51.6, elapsed_ms: 0, simulations: 1_000_000, rtp_simulated: 1.06514 };
  const line = summariseStakeModes([{ mode: { name: 'base', cost: 1, kind: 'base', optionId: null, label: 'Base' }, rows: [], stats, jsonlBytes: 0 }]);
  assert.match(line, /simulated 106\.51% over 1,000,000 rounds \(package \+0\.11 points\)/);
});

import { replayEventIds, stakeReviewChecklist } from '../../src/editor/src/utils/stake/stakeMathsFormat';

test('replay event ids: a loss, a normal win, the biggest win, a win cap and the best bonus, from the package', () => {
  const rows = [
    { id: 0, payout: 0, criteria: '0' },
    { id: 1, payout: 50, criteria: 'basegame' },
    { id: 2, payout: 300, criteria: 'basegame' },
    { id: 3, payout: 2500, criteria: 'freegame' },
    { id: 4, payout: 9000, criteria: 'freegame' },
    { id: 5, payout: 500000, criteria: 'wincap' }
  ];
  assert.deepEqual(replayEventIds(rows, 1), { loss: 0, normal_win: 2, big_win: 4, wincap: 5, bonus: 4 });
  assert.deepEqual(replayEventIds([{ id: 9, payout: 0 }], 1), { loss: 9, normal_win: null, big_win: null, wincap: null, bonus: null });
});

test('the review checklist lists every mode\'s numbers, its replay ids and the manual checks', () => {
  const stats = { books: 1, evaluate_calls: 0, rtp: 0.9631, rtp_raw: 0.963, hit_rate: 0.3, feature_books: 0, feature_rounds: 0, choice_books: 0, truncated_books: 0, rounded_books: 0, capped_books: 0, max_multiplier: 5000, elapsed_ms: 0 };
  const md = stakeReviewChecklist({
    gameName: 'Gremlin Gold',
    maxWinMultiplier: 5000,
    modes: [{ mode: { name: 'base', cost: 1, kind: 'base', optionId: null, label: 'Base' }, rows: [{ id: 0, payout: 0 }], stats, jsonlBytes: 0 }]
  });
  assert.match(md, /\| base \| 1× \| 96\.31% \| 5000× \| 30\.00% \|/);
  assert.match(md, /Win cap: — none in this package/);
  assert.match(md, /Mandatory disclaimer/);
});

import { stakeLimitsCheck } from '../../src/editor/src/utils/stake/stakeMathsFormat';

function modeOf(name: string, cost: number, kind: any, rows: any[]) {
  return { mode: { name, cost, kind, optionId: null, label: name }, rows, stats: { books: rows.length, evaluate_calls: 0, rtp: 0, rtp_raw: 0, hit_rate: 0, feature_books: 0, feature_rounds: 0, choice_books: 0, truncated_books: 0, rounded_books: 0, capped_books: 0, max_multiplier: 0, elapsed_ms: 0 }, jsonlBytes: 0 };
}
/** n books paying p (hundredths of the base bet) with weight w and criteria c. */
const many = (n: number, p: number, w = 1, c = p ? 'basegame' : '0') => Array.from({ length: n }, (_, i) => ({ id: i, payout: p, weight: w, criteria: c }));

test('limits: a base game at 96.3% with enough volatility passes; one at 99% is told which way to move', () => {
  // 963 in 10,000 books pay 10×: RTP 96.3%, std ~2.9
  const ok = stakeLimitsCheck([modeOf('base', 1, 'base', [...many(963, 1000), ...many(9037, 0)])], { maxWinMultiplier: 5000, minBooks: 10 });
  assert.equal(ok.ok, true, JSON.stringify(ok.problems));
  const hot = stakeLimitsCheck([modeOf('base', 1, 'base', [...many(990, 1000), ...many(9010, 0)])], { maxWinMultiplier: 5000, minBooks: 10 });
  const p = hot.problems.find((x) => x.code === 'RTP_OUT_OF_BAND')!;
  assert.match(p.fix, /^Lower the base mode's RTP by about 2\.65%/);
});

test('limits: a buy that does not open its feature, a mode too far from base, and no cap are all reported', () => {
  const base = modeOf('base', 1, 'base', [...many(963, 1000), ...many(9037, 0)]);
  const buy = modeOf('buy_bonus_buy', 100, 'buy', [...many(100, 9800, 1, 'basegame')]);
  const r = stakeLimitsCheck([base, buy], { maxWinMultiplier: null, minBooks: 10 });
  const codes = r.problems.map((x) => x.code);
  for (const c of ['BUY_NOT_IN_FEATURE', 'RTP_MODE_SPREAD', 'BASE_NEVER_TRIGGERS_FEATURE', 'NO_MAX_WIN_CAP']) assert.ok(codes.includes(c), c);
  assert.equal(r.ok, false);
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

// (2026-11-09) XRGS simulates N rounds per book, keeps every rare one and weights a 1-in-N sample of the rest:
// the weights reach the lookup table, and the summary says how much of the RTP each kind of round pays.
test('a weighted, oversampled mode: weights in the table, the criteria split in the summary and manifest', () => {
  assert.equal(lookupTableCsv([{ id: 0, payout: 0, weight: 10 }, { id: 1, payout: 500000, weight: 1 }]), '0,10,0\n1,1,500000\n');
  const stats = {
    books: 1200, evaluate_calls: 21000, rtp: 0.9612, rtp_raw: 0.9612, hit_rate: 0.31,
    simulations: 10000, rtp_simulated: 0.9605, hit_rate_simulated: 0.31,
    criteria: [
      { criteria: 'wincap', simulations: 1, books: 1, hit_rate: 0.0001, rtp_contribution: 0.05, rtp_share: 0.052 },
      { criteria: 'freegame', simulations: 100, books: 100, hit_rate: 0.01, rtp_contribution: 0.36, rtp_share: 0.375 },
      { criteria: '0', simulations: 6900, books: 690, hit_rate: 0.69, rtp_contribution: 0, rtp_share: 0 },
      { criteria: 'basegame', simulations: 2999, books: 409, hit_rate: 0.2999, rtp_contribution: 0.5505, rtp_share: 0.573 }
    ],
    feature_books: 100, feature_rounds: 900, choice_books: 0, truncated_books: 0, rounded_books: 0, capped_books: 1, max_multiplier: 5000, elapsed_ms: 1
  };
  const mode = { mode: { name: 'base', cost: 1, kind: 'base', optionId: null, label: 'Base game' } as any, rows: [], stats, jsonlBytes: 0 };
  const line = summariseStakeModes([mode]);
  assert.match(line, /^base: 1,200 books from 10,000 rounds, RTP 96\.12%/);
  assert.match(line, /max win 5\.2% of RTP \(1 in 10,000\), free games 37\.5% of RTP \(1 in 100\)/);
  const manifest: any = buildStakeExportManifest({
    game: null, deploymentId: 'd', functionSlug: 'f', functionName: null, scriptSha256: null, masterSeed: 'ab', bet: 100,
    maxWinMultiplier: 5000, choicePolicy: 'default', oversample: 10, declaredRtp: null, modes: [mode], skippedOptions: []
  });
  assert.equal(manifest.reproduction.oversample, 10);
  assert.match(manifest.modes[0].weights, /^true frequencies: 10 rounds simulated per book/);
  assert.match(manifest.modes[0].weights, /no weight is chosen to fit a target RTP/);
});

// (2026-11-09) MinesMaths pays 0 or 2x. A flat 1-in-10 weight left the package at 100.18% against 99.50% over
// every round played; weighting each stratum's sampled books by that stratum's true count makes it exact.
test('weights from true counts: the package pays exactly what every simulated round paid', () => {
  // 50,000 rounds: 25,124 lost, 24,876 paid 2x. The 1-in-10 sample kept 2,511 losses and 2,520 wins.
  const rows: any[] = [];
  for (let i = 0; i < 2511; i++) rows.push({ id: rows.length, payout: 0, weight: 10, criteria: '0', stratum: 'no_win' });
  for (let i = 0; i < 2520; i++) rows.push({ id: rows.length, payout: 200, weight: 10, criteria: 'basegame', stratum: 'win_2x' });
  const flat = rows.reduce((n, r) => n + r.weight * r.payout, 0) / (rows.reduce((n, r) => n + r.weight, 0) * 100);
  assert.ok(Math.abs(flat - 1.0018) < 0.0005, `the flat weights reproduce the drift: ${flat}`);
  const rw = reweightSampledBooks(rows, [{ stratum: 'no_win', simulations: 25124 }, { stratum: 'win_2x', simulations: 24876 }], 1);
  const simulated = (24876 * 200) / (50000 * 100);
  assert.ok(Math.abs(rw.rtp - simulated) < 1e-7, `package ${rw.rtp} vs simulated ${simulated}`);
  assert.ok(rw.rows.every((r) => Number.isInteger(r.weight) && r.weight! >= 1), 'weights stay whole numbers');

  // A rare book keeps one round's weight, whatever the sampled books weigh; a stratum nothing sampled is named.
  const withCap = reweightSampledBooks(
    [{ id: 0, payout: 500000, weight: 1, criteria: 'wincap', stratum: null }, { id: 1, payout: 0, weight: 10, criteria: '0', stratum: 'no_win' }],
    [{ stratum: 'no_win', simulations: 9 }, { stratum: 'win_5x', simulations: 3 }],
    1
  );
  assert.deepEqual(withCap.rows.map((r) => r.weight), [1_000_000, 9_000_000]);
  assert.deepEqual(withCap.unrepresented, ['win_5x']);
});
