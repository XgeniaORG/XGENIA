// Hold And Win Grid (slot feature 13, stateful + seeded): registry port mirror, start / respin /
// Do / reset parity with the shared core (state threaded as the server does, fresh seeds per
// call), pre-priced valueGrid, and the unseeded fail-closed contract.
// (2026-10-04, certification) Every draw takes its own Seeds value, in draw order: start one per coin
// it prices, a respin one per free cell plus one per new coin's value, and a respin needs 2 x free
// cells before it draws. The seed arrays below are 2 x rows x columns long (what a correctly sized
// ISAAC hands over); the last tests pin the rule itself.
'use strict';

const { defineFeature, mount } = require('./harness');
const cores = require('@xgenia/runtime/src/api/slot-feature-cores');

const HoldAndWin = defineFeature('hold-and-win-grid.js');

const REGISTRY_INPUTS = [
  'reels', 'coinSymbol', 'blankSymbol', 'symbolWeights', 'respins', 'resetOnNewCoin', 'coinValues', 'coinValueWeights',
  'betAmount', 'valuesAreBetMultiples', 'valueGrid', 'Seeds', 'start', 'respin', 'reset'
];
const REGISTRY_OUTPUTS = ['grid', 'valueGrid', 'lockedCells', 'lockedCount', 'newCoins', 'respinsLeft', 'isComplete', 'active', 'totalValue', 'isFull'];

// reels[col][row]; coin symbol 8 at (row 0, col 1) and (row 2, col 3)
const SPIN = [
  [1, 2, 3],
  [8, 4, 5],
  [6, 1, 2],
  [3, 4, 8],
  [5, 6, 1]
];
const PARAMS = {
  coinSymbol: 8,
  blankSymbol: 0,
  symbolWeights: [10, 8, 6, 4, 3, 2, 1, 2],
  respins: 3,
  resetOnNewCoin: true,
  coinValues: [1, 2, 5],
  coinValueWeights: [5, 3, 1],
  betAmount: 100,
  valuesAreBetMultiples: true,
  valueGrid: []
};
// one ISAAC-shaped array per call, 2 x 5 x 3 = 30 values each (editor integers)
function isaacLike(seed, n) {
  let x = seed >>> 0;
  return Array.from({ length: n }, () => {
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    return Math.floor((x / 4294967296) * 1e12);
  });
}
const SEEDS = [isaacLike(1234567, 30), isaacLike(9876543, 30), isaacLike(5555555, 30), isaacLike(2468135, 30)];

function coreArgs(reels, seeds, flags) {
  return Object.assign({ reels }, PARAMS, { seeds, start: false, respin: false, reset: false }, flags || {});
}

function expectParity(h, r) {
  for (const name of REGISTRY_OUTPUTS) expect(h.out(name)).toEqual(r[name]);
}

describe('Hold And Win Grid', () => {
  let errorSpy;
  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  test('module shape and metadata mirror the registry', () => {
    const mod = require('../../../../private/xgenia-pro-nodes/src/slot-games/features/hold-and-win-grid.js');
    expect(Object.keys(mod)).toEqual(['node']);
    expect(mod.node.name).toBe('Hold And Win Grid');
    expect(mod.node.category).toBe('Math');
    expect(mod.node.color).toBe('math');
    expect(mod.node.docs).toBe('https://docsapp.xgenia.com/nodes/slot-features/hold-and-win-grid');
    expect(typeof mod.node.description).toBe('string');
    expect(mod.node.description).toMatch(/pixi\.CellOverlay\.cells/);
    expect(mod.node.description).toMatch(/ISAAC Random Number Array Generator\.array/);
    expect(mod.node.description).toMatch(/Variable2/);
    expect(mod.node.description).toMatch(/identified players/);
    const inputs = Object.keys(HoldAndWin.metadata.inputs).filter((n) => n !== 'functionScript');
    expect(inputs.sort()).toEqual(REGISTRY_INPUTS.concat(['Do']).sort());
    expect(Object.keys(HoldAndWin.metadata.outputs).sort()).toEqual(REGISTRY_OUTPUTS.concat(['Done']).sort());
    for (const sig of ['Do', 'start', 'respin', 'reset']) expect(HoldAndWin.metadata.inputs[sig].type.name).toBe('signal');
    expect(HoldAndWin.metadata.outputs.Done.type).toBe('signal');
    expect(HoldAndWin.metadata.outputs.isComplete.type).toBe('boolean');
    expect(HoldAndWin.metadata.inputs.Seeds.type).toBe('array');
    expect(HoldAndWin.metadata.inputs.coinValues.default).toEqual([1, 2, 5]);
    expect(HoldAndWin.metadata.inputs.betAmount.default).toBe(100);
  });

  test('start, two respins, Do and reset equal the core with the same threaded state and seeds', async () => {
    const h = await mount(HoldAndWin, Object.assign({ reels: SPIN, Seeds: SEEDS[0] }, PARAMS));
    let state = {};

    h.fire('start');
    let r = cores.holdAndWin(state, coreArgs(SPIN, SEEDS[0], { start: true }));
    state = r.updatedState;
    expectParity(h, r);
    expect(h.out('lockedCells')).toEqual([[0, 1], [2, 3]]);
    expect(h.out('lockedCount')).toBe(2);
    expect(h.out('active')).toBe(true);
    expect(h.out('respinsLeft')).toBe(3);
    expect(h.out('grid')[0]).toEqual([0, 0, 0]);
    expect(h.out('totalValue')).toBeGreaterThan(0);
    expect(h.out('totalValue') % 100).toBe(0);

    // the maths owns the respin: unlocked cells are redrawn from symbolWeights with fresh seeds
    h.set('Seeds', SEEDS[1]);
    h.fire('respin');
    r = cores.holdAndWin(state, coreArgs(SPIN, SEEDS[1], { respin: true }));
    state = r.updatedState;
    expectParity(h, r);
    expect(h.out('lockedCount')).toBeGreaterThanOrEqual(2);
    expect(h.out('grid')[1][0]).toBe(8);
    expect(h.out('grid')[3][2]).toBe(8);

    h.set('Seeds', SEEDS[2]);
    h.fire('respin');
    r = cores.holdAndWin(state, coreArgs(SPIN, SEEDS[2], { respin: true }));
    state = r.updatedState;
    expectParity(h, r);

    // a plain Do re-emits the current state without changing it
    h.fire('Do');
    r = cores.holdAndWin(state, coreArgs(SPIN, SEEDS[2]));
    state = r.updatedState;
    expectParity(h, r);
    expect(h.out('newCoins')).toBe(0);

    // reset
    h.set('Seeds', SEEDS[3]);
    h.fire('reset');
    r = cores.holdAndWin(state, coreArgs(SPIN, SEEDS[3], { reset: true }));
    state = r.updatedState;
    expectParity(h, r);
    expect(h.count('Done')).toBe(5);
    expect(h.node._internal.state).toEqual(state);
  });

  test('respins run to completion exactly like the core (isComplete on the ending call)', async () => {
    const params = Object.assign({}, PARAMS, { respins: 1, resetOnNewCoin: false });
    const h = await mount(HoldAndWin, Object.assign({ reels: SPIN, Seeds: SEEDS[0] }, params));
    let state = {};
    h.fire('start');
    let r = cores.holdAndWin(state, Object.assign({ reels: SPIN }, params, { seeds: SEEDS[0], start: true, respin: false, reset: false }));
    state = r.updatedState;
    expectParity(h, r);
    h.set('Seeds', SEEDS[1]);
    h.fire('respin');
    r = cores.holdAndWin(state, Object.assign({ reels: SPIN }, params, { seeds: SEEDS[1], start: false, respin: true, reset: false }));
    expectParity(h, r);
    expect(h.out('respinsLeft')).toBe(0);
    expect(h.out('isComplete')).toBe(true);
    expect(h.out('active')).toBe(false);
  });

  test('a pre-priced valueGrid is honoured instead of a draw (core parity)', async () => {
    const valueGrid = [[0, 0, 0], [700, 0, 0], [0, 0, 0], [0, 0, 300], [0, 0, 0]];
    const params = Object.assign({}, PARAMS, { valueGrid });
    const h = await mount(HoldAndWin, Object.assign({ reels: SPIN, Seeds: SEEDS[0] }, params));
    h.fire('start');
    const r = cores.holdAndWin({}, Object.assign({ reels: SPIN }, params, { seeds: SEEDS[0], start: true, respin: false, reset: false }));
    expectParity(h, r);
    expect(h.out('valueGrid')[1][0]).toBe(700);
    expect(h.out('valueGrid')[3][2]).toBe(300);
    expect(h.out('totalValue')).toBe(1000);
  });

  test('each draw takes its own Seeds value, in draw order (start: coins; respin: cell, then a new coin\'s value)', () => {
    const args = (seeds, flags) => coreArgs(SPIN, seeds, flags);
    const q = (i, n) => ((i + 0.5) / n) * 1e12; // the middle of slice i of n
    // start: the two coins (col 1 row 0, then col 3 row 2) take Seeds[0], Seeds[1] on weights [5, 3, 1]
    const start = cores.holdAndWin({}, Object.assign(args([q(0, 9), q(8, 9)]), { symbolWeights: [], start: true }));
    expect(start.valueGrid[1][0]).toBe(100); // slice 0 of 9 -> value 1 x bet
    expect(start.valueGrid[3][2]).toBe(500); // slice 8 of 9 -> value 5 x bet
    // respin with weights [1, 1, 1, 1, 1, 1, 1, 1] -> base [1..8]; 13 free cells need 26 values.
    // Cells in column order skip the two coins; free cell 0 (col 0 row 0) draws symbol 8 (slice 7 of 8),
    // so the NEXT value prices it; every other cell draws symbol 1.
    const seeds = [q(7, 8), 9.5e11].concat(Array.from({ length: 24 }, () => q(0, 8)));
    const respin = cores.holdAndWin(start.updatedState, Object.assign(args(seeds), { symbolWeights: [1, 1, 1, 1, 1, 1, 1, 1], respin: true }));
    expect(respin.newCoins).toBe(1);
    expect(respin.grid[0][0]).toBe(8);
    expect(respin.valueGrid[0][0]).toBe(500); // its value took Seeds[1] (9.5e11: past 8/9 of [5, 3, 1] -> 5)
    expect(respin.lockedCount).toBe(3);
  });

  test('too few Seeds values fails closed before anything is drawn (start and respin)', () => {
    expect(() => cores.holdAndWin({}, coreArgs(SPIN, [1e11], { start: true }))).toThrow(
      '[Hold And Win Grid] Seeds has 1 values but 2 landed coins need a value: every random outcome takes its own Seeds value and none is reused. ' +
      'Set the ISAAC Random Number Array Generator feeding Seeds to size >= 2 x rows x columns = 30.'
    );
    const started = cores.holdAndWin({}, coreArgs(SPIN, SEEDS[0], { start: true }));
    // 13 free cells -> 26 values needed whatever lands; 25 is refused and the state is not touched
    expect(() => cores.holdAndWin(started.updatedState, coreArgs(SPIN, SEEDS[1].slice(0, 25), { respin: true }))).toThrow(
      /^\[Hold And Win Grid\] Seeds has 25 values but 26 are needed to respin 13 free cells/
    );
    expect(cores.holdAndWin(started.updatedState, coreArgs(SPIN, SEEDS[1].slice(0, 26), { respin: true })).respinsLeft).toBeGreaterThanOrEqual(2);
    // a pre-priced start needs no values at all
    const priced = [[0, 0, 0], [700, 0, 0], [0, 0, 0], [0, 0, 300], [0, 0, 0]];
    expect(cores.holdAndWin({}, Object.assign(coreArgs(SPIN, [], { start: true }), { valueGrid: priced })).totalValue).toBe(1000);
  });

  test('unseeded start fails closed: error logged + in inspect data, outputs empty, state untouched, Done fires', async () => {
    const h = await mount(HoldAndWin, Object.assign({ reels: SPIN, Seeds: [] }, PARAMS));
    h.fire('start');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatch(/^\[Hold And Win Grid\] Seeds is required/);
    expect(h.node.getInspectInfo().value.error).toMatch(/Seeds is required/);
    expect(h.out('grid')).toEqual([]);
    expect(h.out('valueGrid')).toEqual([]);
    expect(h.out('lockedCells')).toEqual([]);
    expect(h.out('lockedCount')).toBe(0);
    expect(h.out('newCoins')).toBe(0);
    expect(h.out('respinsLeft')).toBe(0);
    expect(h.out('isComplete')).toBe(false);
    expect(h.out('active')).toBe(false);
    expect(h.out('totalValue')).toBe(0);
    expect(h.out('isFull')).toBe(false);
    expect(h.node._internal.state).toEqual({});
    expect(h.count('Done')).toBe(1);

    // seeds arrive: the next start works and matches the core from a clean state
    h.set('Seeds', SEEDS[0]);
    h.fire('start');
    expectParity(h, cores.holdAndWin({}, coreArgs(SPIN, SEEDS[0], { start: true })));
    expect(h.count('Done')).toBe(2);
  });
});
