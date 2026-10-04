// Slot GAME cores (src/api/slot-game-cores.js, 2026-10-04): the core slot nodes' maths, written once.
//
// The editor nodes (private xgenia-pro-nodes/src/slot-games/*.js) call these cores and the RGS compiler
// embeds them, so a game previews what the server pays. src/api/test-slot-game-parity.ts runs every
// node against its compiled script in the real XRGS sandbox; this file checks, through the editor
// runtime's real ports (parameters applied the way the editor applies them), the behaviour that changed
// on the editor side when the copies became one, and that each node is a wrapper over its core.
'use strict';

const path = require('path');
const { mount } = require('./harness');
const NodeDefinition = require('../../src/nodedefinition');
const cores = require('../../src/api/slot-game-cores');

const SLOT_GAMES = path.resolve(__dirname, '../../../../private/xgenia-pro-nodes/src/slot-games');
const define = (file) => NodeDefinition.defineNode(require(path.join(SLOT_GAMES, file)).node);

let quiet;
beforeAll(() => {
  quiet = ['log', 'info', 'warn', 'error'].map((m) => jest.spyOn(console, m).mockImplementation(() => {}));
});
afterAll(() => quiet.forEach((s) => s.mockRestore()));

const GRID = [[9, 4, 5], [3, 5, 4], [3, 4, 5], [3, 5, 4], [3, 4, 5]];

describe('editor slot nodes run the shared cores', () => {
  test('Check Jackpot: winningSymbol unset is 1, the port default (it was 0 here and 1 on the RGS)', async () => {
    const n = await mount(define('check-jackpot.js'), { reels: [[1, 2], [3, 1], [1, 4]] });
    n.fire('Do');
    expect(n.out('winningSymbol')).toBe(1);
    expect(n.out('isWin')).toBe(true);
    expect(n.out('jackpotWinningPositions')).toEqual([[0, 0], [1, 1], [0, 2]]);
    expect(n.count('Done')).toBe(1);
  });

  test('Check Wins / Calculate Winnings: the outputs are the cores\' outputs', async () => {
    const cw = await mount(define('check-wins.js'), { reels: GRID, minConsecutiveSymbols: '' });
    cw.fire('Do');
    const expected = cores.checkWins({ reels: GRID });
    expect(cw.out('winningLines')).toEqual(expected.winningLines);
    expect(cw.out('paylines')).toEqual(expected.paylines);
    const paytable = { 3: { 3: 20, 4: 60, 5: 200 }, 5: { 3: 5, 4: 10 } };
    const calc = await mount(define('calculate-winnings.js'), { winningLines: expected.winningLines, paylines: expected.paylines, paytable, betAmount: 100 });
    calc.fire('Do');
    expect(calc.out('spinWinnings')).toBe(cores.calculateWinnings({ winningLines: expected.winningLines, paylines: expected.paylines, paytable, betAmount: 100 }).spinWinnings);
    // line 1 (wild + four 3s) pays 5 x 200, line 4 (wild + three 5s) 5 x 10; lines 9 and 13 have no paytable entry
    expect(calc.out('spinWinnings')).toBe(1000 + 50);
  });

  test('Calculate Winnings unwired refuses the same way on both sides (the RGS used to throw a JSON.parse error)', () => {
    expect(() => cores.calculateWinnings({})).toThrow('Paylines must be a non-empty array');
    expect(cores.calculateReelWaysWinnings({})).toMatchObject({ spinWinnings: 0, winningLinesDetails: [] });
  });

  test('Get Paytable: a "5" override counts, and an implicit multiplication is refused like on the RGS', async () => {
    const def = define('get-paytable.js');
    const n = await mount(def, { numberOfSymbols: 3, symbolPayout2: '5' });
    n.fire('Do');
    expect(n.out('paytable')).toEqual({ 1: { 3: 9, 4: 12, 5: 15 }, 2: { 3: 15, 4: 20, 5: 25 }, 3: { 3: 13.5, 4: 18, 5: 22.5 } });
    const bad = await mount(def, { payoutFormula: '2x' });
    bad.fire('Do');
    expect(bad.out('paytable')).toBe(null);
    expect(bad.node._internal.inspectData.error).toMatch(/^Formula evaluation error: Implicit multiplication is not supported/);
    expect(() => cores.getPaytable({ payoutFormula: '2x' })).toThrow(bad.node._internal.inspectData.error);
  });

  test('Generate Symbol Weights: the formula goes through the shared evaluator (mathjs numbers)', async () => {
    const n = await mount(define('generate-symbol-weights.js'), { numberOfSymbols: 4, weightFormula: 'max(x, 2) ^ 2 % 7' });
    n.fire('Do');
    expect(n.out('normalizedBaseWeights')).toEqual(cores.generateSymbolWeights({ numberOfSymbols: 4, weightFormula: 'max(x, 2) ^ 2 % 7' }).normalizedBaseWeights);
    // weights 4, 4, 2, 2 (16 % 7, 9 % 7) -> 33.3 / 33.3 / 16.7 / 16.7
    expect(n.out('normalizedBaseWeights').map((w) => Math.round(w * 10) / 10)).toEqual([33.3, 33.3, 16.7, 16.7]);
  });

  test('Init Free Spins: firing Do again on the same strips gives the same strips (it used to thin them out)', async () => {
    const strips = [[10, 2, 10, 3, 10], [1, 10, 2, 10, 3], [10, 10, 10, 1, 2]];
    const n = await mount(define('init-free-spins.js'), { reelStrips: strips, blockedReels: '0,2' });
    n.fire('Do');
    const first = n.out('reelStrips');
    expect(first).toEqual([[1, 2, 10, 3, 10], [1, 10, 2, 10, 3], [1, 10, 10, 1, 2]]);
    n.fire('Do');
    n.fire('Do');
    expect(n.out('reelStrips')).toEqual(first);
    expect(strips[0]).toEqual([10, 2, 10, 3, 10]); // the input is never written to
  });

  test('Calculate Free Spins States: an empty blockedReels reads as "0,4", like the editor always did', () => {
    const reels = [[10, 1], [10, 1], [10, 1], [10, 1], [10, 1]];
    expect(cores.calculateFreeSpinsStates({ engineReels: reels, blockedReels: '' }).freeSpinsSymbolCount).toBe(3);
    expect(() => cores.calculateFreeSpinsStates({ engineReels: reels, blockedReels: null })).toThrow('Invalid blocked reel index: "null"');
  });

  test('Spin Calculate: the stake is clamped to 1..1,000,000 on both sides', () => {
    expect(cores.spinCalculate({ betAmount: 2000000 })).toMatchObject({ capital: -1000000, totalBets: 1000000, charged: true });
  });

  test('Weighted Reels: the Free Spin Trigger path is the core\'s free-spin path', async () => {
    const strips = [[1, 6, 2, 3, 6, 4], [1, 2, 3, 4, 5, 2], [6, 1, 2, 3, 4, 5]];
    const seeds = [7.5e11, 5e11, 0, 0, 1e12 - 1, 5e11];
    const n = await mount(define('weighted-reels.js'), { reelStrips: strips, Seeds: seeds, freeSpinSymbol: 6 });
    n.fire('freeSpinTrigger');
    const want = cores.weightedReels({ reelStrips: strips, Seeds: seeds, freeSpinSymbol: 6, freeSpin: true });
    expect(want.mode).toBe('static-free-spin');
    expect(n.out('reels')).toEqual(want.reels);
    expect(n.out('stopPosList')).toEqual(want.stopPosList);
    n.fire('Do');
    expect(n.out('reels')).toEqual(cores.weightedReels({ reelStrips: strips, Seeds: seeds }).reels);
  });

  test('every core-backed editor node requires slot-game-cores and keeps no maths library of its own', () => {
    const fs = require('fs');
    const files = ['check-jackpot', 'calculate-winnings', 'check-wins', 'get-paytable', 'generate-symbol-weights', 'reel-strips-generator',
      'calculate-free-spins-states', 'volatility-estimator', 'symbol-frequency-tracker', 'spin-result', 'spin-calculate', 'weighted-reels',
      'reel-ways-check-wins', 'init-free-spins', 'reel-ways-calculate-winnings'];
    for (const f of files) {
      const src = fs.readFileSync(path.join(SLOT_GAMES, f + '.js'), 'utf8');
      expect([f, /require\('@xgenia\/runtime\/src\/api\/slot-game-cores'\)/.test(src)]).toEqual([f, true]);
      expect([f, /require\('mathjs'\)/.test(src)]).toEqual([f, false]);
    }
  });
});
