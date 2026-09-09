// Sticky Symbols (slot feature 10, stateful): registry port parity, the derived capture rule
// (Do captures when captureOnDo, the capture signal always captures), two rounds + reset against a
// chained core, duration ageing, replaceWith, and the fail-closed contract that keeps the stickies.
'use strict';

const fs = require('fs');
const path = require('path');
const { defineFeature, mount } = require('./harness');
const cores = require('../../src/api/slot-feature-cores');

const FILE = 'sticky-symbols.js';
const NAME = 'Sticky Symbols';
const Def = defineFeature(FILE);
const OUTPUTS = ['reels', 'stickyPositions', 'stickyCount', 'changed'];

/** Registry defaults minus the signals. */
const DEFAULTS = { reels: [], stickySymbol: 0, replaceWith: null, duration: 0, captureOnDo: true, tick: true };

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
    reels: p.reels, stickySymbol: p.stickySymbol, replaceWith: p.replaceWith, duration: p.duration,
    // registry derived rule: capture = (capture === true) || (captureOnDo !== false)
    capture: flags && flags.capture !== undefined ? flags.capture : p.captureOnDo !== false,
    tick: p.tick,
    reset: flags && flags.reset === true
  };
}

// reels[col][row]; 7 = the sticky symbol
const SPIN_1 = [
  [1, 7, 3],
  [2, 2, 7],
  [4, 4, 1],
  [7, 2, 1],
  [3, 2, 5]
];
const SPIN_2 = [
  [2, 1, 1],
  [3, 3, 2],
  [1, 4, 4],
  [2, 5, 1],
  [7, 1, 2]
];
const SPIN_3 = [
  [5, 5, 5],
  [4, 4, 4],
  [3, 3, 3],
  [2, 2, 2],
  [1, 1, 1]
];

let errorSpy;
beforeEach(() => {
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
});

function expectParity(h, expected) {
  OUTPUTS.forEach((name) => expect(h.out(name)).toEqual(expected[name]));
}

describe('Sticky Symbols', () => {
  test('module shape, metadata and registry port parity', () => {
    const mod = require(path.resolve(__dirname, '../../../../private/xgenia-pro-nodes/src/slot-games/features', FILE));
    expect(Object.keys(mod)).toEqual(['node']);
    expect(mod.node.name).toBe(NAME);
    expect(mod.node.category).toBe('Math');
    expect(mod.node.docs).toBe('https://docsapp.xgenia.com/nodes/slot-features/sticky-symbols');
    expect(typeof mod.node.description).toBe('string');
    expect(mod.node.description).toMatch(/identified players/);
    expect(mod.node.description).toMatch(/pixi\.CellOverlay\.cells/);

    const spec = registryPorts(NAME);
    const inputs = Object.keys(Def.metadata.inputs).filter((n) => n !== 'functionScript');
    expect(inputs.sort()).toEqual(spec.inputs.concat(['Do']).sort());
    expect(Object.keys(Def.metadata.outputs).sort()).toEqual(spec.outputs.concat(['Done']).sort());
    ['capture', 'reset', 'Do'].forEach((name) => expect(Def.metadata.inputs[name].type.name).toBe('signal'));
    expect(Def.metadata.inputs.tick.type).toBe('boolean'); // data, not a signal
    expect(Def.metadata.outputs.Done.type).toBe('signal');
    expect(Def.metadata.outputs.changed.type).toBe('boolean');
    Object.keys(DEFAULTS).forEach((name) => expect(Def.metadata.inputs[name].default).toEqual(DEFAULTS[name]));
  });

  test('two spins with captureOnDo then a reset — each equal to the chained core', async () => {
    const params = { reels: SPIN_1, stickySymbol: 7 }; // duration 0 = until reset
    const h = await mount(Def, params);
    let state = {};
    const step = (p, flags) => {
      const r = cores.applyStickySymbols(state, coreArgs(p, flags));
      state = r.updatedState;
      return r;
    };

    h.fire('Do'); // spin 1: capture the three 7s
    let expected = step(params, null);
    expectParity(h, expected);
    expect(h.out('stickyPositions')).toEqual([[1, 0], [2, 1], [0, 3]]);
    expect(h.out('stickyCount')).toBe(3);
    expect(h.out('changed')).toBe(true);
    expect(h.out('reels')).toEqual(SPIN_1);

    h.set('reels', SPIN_2);
    h.fire('Do'); // spin 2: the three stickies are merged back in, the new 7 at (0,4) is captured
    expected = step(Object.assign({}, params, { reels: SPIN_2 }), null);
    expectParity(h, expected);
    expect(h.out('stickyCount')).toBe(4);
    expect(h.out('reels')[0][1]).toBe(7);
    expect(h.out('reels')[1][2]).toBe(7);
    expect(h.out('reels')[3][0]).toBe(7);
    expect(h.out('reels')[4][0]).toBe(7);
    expect(SPIN_2[0][1]).toBe(1); // the input grid is not mutated

    h.fire('reset'); // reset: stickies cleared, the grid passes through
    expected = step(Object.assign({}, params, { reels: SPIN_2 }), { capture: false, reset: true });
    expectParity(h, expected);
    expect(h.out('stickyCount')).toBe(0);
    expect(h.out('changed')).toBe(true);
    expect(h.out('reels')).toEqual(SPIN_2);

    h.set('reels', SPIN_3);
    h.fire('Do'); // nothing to capture, nothing remembered
    expected = step(Object.assign({}, params, { reels: SPIN_3 }), null);
    expectParity(h, expected);
    expect(h.out('stickyCount')).toBe(0);
    expect(h.out('changed')).toBe(false);

    expect(h.count('Done')).toBe(4);
    expect(h.node._internal.state).toEqual(state);
  });

  test('captureOnDo false: Do only merges/ages, the capture signal captures; duration ages them out; replaceWith', async () => {
    const params = { reels: SPIN_1, stickySymbol: 7, captureOnDo: false, duration: 2, replaceWith: 9 };
    const h = await mount(Def, params);
    let state = {};
    const step = (p, flags) => {
      const r = cores.applyStickySymbols(state, coreArgs(p, flags));
      state = r.updatedState;
      return r;
    };

    h.fire('Do'); // no capture
    expectParity(h, step(params, null));
    expect(h.out('stickyCount')).toBe(0);

    h.fire('capture'); // captures the three 7s with ttl 2
    expectParity(h, step(params, { capture: true, reset: false }));
    expect(h.out('stickyCount')).toBe(3);

    h.set('reels', SPIN_3);
    h.fire('Do'); // merged as 9 (replaceWith), aged to ttl 1
    expectParity(h, step(Object.assign({}, params, { reels: SPIN_3 }), null));
    expect(h.out('stickyCount')).toBe(3);
    expect(h.out('reels')[0][1]).toBe(9);
    expect(h.out('reels')[1][2]).toBe(9);
    expect(h.out('reels')[3][0]).toBe(9);

    h.fire('Do'); // merged once more, aged to ttl 0 -> gone
    expectParity(h, step(Object.assign({}, params, { reels: SPIN_3 }), null));
    expect(h.out('stickyCount')).toBe(0);
    expect(h.out('reels')[0][1]).toBe(9);

    h.fire('Do'); // nothing left
    expectParity(h, step(Object.assign({}, params, { reels: SPIN_3 }), null));
    expect(h.out('reels')).toEqual(SPIN_3);
    expect(h.out('changed')).toBe(false);
    expect(h.count('Done')).toBe(5);
  });

  test('fails closed on a bad grid and KEEPS the stickies for the next good spin', async () => {
    const params = { reels: SPIN_1, stickySymbol: 7 };
    const h = await mount(Def, params);
    h.fire('Do');
    expect(h.out('stickyCount')).toBe(3);
    const stateBefore = JSON.parse(JSON.stringify(h.node._internal.state));

    h.set('reels', [[1, 2, 3], [1, 2]]); // not rectangular
    h.fire('Do');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatch(/^\[Sticky Symbols\] reels must be rectangular/);
    expect(h.node.getInspectInfo().value.error).toMatch(/rectangular/);
    expect(h.out('reels')).toEqual([]);
    expect(h.out('stickyPositions')).toEqual([]);
    expect(h.out('stickyCount')).toBe(0);
    expect(h.out('changed')).toBe(false);
    expect(h.count('Done')).toBe(2);
    expect(h.node._internal.state).toEqual(stateBefore);

    h.set('reels', SPIN_3);
    h.fire('Do'); // the stickies are still there
    const expected = cores.applyStickySymbols(stateBefore, coreArgs(Object.assign({}, params, { reels: SPIN_3 }), null));
    expectParity(h, expected);
    expect(h.out('stickyCount')).toBe(3);
    expect(h.count('Done')).toBe(3);
  });
});
