// Wheel Spin (slot feature 17, seeded): registry port mirror, client/core parity for label and
// object segment lists, weight overrides, and the unseeded / empty fail-closed contract.
'use strict';

const { defineFeature, mount } = require('./harness');
const cores = require('@xgenia/runtime/src/api/slot-feature-cores');

const WheelSpin = defineFeature('wheel-spin.js');

const REGISTRY_INPUTS = ['segments', 'weights', 'prizes', 'Seeds'];
const REGISTRY_OUTPUTS = ['segmentIndex', 'prize', 'prizeValue', 'label', 'angle', 'sweep', 'segmentCount', 'segments'];

const LABELS = ['x2', 'x5', 'x10', 'JACKPOT'];
const WEIGHTS = [50, 30, 15, 5];
const PRIZES = [2, 5, 10, 100];
const SEEDS = [424242424242];

function expectParity(h, r) {
  for (const name of REGISTRY_OUTPUTS) expect(h.out(name)).toEqual(r[name]);
}

describe('Wheel Spin', () => {
  let errorSpy;
  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  test('module shape and metadata mirror the registry', () => {
    const mod = require('../../../../private/xgenia-pro-nodes/src/slot-games/features/wheel-spin.js');
    expect(Object.keys(mod)).toEqual(['node']);
    expect(mod.node.name).toBe('Wheel Spin');
    expect(mod.node.category).toBe('Math');
    expect(mod.node.color).toBe('math');
    expect(mod.node.docs).toBe('https://docsapp.xgenia.com/nodes/slot-features/wheel-spin');
    expect(typeof mod.node.description).toBe('string');
    expect(mod.node.description).toMatch(/pixi\.Wheel\.targetIndex/);
    expect(mod.node.description).toMatch(/ISAAC Random Number Array Generator\.array/);
    const inputs = Object.keys(WheelSpin.metadata.inputs).filter((n) => n !== 'functionScript');
    expect(inputs.sort()).toEqual(REGISTRY_INPUTS.concat(['Do']).sort());
    expect(Object.keys(WheelSpin.metadata.outputs).sort()).toEqual(REGISTRY_OUTPUTS.concat(['Done']).sort());
    expect(WheelSpin.metadata.inputs.Do.type.name).toBe('signal');
    expect(WheelSpin.metadata.outputs.Done.type).toBe('signal');
    expect(WheelSpin.metadata.outputs.segmentIndex.type).toBe('number');
    expect(WheelSpin.metadata.outputs.prize.type).toBe('*');
    expect(WheelSpin.metadata.outputs.segments.type).toBe('array');
  });

  test('Do lands the segment the core lands from the same seed (labels + weights + prizes)', async () => {
    const h = await mount(WheelSpin, { segments: LABELS, weights: WEIGHTS, prizes: PRIZES, Seeds: SEEDS });
    h.fire('Do');
    const r = cores.spinWheel({ segments: LABELS, weights: WEIGHTS, prizes: PRIZES, seeds: SEEDS });
    expectParity(h, r);
    const idx = h.out('segmentIndex');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(4);
    expect(h.out('label')).toBe(LABELS[idx]);
    expect(h.out('prize')).toBe(PRIZES[idx]);
    expect(h.out('prizeValue')).toBe(PRIZES[idx]);
    expect(h.out('sweep')).toBe(90);
    expect(h.out('angle')).toBe((idx + 0.5) * 90);
    expect(h.out('segmentCount')).toBe(4);
    expect(h.out('segments')[idx]).toEqual({ label: LABELS[idx], weight: WEIGHTS[idx], prize: PRIZES[idx] });
    expect(h.count('Done')).toBe(1);

    // several seeds: every landing matches the core
    for (const seed of [1, 2, 3, 99999, 123456789012]) {
      h.set('Seeds', [seed]);
      h.fire('Do');
      expectParity(h, cores.spinWheel({ segments: LABELS, weights: WEIGHTS, prizes: PRIZES, seeds: [seed] }));
    }
  });

  test('object segments keep non-numeric prizes; a zero-weight segment never lands (core parity)', async () => {
    const segments = [
      { label: 'Free Spins', weight: 1, prize: 'FREE_SPINS' },
      { label: 'Coins', weight: 3, prize: 20 },
      { label: 'Never', weight: 0, prize: 1000 }
    ];
    for (const seed of [7, 8, 9, 10, 11, 12, 13]) {
      const h = await mount(WheelSpin, { segments, Seeds: [seed] });
      h.fire('Do');
      const r = cores.spinWheel({ segments, weights: [], prizes: [], seeds: [seed] });
      expectParity(h, r);
      expect(h.out('segmentIndex')).not.toBe(2);
      if (h.out('segmentIndex') === 0) {
        expect(h.out('prize')).toBe('FREE_SPINS');
        expect(h.out('prizeValue')).toBe(0);
      } else {
        expect(h.out('prizeValue')).toBe(20);
      }
      expect(h.out('sweep')).toBe(120);
    }
  });

  test('unseeded fails closed: error logged + in inspect data, outputs empty, Done fires', async () => {
    const h = await mount(WheelSpin, { segments: LABELS, weights: WEIGHTS, prizes: PRIZES });
    h.fire('Do');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatch(/^\[Wheel Spin\] Seeds is required/);
    expect(h.node.getInspectInfo().value.error).toMatch(/Seeds is required/);
    expect(h.out('segmentIndex')).toBe(0);
    expect(h.out('prize')).toBeNull();
    expect(h.out('prizeValue')).toBe(0);
    expect(h.out('label')).toBe('');
    expect(h.out('angle')).toBe(0);
    expect(h.out('sweep')).toBe(0);
    expect(h.out('segmentCount')).toBe(0);
    expect(h.out('segments')).toEqual([]);
    expect(h.count('Done')).toBe(1);
  });

  test('an empty segment list fails closed the same way', async () => {
    const h = await mount(WheelSpin, { segments: [], Seeds: SEEDS });
    h.fire('Do');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(h.node.getInspectInfo().value.error).toMatch(/segments is empty/);
    expect(h.out('segments')).toEqual([]);
    expect(h.count('Done')).toBe(1);
  });
});
