import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MONEY_SCALE, functionConvertsMoney, withMoneyScale } from '../../src/editor/src/utils/rgs/moneyScale';

// (2026-11-03, lobby-rgs-plinko.vercel.app) A 1.00 bet went to the RGS as 1 — one cent — and the 1.08× win came
// back as 1. The deployed script now takes cents when the page says so, runs the maths in money, and pays cents.

// What the RGS sandbox runs before a script body (_shared/script-sandbox.ts runtimePreamble), cut to what matters.
function runOnRgs(script: string, ctx: Record<string, any>): any {
  const body = 'var config = ctx.config || {};\nvar bet = ctx.bet || config.bet || 0;\n' + script;
  return new Function('ctx', '"use strict";\n' + body)(ctx);
}

// A plinko maths as the converter emits it: reads `bet` (a betAmount port) and a config port, writes outputs.
const plinko = [
  'var mult = config.Risk === 2 ? 0.2 : 1.08;',
  'var win = bet * mult;',
  'return { win: win, data: { spinWinnings: win, winAmount: win, Multiplier: mult, seenBet: config.BetAmount } };'
].join('\n');

test('a request in cents: the maths sees money, the win port is paid in whole cents, other outputs stay money', () => {
  const wrapped = withMoneyScale(plinko, 'BetAmount', 'spinWinnings');
  const out = runOnRgs(wrapped, { bet: 100, config: { BetAmount: 100, Risk: 0, __moneyScale: MONEY_SCALE } });
  assert.equal(out.data.spinWinnings, 108);
  assert.equal(out.win, 108);
  assert.equal(out.data.winAmount, 1.08);
  assert.equal(out.data.seenBet, 1);
  assert.equal(out.data.__moneyScale, MONEY_SCALE);
});

test('floating-point noise never costs a cent: 0.29 × 100 pays 29', () => {
  const wrapped = withMoneyScale('return { data: { win: bet * 0.29 } };', 'betAmount', 'win');
  const out = runOnRgs(wrapped, { bet: 100, config: { betAmount: 100, __moneyScale: 100 } });
  assert.equal(out.data.win, 29);
});

test('a request without the field (an older page, the RGS RTP test) runs the maths exactly as before', () => {
  const wrapped = withMoneyScale(plinko, 'BetAmount', 'spinWinnings');
  const before = runOnRgs(plinko, { bet: 100, config: { BetAmount: 100, Risk: 0 } });
  const after = runOnRgs(wrapped, { bet: 100, config: { BetAmount: 100, Risk: 0 } });
  assert.deepEqual(after, before);
});

test('the script does not change what it was handed (config is read-only on the RGS)', () => {
  const config = Object.freeze({ BetAmount: 250, Risk: 0, __moneyScale: 100 });
  const out = runOnRgs(withMoneyScale(plinko, 'BetAmount', 'spinWinnings'), { bet: 250, config });
  assert.equal(out.data.spinWinnings, 270);
  assert.equal(config.BetAmount, 250);
});

test('an asynchronous body still converts', async () => {
  const wrapped = withMoneyScale('var m = await Promise.resolve(2);\nreturn { data: { win: bet * m } };', 'betAmount', 'win');
  // The sandbox compiles a body that uses async/Promise as an async function; mirror it.
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const run = new AsyncFunction('ctx', 'var config = ctx.config || {};\nvar bet = ctx.bet || config.bet || 0;\n' + wrapped);
  const result = await run({ bet: 150, config: { betAmount: 150, __moneyScale: 100 } });
  assert.equal(result.data.win, 300);
});

test('Publish knows a function converts from its response example', () => {
  assert.equal(functionConvertsMoney({ spinWinnings: 0, __moneyScale: 100 }), true);
  assert.equal(functionConvertsMoney({ spinWinnings: 0 }), false);
  assert.equal(functionConvertsMoney(null), false);
});
