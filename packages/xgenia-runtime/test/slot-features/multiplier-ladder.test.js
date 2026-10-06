// Multiplier Ladder (slot feature 3, stateful): registry port parity, the derived step rule
// (Do steps only with stepOnDo, the step signal always steps), two rounds + reset against a chained
// core, clamping at the top.
'use strict';

const fs = require('fs');
const path = require('path');
const { defineFeature, mount } = require('./harness');
const cores = require('../../src/api/slot-feature-cores');

const FILE = 'multiplier-ladder.js';
const NAME = 'Multiplier Ladder';
const Def = defineFeature(FILE);
const OUTPUTS = ['multiplier', 'index', 'atMax', 'changed', 'ladder'];

/** Registry defaults minus the signals. */
const DEFAULTS = { ladder: [1, 2, 3, 5], startIndex: 0, stepBy: 1, stepOnDo: false };

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

function coreArgs(params, flags) {
  const p = Object.assign({}, DEFAULTS, params);
  return {
    ladder: p.ladder, startIndex: p.startIndex, stepBy: p.stepBy,
    // registry derived rule: step = (step === true) || (stepOnDo === true)
    step: flags && flags.step !== undefined ? flags.step : p.stepOnDo === true,
    reset: flags && flags.reset === true
  };
}

function expectParity(h, expected) {
  OUTPUTS.forEach((name) => expect(h.out(name)).toEqual(expected[name]));
}

describe('Multiplier Ladder', () => {
  test('module shape, metadata and registry port parity', () => {
    const mod = require(path.resolve(__dirname, '../../../../private/xgenia-pro-nodes/src/slot-games/features', FILE));
    expect(Object.keys(mod)).toEqual(['node']);
    expect(mod.node.name).toBe(NAME);
    expect(mod.node.category).toBe('Math');
    expect(mod.node.docs).toBe('https://docsapp.xgenia.com/nodes/slot-features/multiplier-ladder');
    expect(typeof mod.node.description).toBe('string');
    expect(mod.node.description).toMatch(/identified players/);

    const spec = registryPorts(NAME);
    const inputs = Object.keys(Def.metadata.inputs).filter((n) => n !== 'functionScript');
    expect(inputs.sort()).toEqual(spec.inputs.concat(['Do']).sort());
    expect(Object.keys(Def.metadata.outputs).sort()).toEqual(spec.outputs.concat(['Done']).sort());
    ['step', 'reset', 'Do'].forEach((name) => expect(Def.metadata.inputs[name].type.name).toBe('signal'));
    expect(Def.metadata.outputs.Done.type).toBe('signal');
    expect(Def.metadata.outputs.atMax.type).toBe('boolean');
    Object.keys(DEFAULTS).forEach((name) => expect(Def.metadata.inputs[name].default).toEqual(DEFAULTS[name]));
  });

  test('Do without stepOnDo holds, step climbs, reset returns — each equal to the chained core', async () => {
    const params = { ladder: [1, 2, 3, 5], startIndex: 0, stepBy: 1 };
    const h = await mount(Def, params);
    let state = {};
    const step = (flags, extra) => {
      const r = cores.stepMultiplierLadder(state, coreArgs(Object.assign({}, params, extra || {}), flags));
      state = r.updatedState;
      return r;
    };

    h.fire('Do'); // round 1: no step
    expectParity(h, step(null));
    expect(h.out('multiplier')).toBe(1);
    expect(h.out('changed')).toBe(false);

    h.fire('step');
    expectParity(h, step({ step: true, reset: false }));
    expect(h.out('multiplier')).toBe(2);
    expect(h.out('changed')).toBe(true);

    h.fire('step');
    expectParity(h, step({ step: true, reset: false }));
    expect(h.out('index')).toBe(2);

    h.fire('Do'); // round 2: still holds at index 2
    expectParity(h, step(null));
    expect(h.out('index')).toBe(2);
    expect(h.out('changed')).toBe(false);

    h.fire('reset');
    expectParity(h, step({ step: false, reset: true }));
    expect(h.out('index')).toBe(0);
    expect(h.out('multiplier')).toBe(1);
    expect(h.out('changed')).toBe(true);

    h.set('stepOnDo', true);
    h.fire('Do'); // now Do steps
    expectParity(h, step(null, { stepOnDo: true }));
    expect(h.out('index')).toBe(1);

    h.set('stepBy', 5);
    h.fire('step'); // clamped at the top
    expectParity(h, step({ step: true, reset: false }, { stepOnDo: true, stepBy: 5 }));
    expect(h.out('index')).toBe(3);
    expect(h.out('multiplier')).toBe(5);
    expect(h.out('atMax')).toBe(true);

    h.fire('step'); // already at max: unchanged
    expectParity(h, step({ step: true, reset: false }, { stepOnDo: true, stepBy: 5 }));
    expect(h.out('changed')).toBe(false);

    expect(h.count('Done')).toBe(8);
    expect(h.node._internal.state).toEqual(state);
  });

  test('an empty ladder collapses to [1] exactly like the core', async () => {
    const params = { ladder: [] };
    const h = await mount(Def, params);
    h.fire('step');
    expectParity(h, cores.stepMultiplierLadder({}, coreArgs(params, { step: true, reset: false })));
    expect(h.out('ladder')).toEqual([1]);
    expect(h.out('atMax')).toBe(true);
  });
});
