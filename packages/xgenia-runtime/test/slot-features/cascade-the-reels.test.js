// Cascade The Reels (2026-10-02): the RGS compiler now runs slot-feature-cores.cascadeTheReels for this
// node (it had no server implementation, so every maths using it was refused by the RGS). The editor
// node keeps its own doCascade — it lives in the private repo and must keep working against older
// runtimes — so the two are held equal here: recorded goldens (30 boards: [row,col] and {row,col}
// positions, weighted and grid-derived refills, integer and fractional seeds, refill top and bottom)
// and the live node against the core on 500 random boards.
'use strict';
const path = require('path');
const { mount } = require('./harness');
const NodeDefinition = require('../../src/nodedefinition');
const cores = require('../../src/api/slot-feature-cores');
const goldens = require('./cascade-the-reels.goldens.json');

const nodeModule = require(path.resolve(__dirname, '../../../../private/xgenia-pro-nodes/src/slot-games/cascade-the-reels.js')).node;
// defineNode turns prototypeExtensions into property descriptors; keep the plain function first.
const doCascade = nodeModule.prototypeExtensions.doCascade.value || nodeModule.prototypeExtensions.doCascade;
const Def = NodeDefinition.defineNode(nodeModule);

describe('Cascade The Reels — the editor node and the RGS core agree', () => {
  test('the core reproduces every recorded output of the original node', () => {
    for (const g of goldens) {
      expect(cores.cascadeTheReels({ ...g.in, seeds: g.in.seeds }).reels).toEqual(g.out);
    }
  });

  test('the editor node produces them too, through its real ports', async () => {
    for (const g of goldens.slice(0, 8)) {
      const h = await mount(Def, { refillFrom: g.in.refillFrom });
      h.set('reels', g.in.reels);
      h.set('winningLinesDetails', g.in.winningLinesDetails);
      h.set('symbolWeights', g.in.symbolWeights);
      h.set('Seeds', g.in.seeds);
      h.fire('Do');
      expect(h.out('reels')).toEqual(g.out);
      expect(h.count('Done')).toBe(1);
    }
  });

  test('the editor node and the core agree on 500 random boards', async () => {
    let x = 4242;
    const rnd = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
    const ri = (n) => Math.floor(rnd() * n);
    for (let t = 0; t < 500; t++) {
      const cols = 3 + ri(5), rows = 3 + ri(4), syms = 2 + ri(9);
      const reels = Array.from({ length: cols }, () => Array.from({ length: rows }, () => 1 + ri(syms)));
      const wld = [{ positions: Array.from({ length: ri(8) }, () => (rnd() < 0.8 ? [ri(rows + 1), ri(cols + 1)] : { row: ri(rows), col: ri(cols) })) }];
      const weights = rnd() < 0.5 ? Array.from({ length: syms }, () => +(rnd() * 3 + 0.01).toFixed(3)) : [];
      const seeds = [rnd() < 0.5 ? ri(1e12) : rnd() * 1e12];
      const refillFrom = rnd() < 0.3 ? 'bottom' : 'top';
      const self = { _internal: { inputReels: reels, winningLinesDetails: wld, symbolWeights: weights, seeds, refillFrom }, flagOutputDirty() {}, sendSignalOnOutput() {} };
      doCascade.call(self);
      expect(cores.cascadeTheReels({ reels, winningLinesDetails: wld, symbolWeights: weights, seeds, refillFrom }).reels).toEqual(self._internal.outputReels);
    }
  });

  test('unseeded still fails closed: empty reels, Done fires', async () => {
    const h = await mount(Def, {});
    h.set('reels', [[1, 2, 3], [2, 3, 1]]);
    h.set('winningLinesDetails', [{ positions: [[0, 0]] }]);
    const err = console.error;
    console.error = () => {};
    try { h.fire('Do'); } finally { console.error = err; }
    expect(h.out('reels')).toEqual([]);
    expect(h.count('Done')).toBe(1);
    expect(() => cores.cascadeTheReels({ reels: [[1, 2]], winningLinesDetails: [], seeds: [] })).toThrow(/Seeds is required/);
  });
});
