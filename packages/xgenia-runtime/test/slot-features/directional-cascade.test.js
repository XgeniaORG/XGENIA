// Directional Cascade (slot feature 16, seeded): registry port mirror, client/core parity for
// all four directions, the no-removal pass-through, the unseeded fail-closed contract, and the
// parity claim with the legacy Cascade The Reels node for direction 'down'.
'use strict';

const path = require('path');
const { defineFeature, mount } = require('./harness');
const NodeDefinition = require('../../src/nodedefinition');
const cores = require('@xgenia/runtime/src/api/slot-feature-cores');

const DirectionalCascade = defineFeature('directional-cascade.js');
const CascadeTheReels = NodeDefinition.defineNode(
  require(path.resolve(__dirname, '../../../../private/xgenia-pro-nodes/src/slot-games/cascade-the-reels.js')).node
);

const REGISTRY_INPUTS = ['reels', 'winningLinesDetails', 'symbolWeights', 'direction', 'Seeds'];
const REGISTRY_OUTPUTS = ['reels', 'removedPositions', 'removedCount', 'hadRemoval', 'direction'];

// reels[col][row]
const GRID = [
  [1, 2, 3],
  [1, 4, 5],
  [1, 6, 2],
  [3, 4, 5],
  [5, 6, 1]
];
// Calculate Winnings shape: row 0 across columns 0..2 pays, plus one duplicate and one cell in column 3
const WINS = [
  { line: 1, symbols: [1, 1, 1], positions: [[0, 0], [0, 1], [0, 2]], payout: 40 },
  { line: 2, symbols: [1, 3], positions: [[0, 2], [0, 3]], payout: 0 }
];
const WEIGHTS = [10, 8, 6, 4, 2, 1];
const SEEDS = [987654321098, 123456789012];

function args(overrides) {
  return Object.assign({ reels: GRID, winningLinesDetails: WINS, symbolWeights: WEIGHTS, direction: 'down', seeds: SEEDS }, overrides || {});
}

function expectParity(h, r) {
  for (const name of REGISTRY_OUTPUTS) expect(h.out(name)).toEqual(r[name]);
}

describe('Directional Cascade', () => {
  let errorSpy;
  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  test('module shape and metadata mirror the registry', () => {
    const mod = require('../../../../private/xgenia-pro-nodes/src/slot-games/features/directional-cascade.js');
    expect(Object.keys(mod)).toEqual(['node']);
    expect(mod.node.name).toBe('Directional Cascade');
    expect(mod.node.category).toBe('Math');
    expect(mod.node.color).toBe('math');
    expect(mod.node.docs).toBe('https://docsapp.xgenia.com/nodes/slot-features/directional-cascade');
    expect(typeof mod.node.description).toBe('string');
    expect(mod.node.description).toMatch(/Multiplier Ladder\.step/);
    expect(mod.node.description).toMatch(/Calculate Winnings\.winningLinesDetails/);
    expect(mod.node.description).toMatch(/Variable2/);
    const inputs = Object.keys(DirectionalCascade.metadata.inputs).filter((n) => n !== 'functionScript');
    expect(inputs.sort()).toEqual(REGISTRY_INPUTS.concat(['Do']).sort());
    expect(Object.keys(DirectionalCascade.metadata.outputs).sort()).toEqual(REGISTRY_OUTPUTS.concat(['Done']).sort());
    expect(DirectionalCascade.metadata.inputs.Do.type.name).toBe('signal');
    expect(DirectionalCascade.metadata.inputs.direction.type.name).toBe('enum');
    expect(DirectionalCascade.metadata.inputs.direction.type.enums.map((e) => e.value)).toEqual(['down', 'up', 'left', 'right']);
    expect(DirectionalCascade.metadata.inputs.direction.default).toBe('down');
    expect(DirectionalCascade.metadata.outputs.Done.type).toBe('signal');
    expect(DirectionalCascade.metadata.outputs.hadRemoval.type).toBe('boolean');
    expect(DirectionalCascade.metadata.outputs.direction.type).toBe('string');
  });

  test('Do with direction down equals the core: cleared cells, survivors below, refill on top', async () => {
    const h = await mount(DirectionalCascade, { reels: GRID, winningLinesDetails: WINS, symbolWeights: WEIGHTS, direction: 'down', Seeds: SEEDS });
    h.fire('Do');
    const r = cores.cascadeDirectional(args());
    expectParity(h, r);
    expect(h.out('removedPositions')).toEqual([[0, 0], [0, 1], [0, 2], [0, 3]]);
    expect(h.out('removedCount')).toBe(4);
    expect(h.out('hadRemoval')).toBe(true);
    for (const c of [0, 1, 2, 3]) {
      expect(h.out('reels')[c][1]).toBe(GRID[c][1]);
      expect(h.out('reels')[c][2]).toBe(GRID[c][2]);
      expect(h.out('reels')[c][0]).toBeGreaterThanOrEqual(1);
      expect(h.out('reels')[c][0]).toBeLessThanOrEqual(WEIGHTS.length);
    }
    expect(h.out('reels')[4]).toEqual(GRID[4]);
    expect(h.count('Done')).toBe(1);
  });

  test('up, left and right stay in parity with the core', async () => {
    for (const direction of ['up', 'left', 'right']) {
      const h = await mount(DirectionalCascade, { reels: GRID, winningLinesDetails: WINS, symbolWeights: WEIGHTS, direction, Seeds: SEEDS });
      h.fire('Do');
      expectParity(h, cores.cascadeDirectional(args({ direction })));
      expect(h.out('direction')).toBe(direction);
      expect(h.out('hadRemoval')).toBe(true);
    }
  });

  test('nothing to clear: the grid passes through, no seed is needed, hadRemoval is false', async () => {
    const h = await mount(DirectionalCascade, { reels: GRID, winningLinesDetails: [], symbolWeights: WEIGHTS, direction: 'left' });
    h.fire('Do');
    expectParity(h, cores.cascadeDirectional(args({ winningLinesDetails: [], direction: 'left', seeds: [] })));
    expect(h.out('reels')).toEqual(GRID);
    expect(h.out('hadRemoval')).toBe(false);
    expect(h.out('removedCount')).toBe(0);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(h.count('Done')).toBe(1);
  });

  test('unseeded with cells to clear fails closed: error logged + in inspect data, outputs empty, Done fires', async () => {
    const h = await mount(DirectionalCascade, { reels: GRID, winningLinesDetails: WINS, symbolWeights: WEIGHTS });
    h.fire('Do');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatch(/^\[Directional Cascade\] Seeds is required/);
    expect(h.node.getInspectInfo().value.error).toMatch(/Seeds is required/);
    expect(h.out('reels')).toEqual([]);
    expect(h.out('removedPositions')).toEqual([]);
    expect(h.out('removedCount')).toBe(0);
    expect(h.out('hadRemoval')).toBe(false);
    expect(h.out('direction')).toBe('');
    expect(h.count('Done')).toBe(1);
  });

  test('PARITY WITH THE LEGACY NODE: direction down reproduces Cascade The Reels exactly', async () => {
    // weighted refill alphabet
    const a = await mount(DirectionalCascade, { reels: GRID, winningLinesDetails: WINS, symbolWeights: WEIGHTS, direction: 'down', Seeds: SEEDS });
    const b = await mount(CascadeTheReels, { reels: GRID, winningLinesDetails: WINS, symbolWeights: WEIGHTS, Seeds: SEEDS });
    a.fire('Do');
    b.fire('Do');
    expect(b.out('reels').length).toBe(GRID.length);
    expect(a.out('reels')).toEqual(b.out('reels'));
    expect(a.count('Done')).toBe(1);
    expect(b.count('Done')).toBe(1);

    // alphabet inferred from the grid (no symbolWeights), a different seed and a bigger clear
    const wins2 = [{ positions: [[2, 0], [1, 0], [0, 4], [1, 4], [2, 2]] }];
    const seeds2 = [31415926535];
    const c = await mount(DirectionalCascade, { reels: GRID, winningLinesDetails: wins2, symbolWeights: [], direction: 'down', Seeds: seeds2 });
    const d = await mount(CascadeTheReels, { reels: GRID, winningLinesDetails: wins2, symbolWeights: [], Seeds: seeds2 });
    c.fire('Do');
    d.fire('Do');
    expect(d.out('reels').length).toBe(GRID.length);
    expect(c.out('reels')).toEqual(d.out('reels'));
    expect(c.out('reels')).toEqual(cores.cascadeDirectional({ reels: GRID, winningLinesDetails: wins2, symbolWeights: [], direction: 'down', seeds: seeds2 }).reels);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
