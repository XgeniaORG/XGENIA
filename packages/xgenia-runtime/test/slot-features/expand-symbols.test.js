// Expand Symbols (slot feature 11): registry port mirror, client/core parity for every mode,
// minCount pass-through, fail-closed error contract.
'use strict';

const { defineFeature, mount } = require('./harness');
const cores = require('../../src/api/slot-feature-cores');

const ExpandSymbols = defineFeature('expand-symbols.js');

// slot-feature-node-converter.ts REGISTRY entry (+ Do / Done on the client)
const REGISTRY_INPUTS = ['reels', 'symbol', 'mode', 'replaceWith', 'minCount'];
const REGISTRY_OUTPUTS = ['reels', 'spans', 'anchors', 'expandedCount', 'changed'];

// reels[col][row]; symbol 7 lands at (row 1, col 1) and (row 2, col 3)
const GRID = [
  [1, 2, 3],
  [4, 7, 5],
  [6, 1, 2],
  [3, 4, 7],
  [5, 6, 1]
];

function expectParity(h, r) {
  for (const name of REGISTRY_OUTPUTS) expect(h.out(name)).toEqual(r[name]);
}

describe('Expand Symbols', () => {
  let errorSpy;
  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  test('module shape and metadata mirror the registry', () => {
    const mod = require('../../../../private/xgenia-pro-nodes/src/slot-games/features/expand-symbols.js');
    expect(Object.keys(mod)).toEqual(['node']);
    expect(mod.node.name).toBe('Expand Symbols');
    expect(mod.node.category).toBe('Math');
    expect(mod.node.color).toBe('math');
    expect(mod.node.docs).toBe('https://docsapp.xgenia.com/nodes/slot-features/expand-symbols');
    expect(typeof mod.node.description).toBe('string');
    expect(mod.node.description).toMatch(/Variable2/);
    expect(mod.node.description).toMatch(/pixi\.CellOverlay\.spans/);
    const inputs = Object.keys(ExpandSymbols.metadata.inputs).filter((n) => n !== 'functionScript');
    expect(inputs.sort()).toEqual(REGISTRY_INPUTS.concat(['Do']).sort());
    expect(Object.keys(ExpandSymbols.metadata.outputs).sort()).toEqual(REGISTRY_OUTPUTS.concat(['Done']).sort());
    expect(ExpandSymbols.metadata.inputs.Do.type.name).toBe('signal');
    expect(ExpandSymbols.metadata.outputs.Done.type).toBe('signal');
    expect(ExpandSymbols.metadata.outputs.changed.type).toBe('boolean');
    expect(ExpandSymbols.metadata.inputs.mode.type.name).toBe('enum');
    expect(ExpandSymbols.metadata.inputs.mode.type.enums.map((e) => e.value)).toEqual([
      'column', 'row', 'cross', 'block2x2', 'block3x3', 'cell'
    ]);
    expect(ExpandSymbols.metadata.inputs.mode.default).toBe('column');
    expect(ExpandSymbols.metadata.inputs.minCount.default).toBe(1);
  });

  test('Do: column mode equals a direct core call and fires Done once', async () => {
    const args = { reels: GRID, symbol: 7, mode: 'column', replaceWith: null, minCount: 1 };
    const h = await mount(ExpandSymbols, args);
    h.fire('Do');
    const r = cores.expandSymbols(args);
    expectParity(h, r);
    expect(h.out('reels')[1]).toEqual([7, 7, 7]);
    expect(h.out('reels')[3]).toEqual([7, 7, 7]);
    expect(h.out('anchors')).toEqual([[1, 1], [2, 3]]);
    expect(h.out('changed')).toBe(true);
    expect(h.count('Done')).toBe(1);
    expect(h.node.getInspectInfo().type).toBe('value');
  });

  test('every mode and replaceWith stay in parity with the core', async () => {
    for (const mode of ['row', 'cross', 'block2x2', 'block3x3', 'cell']) {
      const args = { reels: GRID, symbol: 7, mode, replaceWith: 9, minCount: 1 };
      const h = await mount(ExpandSymbols, args);
      h.fire('Do');
      expectParity(h, cores.expandSymbols(args));
      expect(h.out('spans').every((sp) => sp.symbol === 9)).toBe(true);
    }
  });

  test('minCount above the landed count passes the grid through unchanged', async () => {
    const args = { reels: GRID, symbol: 7, mode: 'column', replaceWith: null, minCount: 3 };
    const h = await mount(ExpandSymbols, args);
    h.fire('Do');
    expectParity(h, cores.expandSymbols(args));
    expect(h.out('reels')).toEqual(GRID);
    expect(h.out('changed')).toBe(false);
    expect(h.out('expandedCount')).toBe(0);
  });

  test('a grid set in the same update as Do is the grid expanded', async () => {
    const h = await mount(ExpandSymbols, { symbol: 7, mode: 'row' });
    h.node.queueInput('reels', GRID);
    h.node.queueInput('Do', true);
    h.node.queueInput('Do', false);
    h.ctx.update();
    expectParity(h, cores.expandSymbols({ reels: GRID, symbol: 7, mode: 'row', replaceWith: null, minCount: 1 }));
  });

  test('fails closed on a malformed grid: error logged + in inspect data, outputs empty, Done fires', async () => {
    const h = await mount(ExpandSymbols, { reels: [], symbol: 7 });
    h.fire('Do');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatch(/^\[Expand Symbols\] /);
    expect(h.node.getInspectInfo().value.error).toMatch(/reels must be a non-empty array/);
    expect(h.out('reels')).toEqual([]);
    expect(h.out('spans')).toEqual([]);
    expect(h.out('anchors')).toEqual([]);
    expect(h.out('expandedCount')).toBe(0);
    expect(h.out('changed')).toBe(false);
    expect(h.count('Done')).toBe(1);
  });
});
