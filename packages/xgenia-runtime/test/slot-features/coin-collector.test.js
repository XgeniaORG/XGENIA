// Coin Collector (slot feature 5): registry port parity, client == core with and without a collector,
// the multiplier, and the fail-closed contract.
'use strict';

const fs = require('fs');
const path = require('path');
const { defineFeature, mount } = require('./harness');
const cores = require('../../src/api/slot-feature-cores');

const FILE = 'coin-collector.js';
const NAME = 'Coin Collector';
const Def = defineFeature(FILE);
const OUTPUTS = ['collected', 'totalOnGrid', 'coinPositions', 'coinCount', 'collectorPositions', 'collectorCount', 'hasCollector', 'paid'];

const DEFAULTS = { reels: [], valueGrid: [], collectorSymbol: 0, requireCollector: true, multiplyByCollectors: false };

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

// reels[col][row]; 8 = collector, 9 = coin symbol (valued by the grid below)
const GRID = [
  [1, 9, 3],
  [8, 2, 2],
  [4, 4, 9],
  [1, 9, 8],
  [3, 2, 5]
];
const VALUE_GRID = [
  [0, 200, 0],
  [0, 0, 0],
  [0, 0, 1000],
  [0, 500, 0],
  [0, 0, 0]
];

let errorSpy;
beforeEach(() => {
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
});

describe('Coin Collector', () => {
  test('module shape, metadata and registry port parity', () => {
    const mod = require(path.resolve(__dirname, '../../../../private/xgenia-pro-nodes/src/slot-games/features', FILE));
    expect(Object.keys(mod)).toEqual(['node']);
    expect(mod.node.name).toBe(NAME);
    expect(mod.node.category).toBe('Math');
    expect(mod.node.docs).toBe('https://docsapp.xgenia.com/nodes/slot-features/coin-collector');
    expect(typeof mod.node.description).toBe('string');

    const spec = registryPorts(NAME);
    const inputs = Object.keys(Def.metadata.inputs).filter((n) => n !== 'functionScript');
    expect(inputs.sort()).toEqual(spec.inputs.concat(['Do']).sort());
    expect(Object.keys(Def.metadata.outputs).sort()).toEqual(spec.outputs.concat(['Done']).sort());
    expect(Def.metadata.inputs.Do.type.name).toBe('signal');
    expect(Def.metadata.outputs.Done.type).toBe('signal');
    ['hasCollector', 'paid'].forEach((name) => expect(Def.metadata.outputs[name].type).toBe('boolean'));
    Object.keys(DEFAULTS).forEach((name) => expect(Def.metadata.inputs[name].default).toEqual(DEFAULTS[name]));
  });

  test('two collectors on the grid: collected equals the core (plain and multiplied)', async () => {
    const params = { reels: GRID, valueGrid: VALUE_GRID, collectorSymbol: 8 };
    const h = await mount(Def, params);
    h.fire('Do');
    let expected = cores.collectCoins(Object.assign({}, DEFAULTS, params));
    OUTPUTS.forEach((name) => expect(h.out(name)).toEqual(expected[name]));
    expect(h.out('hasCollector')).toBe(true);
    expect(h.out('paid')).toBe(true);
    expect(h.out('collectorCount')).toBe(2);
    expect(h.out('coinCount')).toBe(3);
    expect(h.out('totalOnGrid')).toBe(1700);
    expect(h.out('collected')).toBe(1700);

    h.set('multiplyByCollectors', true);
    h.fire('Do');
    expected = cores.collectCoins(Object.assign({}, DEFAULTS, params, { multiplyByCollectors: true }));
    OUTPUTS.forEach((name) => expect(h.out(name)).toEqual(expected[name]));
    expect(h.out('collected')).toBe(3400);
    expect(h.count('Done')).toBe(2);
  });

  test('no collector: nothing is paid unless requireCollector is false', async () => {
    const params = { reels: GRID, valueGrid: VALUE_GRID, collectorSymbol: 7 };
    const h = await mount(Def, params);
    h.fire('Do');
    let expected = cores.collectCoins(Object.assign({}, DEFAULTS, params));
    OUTPUTS.forEach((name) => expect(h.out(name)).toEqual(expected[name]));
    expect(h.out('hasCollector')).toBe(false);
    expect(h.out('paid')).toBe(false);
    expect(h.out('collected')).toBe(0);
    expect(h.out('totalOnGrid')).toBe(1700);

    h.set('requireCollector', false);
    h.fire('Do');
    expected = cores.collectCoins(Object.assign({}, DEFAULTS, params, { requireCollector: false }));
    OUTPUTS.forEach((name) => expect(h.out(name)).toEqual(expected[name]));
    expect(h.out('paid')).toBe(true);
    expect(h.out('collected')).toBe(1700);
  });

  test('fails closed on a bad grid: console.error, inspect error, empty outputs, Done still fires', async () => {
    const h = await mount(Def, { valueGrid: VALUE_GRID, collectorSymbol: 8 });
    h.fire('Do');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatch(/^\[Coin Collector\] reels must be a non-empty array/);
    expect(h.node.getInspectInfo().value.error).toMatch(/reels must be/);
    expect(h.out('collected')).toBe(0);
    expect(h.out('totalOnGrid')).toBe(0);
    expect(h.out('coinPositions')).toEqual([]);
    expect(h.out('coinCount')).toBe(0);
    expect(h.out('collectorPositions')).toEqual([]);
    expect(h.out('collectorCount')).toBe(0);
    expect(h.out('hasCollector')).toBe(false);
    expect(h.out('paid')).toBe(false);
    expect(h.count('Done')).toBe(1);
  });
});
