// (2026-10-04, certification) Cascade refills now take one certified RNG value per refilled cell and
// refuse a Seeds array shorter than the cells to refill. Every existing round-player game created its
// refill ISAAC at the default size 1, so the editor raises any ISAAC feeding a cascade's Seeds to at
// least 100 when a project loads (ProjectPatches/applypatches.js). Lives here because the editor
// package has no unit-test runner; it requires the editor's patch module directly.
//
// The same day the rule reached Weighted Reels, Symbol Value Grid, Pick Bonus and Hold And Win Grid
// (one value per random outcome), so the minimum is now per consumer (SEEDS_MIN_BY_CONSUMER) and
// lives in three places that must agree: the editor's load patch, the ISAAC node (engine side) and
// the RGS compiler. The last block checks the three tables are the same; the compiler applying it is
// checked by a real compile in src/api/test-slot-feature-parity.ts (TypeScript; jest here runs plain JS).
'use strict';
const fs = require('fs');
const path = require('path');

const { applyPatches, _ensureCascadeSeedsSize, _ensureSeedsSize, CASCADE_SEEDS_MIN, SEEDS_MIN_BY_CONSUMER } = require(
  path.resolve(__dirname, '../../../xgenia-editor/src/editor/src/models/ProjectPatches/applypatches.js'),
);
const EXPECTED_TABLE = {
  'Cascade The Reels': 100,
  'Directional Cascade': 100,
  'Weighted Reels': 100,
  'Symbol Value Grid': 100,
  'Pick Bonus': 100,
  'Hold And Win Grid': 200,
};

const isaac = (id, size) => ({ id, type: 'ISAAC Random Number Array Generator', parameters: size === undefined ? {} : { size } });
const node = (id, type) => ({ id, type, parameters: {} });
const wire = (fromId, fromProperty, toId, toProperty) => ({ fromId, fromProperty, toId, toProperty });

function component(roots, connections) {
  return { name: '/#__maths__/M', graph: { roots, connections } };
}

describe('cascade Seeds upgrade on project load', () => {
  test('an ISAAC feeding Cascade The Reels.Seeds is raised to the minimum; others are untouched', () => {
    const c = component(
      [isaac('refill'), isaac('spin', 25), isaac('trig', 1), isaac('other', 3), node('casc', 'Cascade The Reels'), node('wr', 'Weighted Reels'),
        node('ft', 'Feature Trigger'), node('fn', 'JavaScriptFunction')],
      [wire('refill', 'array', 'casc', 'Seeds'), wire('spin', 'array', 'wr', 'Seeds'), wire('trig', 'array', 'ft', 'Seeds'), wire('other', 'array', 'fn', 'in-Seeds')],
    );
    applyPatches({ components: [c] });
    const byId = Object.fromEntries(c.graph.roots.map((n) => [n.id, n]));
    expect(byId.refill.parameters.size).toBe(CASCADE_SEEDS_MIN);
    // (2026-10-04) Weighted Reels takes one value per cell in dynamic mode: its ISAAC is raised too
    expect(byId.spin.parameters.size).toBe(100);
    // Feature Trigger still takes one value; anything else keeps its size
    expect(byId.trig.parameters.size).toBe(1);
    expect(byId.other.parameters.size).toBe(3);
  });

  test('every consumer that takes one value per outcome raises its ISAAC; one feeding several gets the largest', () => {
    expect(SEEDS_MIN_BY_CONSUMER).toEqual(EXPECTED_TABLE);
    expect(_ensureCascadeSeedsSize).toBe(_ensureSeedsSize);
    const types = Object.keys(EXPECTED_TABLE);
    const c = component(
      types.flatMap((t, i) => [isaac('i' + i, i === 0 ? undefined : 1), node('n' + i, t)]).concat([isaac('both', 5), { id: 'pfx', type: 'xgenia.pro/Pick Bonus', parameters: {} }, isaac('p', 2)]),
      types.map((t, i) => wire('i' + i, 'array', 'n' + i, 'Seeds')).concat([
        wire('both', 'array', 'n' + types.indexOf('Symbol Value Grid'), 'Seeds'),
        wire('both', 'array', 'n' + types.indexOf('Hold And Win Grid'), 'Seeds'),
        wire('p', 'array', 'pfx', 'Seeds'),
      ]),
    );
    _ensureSeedsSize(c);
    const byId = Object.fromEntries(c.graph.roots.map((n) => [n.id, n]));
    types.forEach((t, i) => expect([t, byId['i' + i].parameters.size]).toEqual([t, EXPECTED_TABLE[t]]));
    expect(byId.both.parameters.size).toBe(200);
    expect(byId.p.parameters.size).toBe(100); // a module-prefixed type name is matched too
  });

  test('Directional Cascade and nested nodes are covered; a larger size is kept', () => {
    const big = isaac('big', 400);
    const nested = isaac('nested', 1);
    const c = component(
      [{ id: 'group', type: 'Group', parameters: {}, children: [nested, node('dc', 'Directional Cascade')] }, big, node('casc', 'Cascade The Reels')],
      [wire('nested', 'array', 'dc', 'Seeds'), wire('big', 'array', 'casc', 'Seeds')],
    );
    _ensureCascadeSeedsSize(c);
    expect(nested.parameters.size).toBe(CASCADE_SEEDS_MIN);
    expect(big.parameters.size).toBe(400);
  });

  test('a size driven by a wire is left to the wire, and running twice changes nothing', () => {
    const wired = isaac('wired', 1);
    const c = component(
      [wired, node('n', 'Number'), node('casc', 'Cascade The Reels')],
      [wire('n', 'value', 'wired', 'size'), wire('wired', 'array', 'casc', 'Seeds')],
    );
    _ensureCascadeSeedsSize(c);
    expect(wired.parameters.size).toBe(1);
    const plain = isaac('plain');
    const c2 = component([plain, node('casc', 'Cascade The Reels')], [wire('plain', 'array', 'casc', 'Seeds')]);
    _ensureCascadeSeedsSize(c2);
    const once = JSON.stringify(c2);
    _ensureCascadeSeedsSize(c2);
    expect(JSON.stringify(c2)).toBe(once);
  });
});

// The same rule inside the engine, so it ships with the nodes (not only with the editor app): an ISAAC
// whose array feeds a cascade's Seeds yields at least 100 values even when its stored size is 1.
describe('ISAAC yields enough values when it feeds a cascade (engine side)', () => {
  const isaacModule = require(path.resolve(__dirname, '../../../../private/xgenia-pro-nodes/src/maths/isaac-rng-array.js'));
  const def = isaacModule.node || isaacModule;
  const effectiveSize = def.methods._effectiveSize;
  const self = (size, connections) => ({ _internal: { size }, _outputs: { array: { connections } } });
  const to = (type, inputPortName) => ({ node: { model: { type } }, inputPortName });

  test('feeding Cascade The Reels or Directional Cascade Seeds: at least 100', () => {
    expect(effectiveSize.call(self(1, [to('Cascade The Reels', 'Seeds')]))).toBe(100);
    expect(effectiveSize.call(self(5, [to('Directional Cascade', 'Seeds')]))).toBe(100);
    expect(effectiveSize.call(self(400, [to('Cascade The Reels', 'Seeds')]))).toBe(400);
  });

  test('every one-value-per-outcome consumer gets its minimum; the largest wins; a larger size is kept', () => {
    for (const [type, min] of Object.entries(EXPECTED_TABLE)) {
      expect([type, effectiveSize.call(self(1, [to(type, 'Seeds')]))]).toEqual([type, min]);
      expect([type, effectiveSize.call(self(5, [to(type, 'Seeds')]))]).toEqual([type, min]);
      expect([type, effectiveSize.call(self(1000, [to(type, 'Seeds')]))]).toEqual([type, 1000]);
    }
    expect(effectiveSize.call(self(5, [to('Weighted Reels', 'Seeds'), to('Hold And Win Grid', 'Seeds')]))).toBe(200);
  });

  test('anything else keeps its own size', () => {
    expect(effectiveSize.call(self(1, [to('Feature Trigger', 'Seeds'), to('Wheel Spin', 'Seeds')]))).toBe(1);
    expect(effectiveSize.call(self(4, [to('Weighted Reels', 'stopPosList'), to('Reel Strips Generator', 'randomSeeds')]))).toBe(4);
    expect(effectiveSize.call(self(1, []))).toBe(1);
    expect(effectiveSize.call({ _internal: { size: 3 }, _outputs: {} })).toBe(3);
  });

  test('the ISAAC node runs with the raised size: a size-1 ISAAC wired into Weighted Reels.Seeds yields 100 values', () => {
    const inst = { _internal: { size: 1, seed: 12345, nonce: null }, _outputs: { array: { connections: [to('Weighted Reels', 'Seeds')] } }, flagOutputDirty() {}, sendSignalOnOutput() {} };
    Object.assign(inst, Object.fromEntries(Object.entries(def.methods).map(([k, f]) => [k, typeof f === 'function' ? f : f.value])));
    inst._generateLocal();
    expect(inst._internal.lastGeneratedArray).toHaveLength(100);
    // the first value is the one a size-1 ISAAC with the same seed produced: raising the size only appends
    const one = { ...inst, _internal: { size: 1, seed: 12345, nonce: null }, _outputs: {} };
    one._generateLocal();
    expect(one._internal.lastGeneratedArray).toEqual(inst._internal.lastGeneratedArray.slice(0, 1));
  });
});

// The three tables must be the same: editor load patch, ISAAC node, RGS compiler (read from source:
// the compiler is TypeScript and jest here runs plain JS).
describe('the three SEEDS_MIN_BY_CONSUMER tables agree', () => {
  const tableIn = (file) => {
    const src = fs.readFileSync(file, 'utf8');
    const m = src.match(/const SEEDS_MIN_BY_CONSUMER[^=]*=\s*\{([^}]*)\}/);
    if (!m) throw new Error('no SEEDS_MIN_BY_CONSUMER table in ' + file);
    const out = {};
    for (const line of m[1].split('\n')) {
      const e = line.match(/'([^']+)':\s*(\w+)/);
      if (e) out[e[1]] = /^\d+$/.test(e[2]) ? Number(e[2]) : e[2] === 'CASCADE_SEEDS_MIN' ? 100 : NaN;
    }
    return out;
  };
  test('editor, engine and compiler hold the same minimums', () => {
    expect(tableIn(path.resolve(__dirname, '../../../xgenia-editor/src/editor/src/models/ProjectPatches/applypatches.js'))).toEqual(EXPECTED_TABLE);
    expect(tableIn(path.resolve(__dirname, '../../../../private/xgenia-pro-nodes/src/maths/isaac-rng-array.js'))).toEqual(EXPECTED_TABLE);
    expect(tableIn(path.resolve(__dirname, '../../src/api/supabase-converter.ts'))).toEqual(EXPECTED_TABLE);
  });
});

