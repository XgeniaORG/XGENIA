// Cluster Pays (slot feature 1): registry port parity, client == core for the same arguments,
// deferred Do, and the fail-closed error contract.
'use strict';

const fs = require('fs');
const path = require('path');
const { defineFeature, mount } = require('./harness');
const cores = require('../../src/api/slot-feature-cores');

const FILE = 'cluster-pays.js';
const NAME = 'Cluster Pays';
const Def = defineFeature(FILE);

/** Registry defaults (slot-feature-node-converter.ts) — the server substitutes these for unwired ports. */
const DEFAULTS = { reels: [], minClusterSize: 5, wildSymbol: 0, paytable: {}, betAmount: 100, adjacency: 'orthogonal', wildsCountTowardSize: true };

/** Port lists straight from the registry source: THE port spec the client must mirror. */
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

// reels[col][row]: symbol 2 forms a 6-cell orthogonal cluster, 3 and 4 form 3-cell clusters, 1 only 2 cells.
const GRID = [
  [2, 2, 1],
  [2, 5, 1],
  [2, 2, 3],
  [4, 2, 3],
  [4, 4, 3]
];
const PAYTABLE = { 2: { 5: 2, 6: 4, 8: 10 }, 3: { 3: 1 }, 4: { 3: 1 }, 1: { 2: 1 } };

let errorSpy;
beforeEach(() => {
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
});

describe('Cluster Pays', () => {
  test('module shape, metadata and registry port parity', () => {
    const mod = require(path.resolve(__dirname, '../../../../private/xgenia-pro-nodes/src/slot-games/features', FILE));
    expect(Object.keys(mod)).toEqual(['node']);
    expect(mod.node.name).toBe(NAME);
    expect(mod.node.category).toBe('Math');
    expect(mod.node.color).toBe('math');
    expect(mod.node.docs).toBe('https://docsapp.xgenia.com/nodes/slot-features/cluster-pays');
    expect(typeof mod.node.description).toBe('string');
    expect(Array.isArray(mod.node.searchTags)).toBe(true);

    const spec = registryPorts(NAME);
    const inputs = Object.keys(Def.metadata.inputs).filter((n) => n !== 'functionScript');
    expect(inputs.sort()).toEqual(spec.inputs.concat(['Do']).sort());
    expect(Object.keys(Def.metadata.outputs).sort()).toEqual(spec.outputs.concat(['Done']).sort());
    expect(Def.metadata.inputs.Do.type.name).toBe('signal');
    expect(Def.metadata.outputs.Done.type).toBe('signal');
    spec.outputs.forEach((name) => expect(Def.metadata.outputs[name].type).not.toBe('signal'));
    spec.inputs.forEach((name) => expect(Def.metadata.inputs[name].default).toEqual(DEFAULTS[name]));
  });

  test('Do computes exactly what the core computes (orthogonal)', async () => {
    const params = { reels: GRID, minClusterSize: 3, paytable: PAYTABLE, betAmount: 100 };
    const h = await mount(Def, params);
    h.fire('Do');
    const expected = cores.evaluateClusterPays(Object.assign({}, DEFAULTS, params));
    ['clusters', 'winningLinesDetails', 'clusterWinnings', 'clusterCount', 'hasWin', 'largestCluster'].forEach((name) =>
      expect(h.out(name)).toEqual(expected[name])
    );
    expect(h.out('hasWin')).toBe(true);
    expect(h.out('largestCluster')).toBe(6);
    expect(h.out('clusterWinnings')).toBeGreaterThan(0);
    expect(h.count('Done')).toBe(1);
    expect(h.node.getInspectInfo().type).toBe('value');
    expect(h.node.getInspectInfo().value.error).toBeUndefined();
  });

  test('diagonal adjacency with a wild that does not count toward the size', async () => {
    const params = { reels: GRID, minClusterSize: 3, paytable: PAYTABLE, betAmount: 250, wildSymbol: 5, adjacency: 'diagonal', wildsCountTowardSize: false };
    const h = await mount(Def, params);
    h.fire('Do');
    const expected = cores.evaluateClusterPays(Object.assign({}, DEFAULTS, params));
    ['clusters', 'winningLinesDetails', 'clusterWinnings', 'clusterCount', 'hasWin', 'largestCluster'].forEach((name) =>
      expect(h.out(name)).toEqual(expected[name])
    );
    // the wild at (1,1) joins the symbol-2 cluster but is not counted
    expect(expected.clusters[0].wilds).toBe(1);
    expect(expected.clusters[0].cells).toBe(expected.clusters[0].size + 1);
  });

  test('the reels set in the same update as Do are the ones evaluated', async () => {
    const h = await mount(Def, { minClusterSize: 3, paytable: PAYTABLE });
    h.node.queueInput('reels', GRID);
    h.node.queueInput('Do', true);
    h.node.queueInput('Do', false);
    h.ctx.update();
    expect(h.out('clusterCount')).toBe(cores.evaluateClusterPays(Object.assign({}, DEFAULTS, { reels: GRID, minClusterSize: 3, paytable: PAYTABLE })).clusterCount);
    expect(h.count('Done')).toBe(1);
  });

  test('fails closed on a bad grid: console.error, inspect error, empty outputs, Done still fires', async () => {
    const h = await mount(Def, { minClusterSize: 3, paytable: PAYTABLE });
    h.fire('Do'); // reels is the default []
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatch(/^\[Cluster Pays\] reels must be a non-empty array/);
    expect(errorSpy.mock.calls[0][0]).not.toMatch(/\[Cluster Pays\] \[Cluster Pays\]/);
    expect(h.node.getInspectInfo().value.error).toMatch(/reels must be a non-empty array/);
    expect(h.out('clusters')).toEqual([]);
    expect(h.out('winningLinesDetails')).toEqual([]);
    expect(h.out('clusterWinnings')).toBe(0);
    expect(h.out('clusterCount')).toBe(0);
    expect(h.out('hasWin')).toBe(false);
    expect(h.out('largestCluster')).toBe(0);
    expect(h.count('Done')).toBe(1);

    // a later good grid recovers
    h.set('reels', GRID);
    h.fire('Do');
    expect(h.out('hasWin')).toBe(true);
    expect(h.count('Done')).toBe(2);
  });
});
