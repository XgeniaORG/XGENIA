// Pick Bonus (slot feature 18, stateful + seeded): registry port mirror, start / pick / Do /
// reset parity with the shared core (state threaded as the server does), the picks cap, the
// same-frame pickIndex + pick contract, and the unseeded fail-closed contract.
// (2026-10-04, certification) The shuffle is Fisher-Yates where every swap takes its own Seeds value
// (a pool of n tiles needs n - 1); fewer fail closed. SEEDS is sized for the 5-tile pool below.
'use strict';

const { defineFeature, mount } = require('./harness');
const cores = require('@xgenia/runtime/src/api/slot-feature-cores');

const PickBonus = defineFeature('pick-bonus.js');

const REGISTRY_INPUTS = ['prizes', 'endMarkers', 'endValue', 'picks', 'pickIndex', 'Seeds', 'start', 'pick', 'reset'];
const REGISTRY_OUTPUTS = ['revealed', 'total', 'remaining', 'ended', 'active', 'lastPrize', 'lastIsEnd', 'revealedNow', 'poolSize', 'picksMade', 'hiddenCount'];

const PARAMS = { prizes: [10, 20, 50, 100], endMarkers: 1, endValue: 'END', picks: 0 };
const SEEDS = [555555555555, 723456789012, 987654321098, 31415926535]; // shuffles to [20, 10, 100, END, 50]

function coreArgs(pickIndex, flags, seeds, params) {
  return Object.assign({}, params || PARAMS, { pickIndex, seeds: seeds || SEEDS, start: false, pick: false, reset: false }, flags || {});
}

function expectParity(h, r) {
  for (const name of REGISTRY_OUTPUTS) expect(h.out(name)).toEqual(r[name]);
}

describe('Pick Bonus', () => {
  let errorSpy;
  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  test('module shape and metadata mirror the registry', () => {
    const mod = require('../../../../private/xgenia-pro-nodes/src/slot-games/features/pick-bonus.js');
    expect(Object.keys(mod)).toEqual(['node']);
    expect(mod.node.name).toBe('Pick Bonus');
    expect(mod.node.category).toBe('Math');
    expect(mod.node.color).toBe('math');
    expect(mod.node.docs).toBe('https://docsapp.xgenia.com/nodes/slot-features/pick-bonus');
    expect(typeof mod.node.description).toBe('string');
    expect(mod.node.description).toMatch(/ISAAC Random Number Array Generator\.array/);
    expect(mod.node.description).toMatch(/identified players/);
    const inputs = Object.keys(PickBonus.metadata.inputs).filter((n) => n !== 'functionScript');
    expect(inputs.sort()).toEqual(REGISTRY_INPUTS.concat(['Do']).sort());
    expect(Object.keys(PickBonus.metadata.outputs).sort()).toEqual(REGISTRY_OUTPUTS.concat(['Done']).sort());
    for (const sig of ['Do', 'start', 'pick', 'reset']) expect(PickBonus.metadata.inputs[sig].type.name).toBe('signal');
    expect(PickBonus.metadata.inputs.endValue.default).toBe('END');
    expect(PickBonus.metadata.inputs.pickIndex.default).toBe(-1);
    expect(PickBonus.metadata.outputs.Done.type).toBe('signal');
    expect(PickBonus.metadata.outputs.ended.type).toBe('boolean');
    expect(PickBonus.metadata.outputs.lastPrize.type).toBe('*');
  });

  test('start, picks, a repeated pick, Do and reset equal the core with the same threaded state', async () => {
    const h = await mount(PickBonus, Object.assign({ Seeds: SEEDS }, PARAMS));
    let state = {};

    h.fire('start');
    let r = cores.pickBonus(state, coreArgs(-1, { start: true }));
    state = r.updatedState;
    expectParity(h, r);
    expect(h.out('poolSize')).toBe(5);
    expect(h.out('hiddenCount')).toBe(5);
    expect(h.out('active')).toBe(true);
    expect(h.out('remaining')).toBe(-1);
    expect(state.pool.slice().sort()).toEqual([10, 20, 50, 100, 'END'].sort());

    h.set('pickIndex', 2);
    h.fire('pick');
    r = cores.pickBonus(state, coreArgs(2, { pick: true }));
    state = r.updatedState;
    expectParity(h, r);
    expect(h.out('revealedNow')).toBe(true);
    expect(h.out('picksMade')).toBe(1);
    expect(h.out('revealed')).toEqual([{ index: 2, prize: state.pool[2] }]);
    expect(h.out('lastPrize')).toBe(state.pool[2]);

    // the same tile again is ignored
    h.fire('pick');
    r = cores.pickBonus(state, coreArgs(2, { pick: true }));
    state = r.updatedState;
    expectParity(h, r);
    expect(h.out('revealedNow')).toBe(false);
    expect(h.out('picksMade')).toBe(1);

    // pick a tile that is not the end marker, so the bonus continues
    const safeIdx = state.pool.findIndex((p, i) => i !== 2 && p !== 'END');
    h.set('pickIndex', safeIdx);
    h.fire('pick');
    r = cores.pickBonus(state, coreArgs(safeIdx, { pick: true }));
    state = r.updatedState;
    expectParity(h, r);
    expect(h.out('picksMade')).toBe(2);
    expect(h.out('total')).toBe(r.total);

    // Do re-emits without picking
    h.fire('Do');
    r = cores.pickBonus(state, coreArgs(safeIdx));
    state = r.updatedState;
    expectParity(h, r);
    expect(h.out('revealedNow')).toBe(false);
    expect(h.out('lastPrize')).toBeNull();

    // the end marker ends the bonus
    const endIdx = state.pool.indexOf('END');
    h.set('pickIndex', endIdx);
    h.fire('pick');
    r = cores.pickBonus(state, coreArgs(endIdx, { pick: true }));
    state = r.updatedState;
    expectParity(h, r);
    expect(h.out('lastIsEnd')).toBe(true);
    expect(h.out('ended')).toBe(true);
    expect(h.out('active')).toBe(false);

    h.fire('reset');
    r = cores.pickBonus(state, coreArgs(endIdx, { reset: true }));
    state = r.updatedState;
    expectParity(h, r);
    expect(h.out('revealed')).toEqual([]);
    expect(h.out('poolSize')).toBe(0);
    expect(h.count('Done')).toBe(7);
    expect(h.node._internal.state).toEqual(state);
  });

  test('picks cap ends the bonus, and pickIndex + pick in the same frame resolve together (core parity)', async () => {
    const params = Object.assign({}, PARAMS, { picks: 1, endMarkers: 0 });
    const h = await mount(PickBonus, Object.assign({ Seeds: SEEDS }, params));
    let state = {};
    h.fire('start');
    let r = cores.pickBonus(state, coreArgs(-1, { start: true }, SEEDS, params));
    state = r.updatedState;
    expectParity(h, r);
    expect(h.out('remaining')).toBe(1);

    h.node.queueInput('pickIndex', 3);
    h.node.queueInput('pick', true);
    h.node.queueInput('pick', false);
    h.ctx.update();
    r = cores.pickBonus(state, coreArgs(3, { pick: true }, SEEDS, params));
    expectParity(h, r);
    expect(h.out('revealedNow')).toBe(true);
    expect(h.out('remaining')).toBe(0);
    expect(h.out('ended')).toBe(true);
    expect(h.out('total')).toBe(state.pool[3]);
  });

  test('every swap of the shuffle takes its own Seeds value: swap k puts tile floor(Seeds[k] * (n - k) / 1e12) at n - 1 - k', () => {
    const q = (i, n) => ((i + 0.5) / n) * 1e12; // the middle of slice i of n
    const params = { prizes: [10, 20, 30, 40], endMarkers: 1, endValue: 'END', picks: 0 };
    // pool [10, 20, 30, 40, END]; swap 0 moves tile 0 to the end, swap 1 keeps 3, swap 2 moves 1 to 2, swap 3 keeps 1
    const r = cores.pickBonus({}, coreArgs(-1, { start: true }, [q(0, 5), q(3, 4), q(1, 3), q(1, 2)], params));
    expect(r.updatedState.pool).toEqual(['END', 30, 20, 40, 10]);
    // changing the last value changes only the last swap
    const r2 = cores.pickBonus({}, coreArgs(-1, { start: true }, [q(0, 5), q(3, 4), q(1, 3), q(0, 2)], params));
    expect(r2.updatedState.pool).toEqual([30, 'END', 20, 40, 10]);
  });

  test('fewer Seeds values than shuffle steps fails closed; a value that is not ISAAC output is refused', () => {
    expect(() => cores.pickBonus({}, coreArgs(-1, { start: true }, [1e11, 2e11, 3e11]))).toThrow(
      '[Pick Bonus] Seeds has 3 values but 4 shuffle steps need a value: every random outcome takes its own Seeds value and none is reused. ' +
      'Set the ISAAC Random Number Array Generator feeding Seeds to size >= prizes + endMarkers - 1 = 4.'
    );
    expect(() => cores.pickBonus({}, coreArgs(-1, { start: true }, [1e11, 0.25, 3e11, 4e11]))).toThrow(
      /^\[Pick Bonus\] Seeds\[1\] = 0.25 is not an ISAAC Random Number Array Generator value/
    );
  });

  test('unseeded start fails closed: error logged + in inspect data, outputs empty, state untouched, Done fires', async () => {
    const h = await mount(PickBonus, Object.assign({ Seeds: [] }, PARAMS));
    h.fire('start');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatch(/^\[Pick Bonus\] Seeds is required/);
    expect(h.node.getInspectInfo().value.error).toMatch(/Seeds is required/);
    expect(h.out('revealed')).toEqual([]);
    expect(h.out('total')).toBe(0);
    expect(h.out('remaining')).toBe(0);
    expect(h.out('ended')).toBe(false);
    expect(h.out('active')).toBe(false);
    expect(h.out('lastPrize')).toBeNull();
    expect(h.out('lastIsEnd')).toBe(false);
    expect(h.out('revealedNow')).toBe(false);
    expect(h.out('poolSize')).toBe(0);
    expect(h.out('picksMade')).toBe(0);
    expect(h.out('hiddenCount')).toBe(0);
    expect(h.node._internal.state).toEqual({});
    expect(h.count('Done')).toBe(1);
  });
});
