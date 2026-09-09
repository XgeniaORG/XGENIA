// Feature Trigger (slot feature 15, seeded): registry port mirror, client/core parity of the
// seeded roll, chance edge cases, and the unseeded fail-closed contract.
'use strict';

const { defineFeature, mount } = require('./harness');
const cores = require('@xgenia/runtime/src/api/slot-feature-cores');

const FeatureTrigger = defineFeature('feature-trigger.js');

const REGISTRY_INPUTS = ['chance', 'Seeds'];
const REGISTRY_OUTPUTS = ['triggered', 'roll', 'chance'];

function expectParity(h, r) {
  for (const name of REGISTRY_OUTPUTS) expect(h.out(name)).toEqual(r[name]);
}

describe('Feature Trigger', () => {
  let errorSpy;
  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  test('module shape and metadata mirror the registry', () => {
    const mod = require('../../../../private/xgenia-pro-nodes/src/slot-games/features/feature-trigger.js');
    expect(Object.keys(mod)).toEqual(['node']);
    expect(mod.node.name).toBe('Feature Trigger');
    expect(mod.node.category).toBe('Math');
    expect(mod.node.color).toBe('math');
    expect(mod.node.docs).toBe('https://docsapp.xgenia.com/nodes/slot-features/feature-trigger');
    expect(typeof mod.node.description).toBe('string');
    expect(mod.node.description).toMatch(/ISAAC Random Number Array Generator\.array/);
    expect(mod.node.description).toMatch(/FAILS CLOSED/);
    const inputs = Object.keys(FeatureTrigger.metadata.inputs).filter((n) => n !== 'functionScript');
    expect(inputs.sort()).toEqual(REGISTRY_INPUTS.concat(['Do']).sort());
    expect(Object.keys(FeatureTrigger.metadata.outputs).sort()).toEqual(REGISTRY_OUTPUTS.concat(['Done']).sort());
    expect(FeatureTrigger.metadata.inputs.Do.type.name).toBe('signal');
    expect(FeatureTrigger.metadata.inputs.chance.default).toBe(0.05);
    expect(FeatureTrigger.metadata.inputs.Seeds.type).toBe('array');
    expect(FeatureTrigger.metadata.outputs.Done.type).toBe('signal');
    expect(FeatureTrigger.metadata.outputs.triggered.type).toBe('boolean');
  });

  test('Do rolls exactly what the core rolls from the same seed', async () => {
    const args = { chance: 0.5, seeds: [123456789012] };
    const h = await mount(FeatureTrigger, { chance: 0.5, Seeds: [123456789012] });
    h.fire('Do');
    const r = cores.rollFeatureTrigger(args);
    expectParity(h, r);
    expect(h.out('roll')).toBeGreaterThanOrEqual(0);
    expect(h.out('roll')).toBeLessThan(1);
    expect(h.out('triggered')).toBe(r.roll < 0.5);
    expect(h.count('Done')).toBe(1);

    // a different seed gives a different roll; the same seed repeats it
    h.set('Seeds', [42]);
    h.fire('Do');
    expectParity(h, cores.rollFeatureTrigger({ chance: 0.5, seeds: [42] }));
    expect(h.out('roll')).not.toBe(r.roll);
    h.set('Seeds', [123456789012]);
    h.fire('Do');
    expect(h.out('roll')).toBe(r.roll);
  });

  test('chance edges: 1 always triggers, 0 never, out-of-range values are clamped (core parity)', async () => {
    const h = await mount(FeatureTrigger, { chance: 1, Seeds: [777] });
    h.fire('Do');
    expectParity(h, cores.rollFeatureTrigger({ chance: 1, seeds: [777] }));
    expect(h.out('triggered')).toBe(true);
    h.set('chance', 0);
    h.fire('Do');
    expectParity(h, cores.rollFeatureTrigger({ chance: 0, seeds: [777] }));
    expect(h.out('triggered')).toBe(false);
    h.set('chance', 7);
    h.fire('Do');
    expectParity(h, cores.rollFeatureTrigger({ chance: 7, seeds: [777] }));
    expect(h.out('chance')).toBe(1);
  });

  test('seeds delivered in the same update as Do are the seeds rolled', async () => {
    const h = await mount(FeatureTrigger, { chance: 0.3 });
    h.node.queueInput('Seeds', [99999]);
    h.node.queueInput('Do', true);
    h.node.queueInput('Do', false);
    h.ctx.update();
    expectParity(h, cores.rollFeatureTrigger({ chance: 0.3, seeds: [99999] }));
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test('unseeded fails closed: error logged + in inspect data, outputs empty, Done fires', async () => {
    const h = await mount(FeatureTrigger, { chance: 0.5 });
    h.fire('Do');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatch(/^\[Feature Trigger\] Seeds is required/);
    expect(h.node.getInspectInfo().value.error).toMatch(/Seeds is required/);
    expect(h.out('triggered')).toBe(false);
    expect(h.out('roll')).toBe(0);
    expect(h.out('chance')).toBe(0);
    expect(h.count('Done')).toBe(1);
  });
});
