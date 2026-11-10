import { test } from 'node:test';
import assert from 'node:assert/strict';

import { diagnoseStakeExportError } from '../../src/editor/src/utils/stake/stakeExportDiagnosis';

// The messages below are what authors actually got (2026-10-29 … 2026-11-03), verbatim where they were
// seen. Each must come back as a plain explanation, steps, and — when the fix is in the maths — a prompt
// the XGENIA AI can act on without the author knowing how the RGS plays a component.

const ctx = { gameName: 'mines-game', componentName: 'MinesMaths', winOutputPort: 'spinWinnings', betInputPort: 'betAmount' };

test('a component that answers nothing: explained, the trigger named, and a prompt that carries the error', () => {
  const raw =
    'MinesMaths: book 0 (base): the component answered {"isBet":true,"betAmount":10} with no outputs at all, so its maths did not run. ' +
    'If its engine is a Javascript2 (Script.Outputs) node, recompile and redeploy with an editor whose compiler runs that node\'s code ' +
    '(older ones compiled it to an empty function); otherwise check what the spin request triggers.';
  const d = diagnoseStakeExportError(new Error(raw), ctx);
  assert.equal(d.code, 'no_outputs');
  assert.match(d.whatHappened, /"Bet" is not wired from Component Inputs/);
  assert.ok(d.fix.some((s) => /redeploy/i.test(s)));
  assert.ok(d.fixableByAi);
  assert.ok(d.aiPrompt.includes(raw), 'the AI gets the error verbatim');
  assert.match(d.aiPrompt, /"MinesMaths" \(game "mines-game"\)/);
  assert.match(d.aiPrompt, /Script\.Signals\.Bet/);
  assert.match(d.aiPrompt, /win output port is "spinWinnings" and its stake arrives on "betAmount"/);
  assert.match(d.aiPrompt, /whole minor units/);
});

test('a mode that never pays points at the win port unit and at multi-request rounds', () => {
  const d = diagnoseStakeExportError(
    'KenoMaths: Every one of the 10000 books in mode "base" pays 0, so there is no payout distribution to publish — Stake Engine refuses such a lookup table (ERR_MATH_OUTSIDE_RANGE).',
    { ...ctx, componentName: 'KenoMaths' }
  );
  assert.equal(d.code, 'never_pays');
  assert.match(d.whatHappened, /All 10,000 rounds/);
  assert.match(d.whatHappened, /bet units \(1\.5\) instead of the win in minor units \(150\)/);
  assert.ok(d.fix.some((s) => /Play setup/.test(s)));
  assert.match(d.aiPrompt, /"spinWinnings" is the round's total win as a whole number of minor units/);
});

test('rounds that do not replay: the clock is named as the usual cause', () => {
  const d = diagnoseStakeExportError(
    'Mode base: book 3 paid differently when played again from the same seed, so no book in this package could be re-derived for a dispute or a test lab.',
    ctx
  );
  assert.equal(d.code, 'not_reproducible');
  assert.match(d.aiPrompt, /Date\.now\(\)/);
  assert.match(d.aiPrompt, /derived only from the RNG value/);
});

test('blocked code and a crash name what to change; setup and connection problems are not sent to the AI', () => {
  const blocked = diagnoseStakeExportError(
    'GemSlotMaths: uses Math.random() on line 412, which the RGS sandbox blocks — randomness must come from ctx.rng so the round can be re-derived from its seed. The live endpoint refuses this script too.'
  );
  assert.equal(blocked.code, 'blocked_code');
  assert.equal(blocked.title, 'The maths uses Math.random()');
  assert.match(blocked.whatHappened, /line 412/);

  const threw = diagnoseStakeExportError('MinesMaths: book 12 (base, call 1) threw: [MinesEngine] s.mineTiles is undefined', ctx);
  assert.equal(threw.code, 'maths_threw');
  assert.match(threw.whatHappened, /round 12 of mode "base": \[MinesEngine\] s\.mineTiles is undefined/);

  for (const [raw, code] of [
    ["MinesMaths: round_request.trigger 'Nope' is not one this component fires on (Bet, AutoBet)", 'bad_play_setup'],
    ['Play setups are not valid JSON: Unexpected end of JSON input', 'bad_play_setup'],
    ['Unauthorized', 'not_connected'],
    ['XGENIA RGS backend is out of date — it cannot export Stake books yet.', 'rgs_out_of_date']
  ] as const) {
    const d = diagnoseStakeExportError(raw, ctx);
    assert.equal(d.code, code, raw);
    assert.equal(d.fixableByAi, false, `${code} is not a maths change`);
    assert.equal(d.aiPrompt, '');
  }

  const ambiguous = diagnoseStakeExportError(
    'X: This component fires on Spin, Play, Reset; the export needs to know which one is the paid round. Name a single spin input in the maths.'
  );
  assert.equal(ambiguous.code, 'ambiguous_round');
  assert.ok(ambiguous.fix.some((s) => /Spin, Play, Reset/.test(s)), 'the fix lists the triggers to choose from');
});

test('an error nothing recognises still reaches the AI, verbatim', () => {
  const d = diagnoseStakeExportError(new Error('Something new went wrong'), ctx);
  assert.equal(d.code, 'unknown');
  assert.ok(d.fixableByAi);
  assert.ok(d.aiPrompt.includes('Something new went wrong'));
});

// (2026-11-03) The export now plays the game to find its paid round before refusing. Its refusal leads
// with what the game's own request did, then what else it tried; each mode is searched on its own.
test('a refusal after the automatic search explains the game\'s own request, and stops suggesting a Play setup', () => {
  const raw =
    'Mode base: MinesMaths: Every one of the 400 books played as Bet pays 0 at "spinWinnings". The export also played 1074 other ' +
    'requests across Bet, AutoBet, Reveal, CashOut; none is a whole paid round. The closest, after Restore, AutoBet {"mines":3}: ' +
    'Mode base: book 7 paid differently when played again from the same seed (played as after Restore, AutoBet {"mines":3}, with the clock moved): the maths reads the time, e.g. Date.now().';
  const d = diagnoseStakeExportError(raw, ctx);
  assert.equal(d.code, 'never_pays', 'the game\'s own request is the one explained');
  assert.match(d.whatHappened, /rounds played as Bet paid nothing/);
  assert.match(d.whatHappened, /played 1,074 other requests in mode "base" — every trigger \(Bet, AutoBet, Reveal, CashOut\)/);
  assert.ok(!d.fix.some((s) => /Play setup/.test(s)), 'the export already searched for one');
  assert.match(d.aiPrompt, /What the export tried besides: .*Date\.now\(\)/, 'the AI sees the closest try too');
});

test('the search\'s own failure kinds: an error output, and the same round every book', () => {
  const err = diagnoseStakeExportError('MinesMaths: the component answered Bet with the error output Error: "invalid_input"', ctx);
  assert.equal(err.code, 'error_output');
  assert.match(err.whatHappened, /Played as Bet, every round came back with the error output Error: "invalid_input"/);
  assert.ok(err.fixableByAi);

  const same = diagnoseStakeExportError('Mode free_spins: MinesMaths: played as AutoBet {"mines":3}, all 150 books are the same round: the outcome does not follow the book\'s RNG (ctx.rng / rgsRandom)', ctx);
  assert.equal(same.code, 'same_every_book');
  assert.match(same.whatHappened, /^Mode "free_spins": Every one of 150 rounds/);
  assert.match(same.aiPrompt, /round's RNG/);
});

test('an out-of-date compile says redeploy, and sends nothing to the AI: the maths is fine', () => {
  const d = diagnoseStakeExportError(
    'MinesMaths: this component was compiled by an editor from before 2026-11-03: its signals Bet, Reveal, AutoBet reach its engine as plain values, so the engine never sees one fire and no round can play — not on Stake and not on /rgs-fn. Nothing in the maths needs to change: redeploy this Math Component from an editor built on or after 2026-11-03, then export again.',
    ctx
  );
  assert.equal(d.code, 'stale_compile');
  assert.equal(d.title, 'Redeploy this component');
  assert.match(d.whatHappened, /signal inputs \(Bet, Reveal, AutoBet\)/);
  assert.ok(d.fix.some((s) => /rebuilds and redeploys it by itself/.test(s)), 'it says the export fixes this itself, from the right project');
  assert.equal(d.fixableByAi, false);
  assert.equal(d.aiPrompt, '');
});

// (2026-11-05) The search runs in the RGS maths sandbox and words what each candidate did as "played as X, …".
test('the sandbox search\'s wording: no outputs, a crash, and a refusal after the search', () => {
  const none = diagnoseStakeExportError('MinesMaths: Played as Bet, the game\'s own request, the component answered with no outputs at all.', ctx);
  assert.equal(none.code, 'no_outputs');
  assert.match(none.whatHappened, /the signal "Bet"/, 'the trigger is named from "played as"');

  const threw = diagnoseStakeExportError('MinesMaths: Played as AutoBet {"mines":3}, the maths threw: TypeError: x is undefined', ctx);
  assert.equal(threw.code, 'maths_threw');
  assert.match(threw.whatHappened, /crashed when played as AutoBet \{"mines":3\}: TypeError: x is undefined/);

  const refused = diagnoseStakeExportError(
    "MinesMaths: Every one of the 400 books played as Spin, the game's own request pays 0. The export also played 212 other requests across Spin, Bonus; none is a whole paid round. The closest, Bonus: every one of the 40 books played as Bonus pays 0.",
    ctx
  );
  assert.equal(refused.code, 'never_pays');
  assert.match(refused.whatHappened, /played 212 other requests/);
  assert.ok(!refused.fix.some((f) => /Play setup/.test(f)), 'no "add a Play setup" once the export searched itself');
  assert.match(refused.aiPrompt, /What the export tried besides: The export also played 212/);
});
