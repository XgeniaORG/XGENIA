// Bet Mode (slot feature 8): registry port parity (no `direction` output), client == core for base,
// ante, bonus buy, custom and unknown modes and both directions.
'use strict';

const fs = require('fs');
const path = require('path');
const { defineFeature, mount } = require('./harness');
const cores = require('../../src/api/slot-feature-cores');

const FILE = 'bet-mode.js';
const NAME = 'Bet Mode';
const Def = defineFeature(FILE);
const OUTPUTS = ['mode', 'modeKnown', 'multiplier', 'cost', 'baseBet', 'stakeForPaytable', 'isBase', 'isAnte', 'isBonusBuy', 'forceFeature'];

const DEFAULTS = { betAmount: 100, mode: 'base', anteMultiplier: 1.25, bonusBuyMultiplier: 100, customMultipliers: {}, direction: 'base-to-cost' };

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

async function evaluate(params) {
  const h = await mount(Def, params);
  h.fire('Do');
  const expected = cores.computeBetMode(Object.assign({}, DEFAULTS, params));
  OUTPUTS.forEach((name) => expect(h.out(name)).toEqual(expected[name]));
  expect(h.count('Done')).toBe(1);
  return h;
}

describe('Bet Mode', () => {
  test('module shape, metadata and registry port parity', () => {
    const mod = require(path.resolve(__dirname, '../../../../private/xgenia-pro-nodes/src/slot-games/features', FILE));
    expect(Object.keys(mod)).toEqual(['node']);
    expect(mod.node.name).toBe(NAME);
    expect(mod.node.category).toBe('Math');
    expect(mod.node.docs).toBe('https://docsapp.xgenia.com/nodes/slot-features/bet-mode');
    expect(typeof mod.node.description).toBe('string');

    const spec = registryPorts(NAME);
    const inputs = Object.keys(Def.metadata.inputs).filter((n) => n !== 'functionScript');
    expect(inputs.sort()).toEqual(spec.inputs.concat(['Do']).sort());
    expect(Object.keys(Def.metadata.outputs).sort()).toEqual(spec.outputs.concat(['Done']).sort());
    expect(Def.metadata.outputs.direction).toBeUndefined(); // the core returns it, the registry does not expose it
    expect(Def.metadata.inputs.Do.type.name).toBe('signal');
    expect(Def.metadata.inputs.direction.type.name).toBe('enum');
    expect(Def.metadata.inputs.direction.type.enums.map((e) => e.value)).toEqual(['base-to-cost', 'cost-to-base']);
    expect(Def.metadata.outputs.Done.type).toBe('signal');
    ['modeKnown', 'isBase', 'isAnte', 'isBonusBuy', 'forceFeature'].forEach((name) => expect(Def.metadata.outputs[name].type).toBe('boolean'));
    Object.keys(DEFAULTS).forEach((name) => expect(Def.metadata.inputs[name].default).toEqual(DEFAULTS[name]));
  });

  test('base mode with the defaults', async () => {
    const h = await evaluate({ betAmount: 200 });
    expect(h.out('mode')).toBe('base');
    expect(h.out('modeKnown')).toBe(true);
    expect(h.out('multiplier')).toBe(1);
    expect(h.out('cost')).toBe(200);
    expect(h.out('baseBet')).toBe(200);
    expect(h.out('stakeForPaytable')).toBe(200);
    expect(h.out('isBase')).toBe(true);
    expect(h.out('forceFeature')).toBe(false);
  });

  test('ante bet: cost = bet x anteMultiplier, rounded to minor units', async () => {
    const h = await evaluate({ betAmount: 150, mode: 'ante', anteMultiplier: 1.25 });
    expect(h.out('isAnte')).toBe(true);
    expect(h.out('isBase')).toBe(false);
    expect(h.out('cost')).toBe(188);
    expect(h.out('baseBet')).toBe(150);
  });

  test('bonus buy (spelled "Bonus Buy") forces the feature', async () => {
    const h = await evaluate({ betAmount: 100, mode: 'Bonus Buy', bonusBuyMultiplier: 80 });
    expect(h.out('mode')).toBe('bonus_buy');
    expect(h.out('isBonusBuy')).toBe(true);
    expect(h.out('forceFeature')).toBe(true);
    expect(h.out('cost')).toBe(8000);
    expect(h.out('stakeForPaytable')).toBe(100);
  });

  test('custom multipliers and an unknown mode', async () => {
    const h = await evaluate({ betAmount: 100, mode: 'turbo', customMultipliers: { turbo: 2.5 } });
    expect(h.out('modeKnown')).toBe(true);
    expect(h.out('multiplier')).toBe(2.5);
    expect(h.out('cost')).toBe(250);

    const h2 = await evaluate({ betAmount: 100, mode: 'mystery' });
    expect(h2.out('modeKnown')).toBe(false);
    expect(h2.out('mode')).toBe('base');
    expect(h2.out('cost')).toBe(100);
  });

  test('cost-to-base direction derives the base bet from what the player pays', async () => {
    const h = await evaluate({ betAmount: 10000, mode: 'bonus_buy', bonusBuyMultiplier: 100, direction: 'cost-to-base' });
    expect(h.out('cost')).toBe(10000);
    expect(h.out('baseBet')).toBe(100);
    expect(h.out('stakeForPaytable')).toBe(100);

    // switching the mode on the same node re-evaluates
    h.set('mode', 'ante');
    h.fire('Do');
    const expected = cores.computeBetMode(Object.assign({}, DEFAULTS, { betAmount: 10000, mode: 'ante', bonusBuyMultiplier: 100, direction: 'cost-to-base' }));
    OUTPUTS.forEach((name) => expect(h.out(name)).toEqual(expected[name]));
    expect(h.out('baseBet')).toBe(8000);
    expect(h.count('Done')).toBe(2);
  });
});
