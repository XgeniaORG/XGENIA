// Progressive Meter (slot feature 2, stateful): registry port parity, the derived add rule
// (Do adds when addOnDo, the add signal always adds, reset never adds), two rounds + reset against a
// chained core, setValue, and the state kept across evaluations.
'use strict';

const fs = require('fs');
const path = require('path');
const { defineFeature, mount } = require('./harness');
const cores = require('../../src/api/slot-feature-cores');

const FILE = 'progressive-meter.js';
const NAME = 'Progressive Meter';
const Def = defineFeature(FILE);
const OUTPUTS = ['value', 'progress', 'filled', 'fillCount', 'remaining'];

/** Registry defaults minus the signals. */
const DEFAULTS = { increment: 1, target: 100, startValue: 0, resetOnFill: true, carryOverflow: true, setValue: null, addOnDo: true };

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

/** The server-side argument set for one evaluation: params over defaults, plus the signal flags. */
function coreArgs(params, flags) {
  const p = Object.assign({}, DEFAULTS, params);
  return {
    increment: p.increment, target: p.target, startValue: p.startValue, resetOnFill: p.resetOnFill,
    carryOverflow: p.carryOverflow, setValue: p.setValue,
    // registry derived rule: add = (add === true) || (addOnDo !== false)
    add: flags && flags.add !== undefined ? flags.add : p.addOnDo !== false,
    reset: flags && flags.reset === true
  };
}

function expectParity(h, expected) {
  OUTPUTS.forEach((name) => expect(h.out(name)).toEqual(expected[name]));
}

describe('Progressive Meter', () => {
  test('module shape, metadata and registry port parity', () => {
    const mod = require(path.resolve(__dirname, '../../../../private/xgenia-pro-nodes/src/slot-games/features', FILE));
    expect(Object.keys(mod)).toEqual(['node']);
    expect(mod.node.name).toBe(NAME);
    expect(mod.node.category).toBe('Math');
    expect(mod.node.docs).toBe('https://docsapp.xgenia.com/nodes/slot-features/progressive-meter');
    expect(typeof mod.node.description).toBe('string');
    expect(mod.node.description).toMatch(/identified players/);

    const spec = registryPorts(NAME);
    const inputs = Object.keys(Def.metadata.inputs).filter((n) => n !== 'functionScript');
    expect(inputs.sort()).toEqual(spec.inputs.concat(['Do']).sort());
    expect(Object.keys(Def.metadata.outputs).sort()).toEqual(spec.outputs.concat(['Done']).sort());
    ['add', 'reset', 'Do'].forEach((name) => expect(Def.metadata.inputs[name].type.name).toBe('signal'));
    expect(Def.metadata.outputs.Done.type).toBe('signal');
    expect(Def.metadata.outputs.filled.type).toBe('boolean');
    Object.keys(DEFAULTS).forEach((name) => expect(Def.metadata.inputs[name].default).toEqual(DEFAULTS[name]));
  });

  test('two rounds, an add, a fill with carry, and a reset — each equal to the chained core', async () => {
    const params = { increment: 30, target: 100, startValue: 0 };
    const h = await mount(Def, params);
    let state = {};
    const step = (flags) => {
      const r = cores.applyProgressiveMeter(state, coreArgs(params, flags));
      state = r.updatedState;
      return r;
    };

    h.fire('Do'); // round 1: addOnDo -> +30
    let expected = step(null);
    expectParity(h, expected);
    expect(h.out('value')).toBe(30);
    expect(h.out('filled')).toBe(false);

    h.fire('Do'); // round 2 -> 60
    expected = step(null);
    expectParity(h, expected);
    expect(h.out('value')).toBe(60);

    h.fire('add'); // the add signal -> 90
    expected = step({ add: true, reset: false });
    expectParity(h, expected);
    expect(h.out('value')).toBe(90);

    h.fire('Do'); // round 3 -> 120 >= 100: filled, wraps to 20 with the overflow carried
    expected = step(null);
    expectParity(h, expected);
    expect(h.out('filled')).toBe(true);
    expect(h.out('fillCount')).toBe(1);
    expect(h.out('value')).toBe(20);
    expect(h.out('remaining')).toBe(80);

    h.fire('reset'); // reset: back to startValue, no add, fillCount kept
    expected = step({ add: false, reset: true });
    expectParity(h, expected);
    expect(h.out('value')).toBe(0);
    expect(h.out('fillCount')).toBe(1);
    expect(h.out('filled')).toBe(false);

    expect(h.count('Done')).toBe(5);
    expect(h.node._internal.state).toEqual(state);
    expect(h.node.getInspectInfo().value.state).toEqual(state);
  });

  test('addOnDo false: Do does not add, only the add signal does; setValue overwrites first', async () => {
    const params = { increment: 5, target: 50, addOnDo: false };
    const h = await mount(Def, params);
    let state = {};
    const step = (flags, extra) => {
      const r = cores.applyProgressiveMeter(state, coreArgs(Object.assign({}, params, extra || {}), flags));
      state = r.updatedState;
      return r;
    };

    h.fire('Do');
    expectParity(h, step(null));
    expect(h.out('value')).toBe(0);

    h.fire('add');
    expectParity(h, step({ add: true, reset: false }));
    expect(h.out('value')).toBe(5);

    h.set('setValue', 42);
    h.fire('Do');
    expectParity(h, step(null, { setValue: 42 }));
    expect(h.out('value')).toBe(42);

    h.fire('add'); // 42 + 5 = 47
    expectParity(h, step({ add: true, reset: false }, { setValue: 42 }));
    expect(h.out('value')).toBe(47);
    expect(h.count('Done')).toBe(4);
  });

  test('before the first evaluation the outputs are the safe empties', async () => {
    const h = await mount(Def, {});
    expect(h.out('value')).toBe(0);
    expect(h.out('progress')).toBe(0);
    expect(h.out('filled')).toBe(false);
    expect(h.out('fillCount')).toBe(0);
    expect(h.out('remaining')).toBe(0);
    expect(h.node.getInspectInfo()).toEqual({ type: 'text', value: '[Not executed yet]' });
  });
});
