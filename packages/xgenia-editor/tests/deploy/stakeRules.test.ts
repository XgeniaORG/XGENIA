import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STAKE_RULES, checkStakePlan, stakeBlockedNode, stakeRulesForAgent } from '../../src/editor/src/utils/stake/stakeRules';
import { STAKE_LIMITS } from '../../src/editor/src/utils/stake/stakeMathsFormat';
import { STAKE_REVIEW_ITEMS } from '../../src/editor/src/utils/stake/stakePanel';

// One rule set: the limits check and the Stake page read the same numbers and list, not copies.
test('every layer reads the one rule set', () => {
  assert.equal(STAKE_LIMITS, STAKE_RULES.limits);
  assert.equal(STAKE_REVIEW_ITEMS, STAKE_RULES.reviewItems);
});

// Layer 1. The studio's words, as the AI passes them on.
test('plan: Stake features are allowed with their condition; refused ones come with the closest allowed option', () => {
  const r = checkStakePlan({ features: ['free spins with multipliers', 'a bonus buy', 'gamble after every win', 'progressive jackpot'] });
  assert.equal(r.ok, false);
  const by = (f: string) => r.items.find((i) => i.feature === f)!;
  assert.equal(by('free_spins').allowed, true);
  assert.match(by('free_spins').note, /same book/);
  assert.equal(by('multipliers').allowed, true);
  assert.equal(by('bonus_buy').allowed, true);
  assert.equal(by('gamble').allowed, false);
  assert.match(by('gamble').alternative!, /pick-to-reveal/);
  assert.equal(by('progressive_jackpot').allowed, false);
  assert.match(by('progressive_jackpot').alternative!, /Fixed jackpot tiers/);
  // "progressive jackpot" is not also passed as an allowed fixed jackpot.
  assert.ok(!r.items.some((i) => i.item === 'progressive jackpot' && i.feature === 'fixed_jackpots'));
});

test('plan: fixed jackpots, picks and hold-and-win are fine; a meter across bets is not, a multiplier over spins is', () => {
  const ok = checkStakePlan({ features: ['Mini, Major and Grand jackpot tiers', 'pick a chest to reveal a prize', 'hold and win respins', 'a multiplier that grows over spins in the bonus'] });
  assert.equal(ok.ok, true, JSON.stringify(ok.items));
  const bad = checkStakePlan({ features: ['a collection meter that fills across many bets'] });
  assert.equal(bad.ok, false);
  assert.equal(bad.items[0].feature, 'state_across_bets');
  assert.match(bad.items[0].alternative!, /within one bonus/);
});

test('plan: numbers outside Stake\'s limits are refused with the nearest allowed value', () => {
  const r = checkStakePlan({ rtp: 94, maxWin: 5_000_000, modes: [{ name: 'base', cost: 1 }, { name: 'Bonus Buy', cost: 100 }, { name: 'super_buy', cost: 60_000 }], bet: 'free' });
  const items = r.items.filter((i) => !i.allowed).map((i) => i.item);
  assert.ok(items.includes('payout 94.0%'), items.join(' | '));
  assert.ok(items.includes('top win 5,000,000×'));
  assert.ok(items.includes('mode super_buy at 60000×'));
  assert.ok(items.includes('mode name "Bonus Buy"'));
  assert.ok(items.includes('player types the bet amount'));
  assert.match(r.items.find((i) => i.item === 'mode name "Bonus Buy"')!.alternative!, /"bonus_buy"/);
  const good = checkStakePlan({ rtp: 96.35, maxWin: 10_000, modes: [{ name: 'base', cost: 1 }, { name: 'bonus_buy', cost: 100 }] });
  assert.equal(good.ok, true, JSON.stringify(good.items));
  assert.equal(checkStakePlan({ modes: [{ name: 'ante', cost: 1.25 }] }).ok, false); // no 1× base mode
});

test('plan: a feature the rule set does not know is reported, not guessed', () => {
  const r = checkStakePlan({ features: ['dancing dragon animation'] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.unknown, ['dancing dragon animation']);
});

// Layer 2. What the AI's tool gate refuses to place on a Stake game.
test('blocked parts: jackpot pools, XGENIA-only nodes and gamble steps; ordinary nodes pass', () => {
  assert.match(stakeBlockedNode('RGS Jackpot Pools')!.alternative, /Fixed jackpot tiers/);
  assert.match(stakeBlockedNode('RGS Leaderboard')!.why, /XGENIA's own servers/);
  assert.match(stakeBlockedNode('JavaScriptFunction', 'GambleStep')!.why, /gamble/i);
  assert.match(stakeBlockedNode('Group', 'CashOutButton')!.alternative, /mode/);
  assert.equal(stakeBlockedNode('Jackpot Tiers'), null);
  assert.equal(stakeBlockedNode('Pick Bonus', 'ChestPick'), null);
  assert.equal(stakeBlockedNode('Cloud Function'), null); // generic: flagged by readiness, not refused outright
});

test('the agent gets the same rules, serialisable', () => {
  const a = JSON.parse(JSON.stringify(stakeRulesForAgent()));
  assert.equal(a.version, STAKE_RULES.version);
  assert.ok(a.blockedNodeTypes.includes('RGS Jackpot Pools'));
  assert.ok(new RegExp(a.blockedLabelPattern, 'i').test('Double Up'));
  assert.equal(a.features.find((f: any) => f.id === 'gamble').allowed, false);
});
