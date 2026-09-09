// Locked Reels (slot feature 12, stateful): registry port mirror, start / Do / reset parity with
// the shared core across a full respin sequence (state threaded exactly as the server does), and
// the fail-closed error contract.
'use strict';

const { defineFeature, mount } = require('./harness');
const cores = require('@xgenia/runtime/src/api/slot-feature-cores');

const LockedReels = defineFeature('locked-reels.js');

const REGISTRY_INPUTS = ['reels', 'lockSymbol', 'lockColumns', 'respins', 'resetOnNewLock', 'start', 'reset'];
const REGISTRY_OUTPUTS = ['reels', 'lockedColumns', 'freeColumns', 'lockedCount', 'newLocks', 'respinsLeft', 'roundOver', 'active'];

// reels[col][row]; lock symbol 9 shows in columns 1 and 3
const SPIN = [
  [1, 2, 3],
  [9, 4, 5],
  [6, 1, 2],
  [3, 9, 4],
  [5, 6, 1]
];
// respin 1: column 0 now shows 9 (new lock); the locked columns landed different symbols that must be restored
const RESPIN_1 = [
  [2, 9, 3],
  [1, 1, 1],
  [6, 2, 2],
  [2, 2, 2],
  [5, 6, 3]
];
// respin 2 / 3: nothing new
const RESPIN_2 = [
  [4, 4, 4],
  [1, 1, 1],
  [6, 3, 2],
  [2, 2, 2],
  [5, 1, 3]
];
const PARAMS = { lockSymbol: 9, lockColumns: [], respins: 2, resetOnNewLock: true };

function coreArgs(reels, flags) {
  return Object.assign({ reels }, PARAMS, { start: false, reset: false }, flags || {});
}

function expectParity(h, r) {
  for (const name of REGISTRY_OUTPUTS) expect(h.out(name)).toEqual(r[name]);
}

describe('Locked Reels', () => {
  let errorSpy;
  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  test('module shape and metadata mirror the registry', () => {
    const mod = require('../../../../private/xgenia-pro-nodes/src/slot-games/features/locked-reels.js');
    expect(Object.keys(mod)).toEqual(['node']);
    expect(mod.node.name).toBe('Locked Reels');
    expect(mod.node.category).toBe('Math');
    expect(mod.node.color).toBe('math');
    expect(mod.node.docs).toBe('https://docsapp.xgenia.com/nodes/slot-features/locked-reels');
    expect(typeof mod.node.description).toBe('string');
    expect(mod.node.description).toMatch(/Column Spin Router\.freeColumns/);
    expect(mod.node.description).toMatch(/Variable2/);
    expect(mod.node.description).toMatch(/identified players/);
    const inputs = Object.keys(LockedReels.metadata.inputs).filter((n) => n !== 'functionScript');
    expect(inputs.sort()).toEqual(REGISTRY_INPUTS.concat(['Do']).sort());
    expect(Object.keys(LockedReels.metadata.outputs).sort()).toEqual(REGISTRY_OUTPUTS.concat(['Done']).sort());
    for (const sig of ['Do', 'start', 'reset']) expect(LockedReels.metadata.inputs[sig].type.name).toBe('signal');
    expect(LockedReels.metadata.outputs.Done.type).toBe('signal');
    expect(LockedReels.metadata.outputs.roundOver.type).toBe('boolean');
    expect(LockedReels.metadata.outputs.active.type).toBe('boolean');
    expect(LockedReels.metadata.inputs.respins.default).toBe(3);
    expect(LockedReels.metadata.inputs.resetOnNewLock.default).toBe(true);
  });

  test('start, respins via Do, round over and reset all equal the core with the same threaded state', async () => {
    const h = await mount(LockedReels, Object.assign({ reels: SPIN }, PARAMS));
    let state = {};

    // round 1: start locks columns 1 and 3
    h.fire('start');
    let r = cores.applyLockedReels(state, coreArgs(SPIN, { start: true }));
    state = r.updatedState;
    expectParity(h, r);
    expect(h.out('lockedColumns')).toEqual([1, 3]);
    expect(h.out('freeColumns')).toEqual([0, 2, 4]);
    expect(h.out('active')).toBe(true);
    expect(h.out('respinsLeft')).toBe(2);
    expect(h.count('Done')).toBe(1);

    // round 2: respin — column 0 locks (new), frozen columns are restored, counter resets
    h.set('reels', RESPIN_1);
    h.fire('Do');
    r = cores.applyLockedReels(state, coreArgs(RESPIN_1));
    state = r.updatedState;
    expectParity(h, r);
    expect(h.out('reels')[1]).toEqual(SPIN[1]);
    expect(h.out('reels')[3]).toEqual(SPIN[3]);
    expect(h.out('reels')[0]).toEqual(RESPIN_1[0]);
    expect(h.out('newLocks')).toBe(1);
    expect(h.out('lockedColumns')).toEqual([0, 1, 3]);
    expect(h.out('respinsLeft')).toBe(2);
    expect(h.out('roundOver')).toBe(false);

    // rounds 3 and 4: nothing new, the counter runs out
    h.set('reels', RESPIN_2);
    h.fire('Do');
    r = cores.applyLockedReels(state, coreArgs(RESPIN_2));
    state = r.updatedState;
    expectParity(h, r);
    expect(h.out('respinsLeft')).toBe(1);
    expect(h.out('roundOver')).toBe(false);

    h.fire('Do');
    r = cores.applyLockedReels(state, coreArgs(RESPIN_2));
    state = r.updatedState;
    expectParity(h, r);
    expect(h.out('respinsLeft')).toBe(0);
    expect(h.out('roundOver')).toBe(true);
    expect(h.out('active')).toBe(false);

    // reset (with a grid that shows no lock symbol): everything clears
    h.fire('reset');
    r = cores.applyLockedReels(state, coreArgs(RESPIN_2, { reset: true }));
    state = r.updatedState;
    expectParity(h, r);
    expect(h.out('lockedColumns')).toEqual([]);
    expect(h.out('active')).toBe(false);
    expect(h.count('Done')).toBe(5);
    expect(h.node._internal.state).toEqual(state);
    expect(h.node.getInspectInfo().value.signal).toBe('reset');
  });

  test('Do while idle behaves like start, and forced lockColumns lock without the symbol (core parity)', async () => {
    const params = { lockSymbol: 9, lockColumns: [4], respins: 1, resetOnNewLock: false };
    const h = await mount(LockedReels, Object.assign({ reels: SPIN }, params));
    h.fire('Do');
    const r = cores.applyLockedReels({}, Object.assign({ reels: SPIN }, params, { start: false, reset: false }));
    expectParity(h, r);
    expect(h.out('lockedColumns')).toEqual([1, 3, 4]);
    expect(h.out('active')).toBe(true);
  });

  test('fails closed on a malformed grid: error logged + in inspect data, outputs empty, state untouched, Done fires', async () => {
    const h = await mount(LockedReels, Object.assign({ reels: [[1, 2, 3], [4, 5]] }, PARAMS));
    h.fire('start');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatch(/^\[Locked Reels\] /);
    expect(h.node.getInspectInfo().value.error).toMatch(/rectangular/);
    expect(h.out('reels')).toEqual([]);
    expect(h.out('lockedColumns')).toEqual([]);
    expect(h.out('freeColumns')).toEqual([]);
    expect(h.out('lockedCount')).toBe(0);
    expect(h.out('newLocks')).toBe(0);
    expect(h.out('respinsLeft')).toBe(0);
    expect(h.out('roundOver')).toBe(false);
    expect(h.out('active')).toBe(false);
    expect(h.node._internal.state).toEqual({});
    expect(h.count('Done')).toBe(1);
  });
});
