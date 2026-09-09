// Jackpot Tiers (slot feature 6): registry port parity (no `tiers` output), client == core for the
// default tiers, a fixed award and no tier, and the fail-closed contract.
'use strict';

const fs = require('fs');
const path = require('path');
const { defineFeature, mount } = require('./harness');
const cores = require('../../src/api/slot-feature-cores');

const FILE = 'jackpot-tiers.js';
const NAME = 'Jackpot Tiers';
const Def = defineFeature(FILE);
const OUTPUTS = ['symbolCount', 'positions', 'tierIndex', 'tierName', 'multiplier', 'award', 'hasTier'];

const DEFAULT_TIERS = [
  { name: 'Mini', count: 3, multiplier: 20 },
  { name: 'Minor', count: 4, multiplier: 100 },
  { name: 'Major', count: 5, multiplier: 1000 }
];
const DEFAULTS = { reels: [], jackpotSymbol: 0, tiers: DEFAULT_TIERS, betAmount: 100 };

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

// reels[col][row]; 12 = jackpot symbol, four of them
const GRID = [
  [12, 1, 3],
  [2, 12, 2],
  [4, 4, 12],
  [1, 12, 1],
  [3, 2, 5]
];

let errorSpy;
beforeEach(() => {
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
});

describe('Jackpot Tiers', () => {
  test('module shape, metadata and registry port parity', () => {
    const mod = require(path.resolve(__dirname, '../../../../private/xgenia-pro-nodes/src/slot-games/features', FILE));
    expect(Object.keys(mod)).toEqual(['node']);
    expect(mod.node.name).toBe(NAME);
    expect(mod.node.category).toBe('Math');
    expect(mod.node.docs).toBe('https://docsapp.xgenia.com/nodes/slot-features/jackpot-tiers');
    expect(typeof mod.node.description).toBe('string');

    const spec = registryPorts(NAME);
    const inputs = Object.keys(Def.metadata.inputs).filter((n) => n !== 'functionScript');
    expect(inputs.sort()).toEqual(spec.inputs.concat(['Do']).sort());
    expect(Object.keys(Def.metadata.outputs).sort()).toEqual(spec.outputs.concat(['Done']).sort());
    expect(Def.metadata.outputs.tiers).toBeUndefined(); // the core returns it, the registry does not expose it
    expect(Def.metadata.inputs.Do.type.name).toBe('signal');
    expect(Def.metadata.outputs.Done.type).toBe('signal');
    expect(Def.metadata.outputs.hasTier.type).toBe('boolean');
    expect(Def.metadata.outputs.tierName.type).toBe('string');
    Object.keys(DEFAULTS).forEach((name) => expect(Def.metadata.inputs[name].default).toEqual(DEFAULTS[name]));
  });

  test('four jackpot symbols hit Minor with the default tiers: client == core', async () => {
    const params = { reels: GRID, jackpotSymbol: 12, betAmount: 100 };
    const h = await mount(Def, params);
    h.fire('Do');
    const expected = cores.evaluateJackpotTiers(Object.assign({}, DEFAULTS, params));
    OUTPUTS.forEach((name) => expect(h.out(name)).toEqual(expected[name]));
    expect(h.out('symbolCount')).toBe(4);
    expect(h.out('positions')).toEqual([[0, 0], [1, 1], [2, 2], [1, 3]]);
    expect(h.out('tierIndex')).toBe(1);
    expect(h.out('tierName')).toBe('Minor');
    expect(h.out('multiplier')).toBe(100);
    expect(h.out('award')).toBe(10000);
    expect(h.out('hasTier')).toBe(true);
    expect(h.count('Done')).toBe(1);
  });

  test('custom tiers with a fixed award, and no tier reached', async () => {
    const tiers = [{ name: 'Grand', count: 4, fixed: 250000 }, { name: 'Small', count: 2, multiplier: 5 }];
    const params = { reels: GRID, jackpotSymbol: 12, tiers: tiers, betAmount: 300 };
    const h = await mount(Def, params);
    h.fire('Do');
    let expected = cores.evaluateJackpotTiers(Object.assign({}, DEFAULTS, params));
    OUTPUTS.forEach((name) => expect(h.out(name)).toEqual(expected[name]));
    expect(h.out('tierName')).toBe('Grand');
    expect(h.out('award')).toBe(250000);

    h.set('jackpotSymbol', 5); // one symbol only
    h.fire('Do');
    expected = cores.evaluateJackpotTiers(Object.assign({}, DEFAULTS, params, { jackpotSymbol: 5 }));
    OUTPUTS.forEach((name) => expect(h.out(name)).toEqual(expected[name]));
    expect(h.out('symbolCount')).toBe(1);
    expect(h.out('tierIndex')).toBe(-1);
    expect(h.out('tierName')).toBe('');
    expect(h.out('award')).toBe(0);
    expect(h.out('hasTier')).toBe(false);
    expect(h.count('Done')).toBe(2);
  });

  test('fails closed on a bad grid: console.error, inspect error, empty outputs, Done still fires', async () => {
    const h = await mount(Def, { jackpotSymbol: 12 });
    h.fire('Do');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatch(/^\[Jackpot Tiers\] reels must be a non-empty array/);
    expect(h.node.getInspectInfo().value.error).toMatch(/reels must be/);
    expect(h.out('symbolCount')).toBe(0);
    expect(h.out('positions')).toEqual([]);
    expect(h.out('tierIndex')).toBe(0);
    expect(h.out('tierName')).toBe('');
    expect(h.out('multiplier')).toBe(0);
    expect(h.out('award')).toBe(0);
    expect(h.out('hasTier')).toBe(false);
    expect(h.count('Done')).toBe(1);
  });
});
