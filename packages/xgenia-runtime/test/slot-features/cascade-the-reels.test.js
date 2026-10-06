// Cascade The Reels (2026-10-02): the RGS compiler now runs slot-feature-cores.cascadeTheReels for this
// node (it had no server implementation, so every maths using it was refused by the RGS). The editor
// node keeps its own doCascade — it lives in the private repo and must keep working against older
// runtimes — so the two are held equal here: goldens (30 boards: [row,col] and {row,col} positions,
// weighted and grid-derived refills, editor-integer and RGS-float seeds, refill top and bottom) and the
// live node against the core on 500 random boards.
//
// (2026-10-04, certification) The refill no longer runs ONE LCG stream from Seeds[0]: cell k in refill
// order takes Seeds[k] alone, scaled as base[floor(v * n / 1e12)], and too few values fail closed. The
// goldens were regenerated for that rule by cascade-the-reels.goldens.gen.js, whose outputs come from a
// plain reference of the rule, not from either copy (see that file).
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

/** Run the editor node's doCascade on plain inputs; returns { reels, error }. */
function runNode(input) {
  const self = {
    _internal: { inputReels: input.reels, winningLinesDetails: input.winningLinesDetails || [], symbolWeights: input.symbolWeights || [], seeds: input.seeds, refillFrom: input.refillFrom || 'top' },
    flagOutputDirty() {},
    sendSignalOnOutput() {}
  };
  const err = console.error;
  console.error = () => {};
  try { doCascade.call(self); } finally { console.error = err; }
  return { reels: self._internal.outputReels, error: self._internal.inspectData && self._internal.inspectData.error };
}

/** Run the RGS core; returns { reels, error } the same way. */
function runCore(input) {
  try { return { reels: cores.cascadeTheReels(input).reels, error: undefined }; } catch (e) { return { reels: [], error: e.message }; }
}

describe('Cascade The Reels — the editor node and the RGS core agree', () => {
  test('the core reproduces every golden', () => {
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
    for (const g of goldens) expect(runNode(g.in)).toEqual({ reels: g.out, error: undefined });
  });

  test('the editor node and the core agree on 500 random boards', async () => {
    let x = 4242;
    const rnd = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
    const ri = (n) => Math.floor(rnd() * n);
    let refused = 0;
    for (let t = 0; t < 500; t++) {
      const cols = 3 + ri(5), rows = 3 + ri(4), syms = 2 + ri(9);
      const reels = Array.from({ length: cols }, () => Array.from({ length: rows }, () => 1 + ri(syms)));
      const wld = [{ positions: Array.from({ length: ri(8) }, () => (rnd() < 0.8 ? [ri(rows + 1), ri(cols + 1)] : { row: ri(rows), col: ri(cols) })) }];
      const weights = rnd() < 0.5 ? Array.from({ length: syms }, () => +(rnd() * 3 + 0.01).toFixed(3)) : [];
      // ISAAC sized rows x columns (editor integers or RGS floats); one board in ten gets a short array.
      const asFloat = rnd() < 0.5;
      const size = rnd() < 0.1 ? 1 + ri(3) : rows * cols;
      const seeds = Array.from({ length: size }, () => (asFloat ? rnd() * 1e12 : ri(1e12)));
      const refillFrom = rnd() < 0.3 ? 'bottom' : 'top';
      const input = { reels, winningLinesDetails: wld, symbolWeights: weights, seeds, refillFrom };
      const node = runNode(input);
      const core = runCore(input);
      expect(core).toEqual(node);
      if (node.error) refused++;
    }
    expect(refused).toBeGreaterThan(0); // the short arrays really were exercised
    expect(refused).toBeLessThan(100);
  });

  test('each refilled cell takes its own Seeds value, in refill order', () => {
    // Grid-derived base [1, 2, 3, 4]: a value v picks base[floor(v * 4 / 1e12)].
    const reels = [[1, 2, 3], [4, 1, 2]];
    const clearAll = [{ positions: [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]] }];
    const q = (i) => i * 2.5e11 + 1; // lands in quarter i
    const seeds = [q(3), q(2), q(1), q(0), q(3), q(1)];
    const top = { reels, winningLinesDetails: clearAll, seeds, refillFrom: 'top' };
    expect(runCore(top).reels).toEqual([[4, 3, 2], [1, 4, 2]]);
    expect(runNode(top).reels).toEqual([[4, 3, 2], [1, 4, 2]]);
    // Changing one value changes exactly one cell: no value feeds another cell.
    const moved = seeds.slice();
    moved[4] = q(0);
    expect(runCore({ ...top, seeds: moved }).reels).toEqual([[4, 3, 2], [1, 1, 2]]);
    // Bottom refill: column 0 takes Seeds[0] under its survivors; column 1 keeps its survivor (row 0)
    // on top and takes Seeds[1], Seeds[2] beneath it, in that order.
    const bottom = { reels, winningLinesDetails: [{ positions: [[0, 0], [1, 1], [2, 1]] }], seeds, refillFrom: 'bottom' };
    expect(runCore(bottom).reels).toEqual([[2, 3, 4], [4, 3, 2]]);
    expect(runNode(bottom).reels).toEqual([[2, 3, 4], [4, 3, 2]]);
  });

  test('symbolWeights keep their meaning: symbol i fills ceil(w_i / min w) slots of the base', () => {
    // weights [1, 3] -> base [1, 2, 2, 2]: v in [0, 2.5e11) -> 1, else 2.
    const reels = [[1, 1]];
    const wld = [{ positions: [[0, 0], [1, 0]] }];
    const r = runCore({ reels, winningLinesDetails: wld, symbolWeights: [1, 3], seeds: [2.5e11 - 1, 2.5e11], refillFrom: 'top' });
    expect(r.reels).toEqual([[1, 2]]);
    expect(runNode({ reels, winningLinesDetails: wld, symbolWeights: [1, 3], seeds: [2.5e11 - 1, 2.5e11] }).reels).toEqual([[1, 2]]);
  });

  test('fewer Seeds values than cells to refill fails closed, never reuses a value', async () => {
    const input = { reels: [[1, 2, 3], [2, 3, 1]], winningLinesDetails: [{ positions: [[0, 0], [1, 0], [2, 1]] }], seeds: [1e11, 2e11] };
    const node = runNode(input);
    const core = runCore(input);
    expect(node.reels).toEqual([]);
    expect(node.error).toBe('[Cascade The Reels] Seeds has 2 values but 3 cells need refilling: every refilled cell takes its own Seeds value and none is reused. Set the ISAAC Random Number Array Generator feeding Seeds (RP_PassISAAC or RP_RefillISAAC when the round player built it) to size >= rows x columns (3 x 2 = 6).');
    expect(core.error).toBe(node.error);
    // Through the real ports: empty reels, Done still fires.
    const h = await mount(Def, {});
    h.set('reels', input.reels);
    h.set('winningLinesDetails', input.winningLinesDetails);
    h.set('Seeds', input.seeds);
    const err = console.error;
    console.error = () => {};
    try { h.fire('Do'); } finally { console.error = err; }
    expect(h.out('reels')).toEqual([]);
    expect(h.count('Done')).toBe(1);
    // Exactly enough is fine, and a pass that clears nothing needs no values beyond the one that proves it is seeded.
    expect(runCore({ ...input, seeds: [1e11, 2e11, 3e11] }).error).toBeUndefined();
    expect(runCore({ ...input, winningLinesDetails: [], seeds: [5] }).reels).toEqual(input.reels);
  });

  test('a value that is not ISAAC output is refused, not scaled', () => {
    const base = { reels: [[1, 2], [2, 1]], winningLinesDetails: [{ positions: [[0, 0], [0, 1]] }] };
    for (const bad of [0.42, -1, 1e12, 2e12, NaN, '5', null]) {
      const input = { ...base, seeds: [1e11, bad] };
      const node = runNode(input);
      expect(node.error).toMatch(/^\[Cascade The Reels\] Seeds\[1\] = .* is not an ISAAC Random Number Array Generator value/);
      expect(runCore(input).error).toBe(node.error);
    }
    // 0 and 1e12 - 1 are inside the range; the top edge maps to the last symbol, never past it.
    expect(runCore({ ...base, seeds: [0, 1e12 - 1] }).reels).toEqual([[1, 2], [2, 1]]);
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
