// Symbol Value Grid (slot feature 4, seeded): registry port parity (Seeds -> seeds), seeded client ==
// core, no seeds needed when there is nothing to value, and the fail-closed unseeded contract.
'use strict';

const fs = require('fs');
const path = require('path');
const { defineFeature, mount } = require('./harness');
const cores = require('../../src/api/slot-feature-cores');

const FILE = 'symbol-value-grid.js';
const NAME = 'Symbol Value Grid';
const Def = defineFeature(FILE);
const OUTPUTS = ['valueGrid', 'coinPositions', 'coinCount', 'totalValue'];

const DEFAULTS = { reels: [], valueSymbol: 0, values: [1, 2, 5, 10], weights: [], betAmount: 100, valuesAreBetMultiples: true, Seeds: [] };

function registryPorts(nodeName) {
  const src = fs.readFileSync(path.resolve(__dirname, '../../src/api/slot-feature-node-converter.ts'), 'utf8');
  const start = src.indexOf("'" + nodeName + "',");
  if (start < 0) throw new Error('registry has no entry for ' + nodeName);
  const list = (key) => {
    const m = src.slice(start).match(new RegExp('\\b' + key + ':\\s*(\\[[^\\]]*\\])'));
    if (!m) throw new Error('registry entry for ' + nodeName + ' has no ' + key);
    return JSON.parse(m[1].replace(/'/g, '"'));
  };
  return { inputs: list('inputs'), outputs: list('outputs') };
}

/** Server-side argument set: params over defaults, `Seeds` renamed to the core's `seeds`. */
function coreArgs(params) {
  const p = Object.assign({}, DEFAULTS, params);
  return { reels: p.reels, valueSymbol: p.valueSymbol, values: p.values, weights: p.weights, betAmount: p.betAmount, valuesAreBetMultiples: p.valuesAreBetMultiples, seeds: p.Seeds };
}

// reels[col][row]; symbol 9 is the coin symbol (4 coins)
const GRID = [
  [1, 9, 3],
  [9, 2, 2],
  [4, 4, 9],
  [1, 9, 1],
  [3, 2, 5]
];
const SEEDS = [734262917123, 12345, 987654321];

let errorSpy;
beforeEach(() => {
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
});

describe('Symbol Value Grid', () => {
  test('module shape, metadata and registry port parity', () => {
    const mod = require(path.resolve(__dirname, '../../../../private/xgenia-pro-nodes/src/slot-games/features', FILE));
    expect(Object.keys(mod)).toEqual(['node']);
    expect(mod.node.name).toBe(NAME);
    expect(mod.node.category).toBe('Math');
    expect(mod.node.docs).toBe('https://docsapp.xgenia.com/nodes/slot-features/symbol-value-grid');
    expect(typeof mod.node.description).toBe('string');
    expect(mod.node.description).toMatch(/ISAAC Random Number Array Generator/);

    const spec = registryPorts(NAME);
    const inputs = Object.keys(Def.metadata.inputs).filter((n) => n !== 'functionScript');
    expect(inputs.sort()).toEqual(spec.inputs.concat(['Do']).sort());
    expect(Object.keys(Def.metadata.outputs).sort()).toEqual(spec.outputs.concat(['Done']).sort());
    expect(Def.metadata.inputs.Do.type.name).toBe('signal');
    expect(Def.metadata.outputs.Done.type).toBe('signal');
    Object.keys(DEFAULTS).forEach((name) => expect(Def.metadata.inputs[name].default).toEqual(DEFAULTS[name]));
  });

  test('seeded Do computes exactly what the core computes', async () => {
    const params = { reels: GRID, valueSymbol: 9, values: [1, 2, 5, 10], weights: [50, 30, 15, 5], betAmount: 200, Seeds: SEEDS };
    const h = await mount(Def, params);
    h.fire('Do');
    const expected = cores.buildSymbolValueGrid(coreArgs(params));
    OUTPUTS.forEach((name) => expect(h.out(name)).toEqual(expected[name]));
    expect(h.out('coinCount')).toBe(4);
    expect(h.out('coinPositions')).toEqual([[1, 0], [0, 1], [2, 2], [1, 3]]);
    expect(h.out('totalValue')).toBeGreaterThan(0);
    expect(h.out('valueGrid').length).toBe(5);
    expect(h.count('Done')).toBe(1);
    expect(errorSpy).not.toHaveBeenCalled();

    // same seeds -> same values (reproducible), a different seed -> the core's other draw
    h.fire('Do');
    OUTPUTS.forEach((name) => expect(h.out(name)).toEqual(expected[name]));
    h.set('Seeds', [42]);
    h.fire('Do');
    const reseeded = cores.buildSymbolValueGrid(coreArgs(Object.assign({}, params, { Seeds: [42] })));
    OUTPUTS.forEach((name) => expect(h.out(name)).toEqual(reseeded[name]));
  });

  test('absolute values (valuesAreBetMultiples false) match the core too', async () => {
    const params = { reels: GRID, valueSymbol: 9, values: [100, 250], weights: [1, 1], betAmount: 500, valuesAreBetMultiples: false, Seeds: [99] };
    const h = await mount(Def, params);
    h.fire('Do');
    const expected = cores.buildSymbolValueGrid(coreArgs(params));
    OUTPUTS.forEach((name) => expect(h.out(name)).toEqual(expected[name]));
    h.out('valueGrid').forEach((col) => col.forEach((v) => expect([0, 100, 250]).toContain(v)));
  });

  test('no coins on the grid needs no seeds', async () => {
    const params = { reels: GRID, valueSymbol: 7 };
    const h = await mount(Def, params);
    h.fire('Do');
    const expected = cores.buildSymbolValueGrid(coreArgs(params));
    OUTPUTS.forEach((name) => expect(h.out(name)).toEqual(expected[name]));
    expect(h.out('coinCount')).toBe(0);
    expect(h.out('totalValue')).toBe(0);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(h.count('Done')).toBe(1);
  });

  test('FAILS CLOSED unseeded: error logged and recorded, outputs empty, Done still fires', async () => {
    const params = { reels: GRID, valueSymbol: 9 }; // Seeds left at the default []
    const h = await mount(Def, params);
    expect(() => cores.buildSymbolValueGrid(coreArgs(params))).toThrow(/\[Symbol Value Grid\] Seeds is required/);
    h.fire('Do');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatch(/^\[Symbol Value Grid\] Seeds is required \(1 needed, got 0\)/);
    expect(errorSpy.mock.calls[0][0]).toMatch(/ISAAC Random Number Array Generator/);
    expect(h.node.getInspectInfo().value.error).toMatch(/Seeds is required/);
    expect(h.out('valueGrid')).toEqual([]);
    expect(h.out('coinPositions')).toEqual([]);
    expect(h.out('coinCount')).toBe(0);
    expect(h.out('totalValue')).toBe(0);
    expect(h.count('Done')).toBe(1);

    // wiring seeds recovers
    h.set('Seeds', SEEDS);
    h.fire('Do');
    expect(h.out('coinCount')).toBe(4);
    expect(h.count('Done')).toBe(2);
  });

  test('fails closed on a bad grid as well', async () => {
    const h = await mount(Def, { valueSymbol: 9, Seeds: SEEDS });
    h.fire('Do');
    expect(errorSpy.mock.calls[0][0]).toMatch(/^\[Symbol Value Grid\] reels must be a non-empty array/);
    expect(h.out('valueGrid')).toEqual([]);
    expect(h.count('Done')).toBe(1);
  });
});
