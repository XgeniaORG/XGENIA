// (2026-10-04, certification) Cascade refills now take one certified RNG value per refilled cell and
// refuse a Seeds array shorter than the cells to refill. Every existing round-player game created its
// refill ISAAC at the default size 1, so the editor raises any ISAAC feeding a cascade's Seeds to at
// least 100 when a project loads (ProjectPatches/applypatches.js). Lives here because the editor
// package has no unit-test runner; it requires the editor's patch module directly.
'use strict';
const path = require('path');

const { applyPatches, _ensureCascadeSeedsSize, CASCADE_SEEDS_MIN } = require(
  path.resolve(__dirname, '../../../xgenia-editor/src/editor/src/models/ProjectPatches/applypatches.js'),
);

const isaac = (id, size) => ({ id, type: 'ISAAC Random Number Array Generator', parameters: size === undefined ? {} : { size } });
const node = (id, type) => ({ id, type, parameters: {} });
const wire = (fromId, fromProperty, toId, toProperty) => ({ fromId, fromProperty, toId, toProperty });

function component(roots, connections) {
  return { name: '/#__maths__/M', graph: { roots, connections } };
}

describe('cascade Seeds upgrade on project load', () => {
  test('an ISAAC feeding Cascade The Reels.Seeds is raised to the minimum; others are untouched', () => {
    const c = component(
      [isaac('refill'), isaac('spin', 25), node('casc', 'Cascade The Reels'), node('wr', 'Weighted Reels')],
      [wire('refill', 'array', 'casc', 'Seeds'), wire('spin', 'array', 'wr', 'Seeds')],
    );
    applyPatches({ components: [c] });
    const byId = Object.fromEntries(c.graph.roots.map((n) => [n.id, n]));
    expect(byId.refill.parameters.size).toBe(CASCADE_SEEDS_MIN);
    expect(byId.spin.parameters.size).toBe(25);
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

  test('anything else keeps its own size', () => {
    expect(effectiveSize.call(self(5, [to('Weighted Reels', 'Seeds')]))).toBe(5);
    expect(effectiveSize.call(self(1, []))).toBe(1);
    expect(effectiveSize.call({ _internal: { size: 3 }, _outputs: {} })).toBe(3);
  });
});

