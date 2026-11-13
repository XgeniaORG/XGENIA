import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpolateDial, rankVariations } from '../../src/editor/src/utils/stake/stakeVariationsFormat';

const pair = (variation: number, mode: string, rtp: number) => ({ variation, label: `v${variation}`, mode, stats: { rtp, hit_rate: 0.3, books: 100000, max_multiplier: 500, feature_books: mode === 'base' ? 500 : 100000 } });

test('the best setting is the one with every mode in Stake\'s band, closest to the target', () => {
  const variations = [{ label: 'x1.8', inputs: { mult: 1.8 } }, { label: 'x2.0', inputs: { mult: 2 } }, { label: 'x2.2', inputs: { mult: 2.2 } }];
  const pairs = [pair(0, 'base', 0.951), pair(0, 'buy_bonus_buy', 0.948), pair(1, 'base', 0.9641), pair(1, 'buy_bonus_buy', 0.9629), pair(2, 'base', 0.978), pair(2, 'buy_bonus_buy', 0.981)];
  const r = rankVariations(variations, pairs, { base: 1, buy_bonus_buy: 100 });
  assert.equal(r.best?.label, 'x2.0');
  assert.equal(r.best?.inBand, true);
  assert.equal(r.ranked[0].inBand, false);
  assert.match(r.ranked[0].problems.join(' '), /base RTP 95\.10% is outside/);
});

test('a mode too far from base is not in band even when both sit inside 96.0–96.7%', () => {
  const r = rankVariations([{ label: 'a', inputs: {} }], [pair(0, 'base', 0.9601), pair(0, 'buy_bonus_buy', 0.9669)], { base: 1, buy_bonus_buy: 100 });
  assert.equal(r.best?.inBand, false);
  assert.match(r.best!.problems.join(' '), /from base/);
});

test('interpolating a dial finds the value that should land on the target, or says none straddles it', () => {
  const v = interpolateDial([{ value: 1.8, rtp: 0.951 }, { value: 2.2, rtp: 0.978 }]);
  assert.ok(v !== null && Math.abs(v - (1.8 + (0.9635 - 0.951) * 0.4 / 0.027)) < 1e-9);
  assert.equal(interpolateDial([{ value: 1, rtp: 0.5 }, { value: 2, rtp: 0.6 }]), null);
});
