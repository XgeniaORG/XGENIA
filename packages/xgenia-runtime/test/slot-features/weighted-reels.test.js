// Weighted Reels (2026-10-04, certification): every random outcome takes its OWN Seeds value, scaled
// straight to the outcome as floor(v * n / 1e12) — it used to run a Park-Miller LCG seeded by one value
// (static: one LCG step of Seeds[idx]; static free-spin: two steps of Seeds[idx]; dynamic: one LCG per
// column, stepped once per row). Too few values, or a value that is not ISAAC output, fails closed.
//
// The editor node lives in the private repo (xgenia-pro-nodes/src/slot-games/weighted-reels.js) and,
// since 2026-10-04, runs src/api/slot-game-cores.js weightedReels — the function the RGS compiler embeds
// (src/api/test-slot-game-parity.ts and test-slot-feature-parity.ts run the compiled script in the real
// XRGS sandbox against this same node). Here the node is held to `reference` below — the rules written
// as plainly as possible, from the rule and not from the core — on fixed cases and 600 random ones,
// through its real ports for a few.
// There are no recorded goldens for this node (there were none before either): the reference IS the
// expected output.
'use strict';
const path = require('path');
const { mount } = require('./harness');
const NodeDefinition = require('../../src/nodedefinition');

const nodeModule = require(path.resolve(__dirname, '../../../../private/xgenia-pro-nodes/src/slot-games/weighted-reels.js')).node;
// defineNode turns prototypeExtensions into property descriptors; keep the plain functions first.
const METHODS = Object.fromEntries(
  Object.entries(nodeModule.prototypeExtensions).map(([k, f]) => [k, typeof f === 'function' ? f : f.value]),
);
const Def = NodeDefinition.defineNode(nodeModule);

const R = 1e12;
const scaled = (v, n) => Math.min(n - 1, Math.floor((v * n) / R));
const mod = (a, n) => ((a % n) + n) % n;

/** The rules, plainly. mode: static | static-free-spin | dynamic | dynamic-free-spin. */
function reference(mode, a) {
  const { reelStrips, seeds, rowSize } = a;
  const N = reelStrips.length;
  const isIsaac = (v) => typeof v === 'number' && v >= 0 && v < R && !(v > 0 && v < 1);
  const need = (n) => {
    if (seeds.length < n) throw new Error('short: ' + seeds.length + ' < ' + n);
    for (let k = 0; k < n; k++) if (!isIsaac(seeds[k])) throw new Error('bad value at ' + k);
  };
  if (mode === 'static' || mode === 'static-free-spin') {
    const L = reelStrips[0].length;
    const fsPos = reelStrips.map((strip) => (mode === 'static-free-spin' && a.freeSpinSymbol != null ? strip.map((s, i) => (s === a.freeSpinSymbol ? i : -1)).filter((i) => i >= 0) : []));
    const anyFs = fsPos.some((p) => p.length > 0);
    need(anyFs ? 2 * N : N);
    const stops = reelStrips.map((_, i) => {
      if (fsPos[i].length === 0) return scaled(seeds[i], L);
      const pos = fsPos[i][scaled(seeds[i], fsPos[i].length)];
      const row = rowSize - 1 - scaled(seeds[N + i], rowSize); // the visible row the free-spin symbol lands on
      return mod(pos - row, L);
    });
    return { stopPosList: stops, reels: stops.map((p, i) => Array.from({ length: rowSize }, (_, r) => reelStrips[i][(p + r) % L])) };
  }
  const w = a.symbolWeights;
  const minW = Math.min(...w);
  const base = [];
  w.forEach((x, i) => { for (let k = 0; k < Math.ceil(x / minW); k++) base.push(i + 1); });
  need(rowSize * N);
  if (mode === 'dynamic') {
    return { stopPosList: [], reels: reelStrips.map((_, c) => Array.from({ length: rowSize }, (_, r) => base[scaled(seeds[c * rowSize + r], base.length)])) };
  }
  const fallback = base.filter((s) => s !== a.freeSpinSymbol).length ? base.filter((s) => s !== a.freeSpinSymbol) : base;
  const blocked = new Set(String(a.blockedReels).split(',').map((s) => s.trim()).filter(Boolean).map(Number));
  return {
    stopPosList: [],
    reels: reelStrips.map((_, c) => {
      const v = seeds.slice(c * rowSize, c * rowSize + rowSize);
      if (blocked.has(c)) return v.map((x) => base[scaled(x, base.length)]);
      const fsRow = scaled(v[0], rowSize);
      let k = 1;
      return Array.from({ length: rowSize }, (_, r) => (r === fsRow ? a.freeSpinSymbol : fallback[scaled(v[k++], fallback.length)]));
    }),
  };
}

/** Run the editor node's own generate path on plain inputs; returns { reels, stopPosList, error }. */
function runNode(mode, a) {
  const self = Object.assign(Object.create(null), METHODS, {
    _internal: {
      reelStrips: a.reelStrips, seeds: a.seeds, rowSize: a.rowSize, symbolWeights: a.symbolWeights || [],
      freeSpinSymbol: a.freeSpinSymbol === undefined ? null : a.freeSpinSymbol, blockedReels: a.blockedReels === undefined ? '0,4' : a.blockedReels,
      isDynamic: mode.startsWith('dynamic'), reels: [], stopPosListInput: [], stopPosList: [], inspectData: null,
    },
    _reelStripsLocked: false,
    flagOutputDirty() {},
    sendSignalOnOutput() {},
  });
  const err = console.error;
  console.error = () => {};
  try {
    if (mode.endsWith('free-spin')) self.generateFreeSpinWeightedReels(); else self.generateWeightedReels();
  } finally { console.error = err; }
  return { reels: self._internal.reels, stopPosList: self._internal.stopPosList, error: self._internal.inspectData && self._internal.inspectData.error };
}

function runRef(mode, a) {
  try { return { ...reference(mode, a), error: undefined }; } catch (e) { return { reels: [], stopPosList: [], error: e.message }; }
}

const STRIPS = [[1, 2, 3, 4, 5, 6], [2, 3, 4, 5, 6, 1], [3, 4, 5, 6, 1, 2]];

describe('Weighted Reels — one certified value per outcome', () => {
  test('static: reel idx stops at floor(Seeds[idx] * L / 1e12); one value per reel', () => {
    const a = { reelStrips: STRIPS, rowSize: 3, seeds: [0, 5e11, 1e12 - 1] };
    expect(runNode('static', a)).toEqual({ reels: [[1, 2, 3], [5, 6, 1], [2, 3, 4]], stopPosList: [0, 3, 5], error: undefined });
    // changing one value moves exactly one reel
    expect(runNode('static', { ...a, seeds: [0, 5e11, 0] }).stopPosList).toEqual([0, 3, 0]);
    // the static count is unchanged: exactly one value per reel is enough
    expect(runNode('static', { ...a, seeds: [1, 2, 3] }).error).toBeUndefined();
  });

  test('dynamic: cell (col, row) takes Seeds[col * rows + row]; rows x columns values', () => {
    // weights [3, 2, 1] -> base [1, 1, 1, 2, 2, 3]
    const seeds = [1e11, 2e11, 3e11, 4e11, 5e11, 6e11, 7e11, 8e11, 9e11];
    const a = { reelStrips: STRIPS, rowSize: 3, symbolWeights: [3, 2, 1], seeds };
    expect(runNode('dynamic', a)).toEqual({ reels: [[1, 1, 1], [1, 2, 2], [2, 2, 3]], stopPosList: [], error: undefined });
    const moved = seeds.slice(); moved[4] = 9.9e11;
    expect(runNode('dynamic', { ...a, seeds: moved }).reels).toEqual([[1, 1, 1], [1, 3, 2], [2, 2, 3]]);
  });

  test('static free-spin: Seeds[idx] picks the free-spin position, Seeds[N + idx] the row it lands on', () => {
    // strip 0 holds free-spin symbol 6 at positions 1 and 4; L = 6, rowSize 3
    const strips = [[1, 6, 2, 3, 6, 4], [1, 2, 3, 4, 5, 2], [6, 1, 2, 3, 4, 5]];
    const a = { reelStrips: strips, rowSize: 3, freeSpinSymbol: 6, seeds: [7.5e11, 5e11, 0, 0, 1e12 - 1, 5e11] };
    const r = runNode('static-free-spin', a);
    // reel 0: position 4 (Seeds[0] in the upper half), offset 0 (Seeds[3] = 0): stop 2, the symbol on the bottom row
    expect(r).toEqual(runRef('static-free-spin', a));
    expect(r.stopPosList[0]).toBe(2);
    expect(r.reels[0]).toEqual([2, 3, 6]);
    expect(r.reels[2]).toContain(6);
    expect(r.stopPosList[1]).toBe(3); // no free-spin symbol on strip 1: floor(5e11 * 6 / 1e12)
    // the free-spin path needs 2 x reels values once any strip holds the symbol
    expect(runNode('static-free-spin', { ...a, seeds: a.seeds.slice(0, 5) }).error).toMatch(/^\[Weighted Reels\] Seeds has 5 values but 6 are needed/);
    // every visible row is reachable, each from its own value
    const rows = new Set([0, 1 / 3, 2 / 3].map((u) => runNode('static-free-spin', { ...a, seeds: [0, 0, 0, u * 1e12 + 1, 0, 0] }).reels[0].indexOf(6)));
    expect([...rows].sort()).toEqual([0, 1, 2]);
  });

  test('dynamic free-spin: a free-spin column uses its first value for the row, the rest for the other rows', () => {
    const a = { reelStrips: STRIPS, rowSize: 3, symbolWeights: [3, 2, 1], freeSpinSymbol: 3, blockedReels: '1', seeds: [0, 5e11, 9e11, 1e11, 5e11, 9.9e11, 9.9e11, 0, 0] };
    const r = runNode('dynamic-free-spin', a);
    expect(r).toEqual(runRef('dynamic-free-spin', a));
    expect(r.reels[0]).toEqual([3, 1, 2]); // row 0 is the free-spin row; fallback [1,1,1,2,2] for the others
    expect(r.reels[1]).toEqual([1, 2, 3]); // blocked: base [1,1,1,2,2,3] for every row
    expect(r.reels[2]).toEqual([1, 1, 3]); // row 2 is the free-spin row
  });

  test('the node equals the reference on 600 random cases, every mode, editor and RGS seed shapes', () => {
    let x = 20261004;
    const rnd = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
    const ri = (n) => Math.floor(rnd() * n);
    const modes = ['static', 'static-free-spin', 'dynamic', 'dynamic-free-spin'];
    let refused = 0;
    for (let t = 0; t < 600; t++) {
      const mode = modes[t % 4];
      const cols = 1 + ri(7), rows = 1 + ri(6), L = 1 + ri(40), syms = 1 + ri(9);
      const reelStrips = Array.from({ length: cols }, () => Array.from({ length: L }, () => 1 + ri(syms)));
      const symbolWeights = Array.from({ length: syms }, () => +(rnd() * 5 + 0.05).toFixed(3));
      const want = mode === 'static' ? cols : mode === 'static-free-spin' ? 2 * cols : rows * cols;
      const size = rnd() < 0.1 ? ri(want) : want + ri(3);
      const asFloat = rnd() < 0.5;
      const seeds = Array.from({ length: size }, () => (asFloat ? rnd() * R : Math.floor(rnd() * R)));
      if (size > 0 && rnd() < 0.05) seeds[ri(size)] = [0.5, -1, R, NaN][ri(4)];
      const a = { reelStrips, rowSize: rows, symbolWeights, seeds, freeSpinSymbol: 1 + ri(syms), blockedReels: [...new Set([ri(cols), ri(cols)])].join(',') };
      const node = runNode(mode, a);
      const ref = runRef(mode, a);
      if (ref.error) {
        refused++;
        expect([mode, node.reels, typeof node.error]).toEqual([mode, [], 'string']);
      } else {
        expect([mode, node]).toEqual([mode, ref]);
      }
    }
    expect(refused).toBeGreaterThan(20);
    expect(refused).toBeLessThan(150);
  });

  test('too few values and non-ISAAC values fail closed with the documented messages', () => {
    const dyn = { reelStrips: STRIPS, rowSize: 3, symbolWeights: [3, 2, 1] };
    expect(runNode('dynamic', { ...dyn, seeds: [] }).error).toBe(
      '[Weighted Reels] Seeds is required (9 needed, got 0): wire ISAAC Random Number Array Generator.array → Seeds (ISAAC size >= rows x columns (3 x 3 = 9)). Unseeded spins are not provably fair and are refused.'
    );
    expect(runNode('dynamic', { ...dyn, seeds: [1, 2, 3] }).error).toBe(
      '[Weighted Reels] Seeds has 3 values but 9 are needed: every random outcome takes its own Seeds value and none is reused. Set the ISAAC Random Number Array Generator feeding Seeds to size >= rows x columns (3 x 3 = 9).'
    );
    expect(runNode('static', { reelStrips: STRIPS, rowSize: 3, seeds: [1, 0.5, 3] }).error).toBe(
      '[Weighted Reels] Seeds[1] = 0.5 is not an ISAAC Random Number Array Generator value (a number, 0 <= n < 1e12; a 0..1 float is refused). Wire ISAAC Random Number Array Generator.array → Seeds.'
    );
    expect(runNode('static', { reelStrips: STRIPS, rowSize: 3, seeds: [1, 2] }).error).toMatch(/^\[Weighted Reels\] Seeds has 2 values but 3 are needed/);
  });

  test('through the real ports: Do lands the reference grid; short Seeds empties reels and still fires Done', async () => {
    const seeds = [1e11, 2e11, 3e11, 4e11, 5e11, 6e11, 7e11, 8e11, 9e11];
    const h = await mount(Def, { rowSize: 3, isDynamic: true });
    h.set('reelStrips', STRIPS);
    h.set('symbolWeights', [3, 2, 1]);
    h.set('Seeds', seeds);
    h.fire('Do');
    await new Promise((r) => setImmediate(r));
    h.ctx.update();
    expect(h.out('reels')).toEqual([[1, 1, 1], [1, 2, 2], [2, 2, 3]]);
    expect(h.count('Done')).toBe(1);
    const err = console.error;
    console.error = () => {};
    try {
      h.set('Seeds', seeds.slice(0, 3));
      h.fire('Do');
      await new Promise((r) => setImmediate(r));
      h.ctx.update();
    } finally { console.error = err; }
    expect(h.out('reels')).toEqual([]);
    expect(h.count('Done')).toBe(2);
  });
});
