// Symbol Upgrade (slot feature 14, stateful): registry port mirror, activate / Do / reset parity
// with the shared core over a multi-call upgrade, the registry's derived activateOnDo rule, and
// the fail-closed error contract.
'use strict';

const { defineFeature, mount } = require('./harness');
const cores = require('@xgenia/runtime/src/api/slot-feature-cores');

const SymbolUpgrade = defineFeature('symbol-upgrade.js');

const REGISTRY_INPUTS = ['reels', 'fromSymbol', 'toSymbol', 'duration', 'activate', 'activateOnDo', 'reset'];
const REGISTRY_OUTPUTS = ['reels', 'active', 'remaining', 'upgradedCount', 'changed'];

// reels[col][row]; symbol 2 appears three times
const GRID = [
  [1, 2, 3],
  [2, 4, 5],
  [6, 1, 2],
  [3, 4, 7],
  [5, 6, 1]
];

/** The registry's derived rule, applied by the server and mirrored by the client. */
function coreArgs(reels, params, flags) {
  const f = flags || {};
  return {
    reels,
    fromSymbol: params.fromSymbol,
    toSymbol: params.toSymbol,
    duration: params.duration,
    activate: f.activate === true || params.activateOnDo === true,
    reset: f.reset === true
  };
}

function expectParity(h, r) {
  for (const name of REGISTRY_OUTPUTS) expect(h.out(name)).toEqual(r[name]);
}

describe('Symbol Upgrade', () => {
  let errorSpy;
  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  test('module shape and metadata mirror the registry', () => {
    const mod = require('../../../../private/xgenia-pro-nodes/src/slot-games/features/symbol-upgrade.js');
    expect(Object.keys(mod)).toEqual(['node']);
    expect(mod.node.name).toBe('Symbol Upgrade');
    expect(mod.node.category).toBe('Math');
    expect(mod.node.color).toBe('math');
    expect(mod.node.docs).toBe('https://docsapp.xgenia.com/nodes/slot-features/symbol-upgrade');
    expect(typeof mod.node.description).toBe('string');
    expect(mod.node.description).toMatch(/Variable2/);
    expect(mod.node.description).toMatch(/identified players/);
    expect(mod.node.description).toMatch(/activateOnDo/);
    const inputs = Object.keys(SymbolUpgrade.metadata.inputs).filter((n) => n !== 'functionScript');
    expect(inputs.sort()).toEqual(REGISTRY_INPUTS.concat(['Do']).sort());
    expect(Object.keys(SymbolUpgrade.metadata.outputs).sort()).toEqual(REGISTRY_OUTPUTS.concat(['Done']).sort());
    for (const sig of ['Do', 'activate', 'reset']) expect(SymbolUpgrade.metadata.inputs[sig].type.name).toBe('signal');
    expect(SymbolUpgrade.metadata.inputs.activateOnDo.type).toBe('boolean');
    expect(SymbolUpgrade.metadata.inputs.activateOnDo.default).toBe(false);
    expect(SymbolUpgrade.metadata.outputs.Done.type).toBe('signal');
    expect(SymbolUpgrade.metadata.outputs.active.type).toBe('boolean');
  });

  test('Do (idle), activate, two counted Do calls and reset equal the core with the same threaded state', async () => {
    const params = { fromSymbol: 2, toSymbol: 7, duration: 2, activateOnDo: false };
    const h = await mount(SymbolUpgrade, Object.assign({ reels: GRID }, params));
    let state = {};

    h.fire('Do');
    let r = cores.applySymbolUpgrade(state, coreArgs(GRID, params));
    state = r.updatedState;
    expectParity(h, r);
    expect(h.out('reels')).toEqual(GRID);
    expect(h.out('active')).toBe(false);
    expect(h.out('upgradedCount')).toBe(0);

    h.fire('activate');
    r = cores.applySymbolUpgrade(state, coreArgs(GRID, params, { activate: true }));
    state = r.updatedState;
    expectParity(h, r);
    expect(h.out('active')).toBe(true);
    expect(h.out('upgradedCount')).toBe(3);
    expect(h.out('reels')[0]).toEqual([1, 7, 3]);
    expect(h.out('remaining')).toBe(1);

    h.fire('Do');
    r = cores.applySymbolUpgrade(state, coreArgs(GRID, params));
    state = r.updatedState;
    expectParity(h, r);
    expect(h.out('upgradedCount')).toBe(3);
    expect(h.out('remaining')).toBe(0);
    expect(h.out('active')).toBe(false);

    h.fire('Do'); // lapsed: no swap
    r = cores.applySymbolUpgrade(state, coreArgs(GRID, params));
    state = r.updatedState;
    expectParity(h, r);
    expect(h.out('changed')).toBe(false);

    h.fire('activate');
    r = cores.applySymbolUpgrade(state, coreArgs(GRID, params, { activate: true }));
    state = r.updatedState;
    h.fire('reset');
    r = cores.applySymbolUpgrade(state, coreArgs(GRID, params, { reset: true }));
    state = r.updatedState;
    expectParity(h, r);
    expect(h.out('active')).toBe(false);
    expect(h.out('reels')).toEqual(GRID);
    expect(h.count('Done')).toBe(6);
    expect(h.node._internal.state).toEqual(state);
  });

  test('activateOnDo applies the registry derived rule on Do AND on reset, like the server', async () => {
    const params = { fromSymbol: 2, toSymbol: 9, duration: 0, activateOnDo: true };
    const h = await mount(SymbolUpgrade, Object.assign({ reels: GRID }, params));
    let state = {};
    h.fire('Do');
    let r = cores.applySymbolUpgrade(state, coreArgs(GRID, params));
    state = r.updatedState;
    expectParity(h, r);
    expect(h.out('active')).toBe(true);
    expect(h.out('remaining')).toBe(-1);
    expect(h.out('upgradedCount')).toBe(3);
    // reset with activateOnDo true: the core resets, then re-activates (activate = false || true)
    h.fire('reset');
    r = cores.applySymbolUpgrade(state, coreArgs(GRID, params, { reset: true }));
    expectParity(h, r);
    expect(h.out('active')).toBe(true);
    expect(h.node.getInspectInfo().value.activateApplied).toBe(true);
  });

  test('fails closed on a malformed grid: error logged + in inspect data, outputs empty, state untouched, Done fires', async () => {
    const h = await mount(SymbolUpgrade, { reels: [], fromSymbol: 2, toSymbol: 7 });
    h.fire('activate');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatch(/^\[Symbol Upgrade\] /);
    expect(h.node.getInspectInfo().value.error).toMatch(/reels must be a non-empty array/);
    expect(h.out('reels')).toEqual([]);
    expect(h.out('active')).toBe(false);
    expect(h.out('remaining')).toBe(0);
    expect(h.out('upgradedCount')).toBe(0);
    expect(h.out('changed')).toBe(false);
    expect(h.node._internal.state).toEqual({});
    expect(h.count('Done')).toBe(1);
  });
});
