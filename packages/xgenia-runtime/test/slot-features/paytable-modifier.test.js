// Paytable Modifier (slot feature 19): registry port mirror, client/core parity in scale and
// absolute modes, the identity case, and the fail-closed error contract (the core throws on
// nothing ordinary, so the error path is exercised by making the core throw).
'use strict';

const { defineFeature, mount } = require('./harness');
const cores = require('@xgenia/runtime/src/api/slot-feature-cores');

const PaytableModifier = defineFeature('paytable-modifier.js');

const REGISTRY_INPUTS = ['paytable', 'scale', 'symbolOverrides', 'mode', 'roundTo'];
const REGISTRY_OUTPUTS = ['paytable', 'changed', 'scale'];

const PAYTABLE = {
  1: { 3: 5, 4: 10, 5: 50 },
  2: { 3: 10, 4: 25, 5: 100 },
  7: { 3: 50, 4: 200, 5: 1000 }
};

function expectParity(h, r) {
  for (const name of REGISTRY_OUTPUTS) expect(h.out(name)).toEqual(r[name]);
}

describe('Paytable Modifier', () => {
  let errorSpy;
  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
    jest.restoreAllMocks();
  });

  test('module shape and metadata mirror the registry', () => {
    const mod = require('../../../../private/xgenia-pro-nodes/src/slot-games/features/paytable-modifier.js');
    expect(Object.keys(mod)).toEqual(['node']);
    expect(mod.node.name).toBe('Paytable Modifier');
    expect(mod.node.category).toBe('Math');
    expect(mod.node.color).toBe('math');
    expect(mod.node.docs).toBe('https://docsapp.xgenia.com/nodes/slot-features/paytable-modifier');
    expect(typeof mod.node.description).toBe('string');
    expect(mod.node.description).toMatch(/Get Paytable\.paytable/);
    expect(mod.node.description).toMatch(/Calculate Winnings\.paytable/);
    const inputs = Object.keys(PaytableModifier.metadata.inputs).filter((n) => n !== 'functionScript');
    expect(inputs.sort()).toEqual(REGISTRY_INPUTS.concat(['Do']).sort());
    expect(Object.keys(PaytableModifier.metadata.outputs).sort()).toEqual(REGISTRY_OUTPUTS.concat(['Done']).sort());
    expect(PaytableModifier.metadata.inputs.Do.type.name).toBe('signal');
    expect(PaytableModifier.metadata.inputs.mode.type.name).toBe('enum');
    expect(PaytableModifier.metadata.inputs.mode.type.enums.map((e) => e.value)).toEqual(['scale', 'absolute']);
    expect(PaytableModifier.metadata.inputs.mode.default).toBe('scale');
    expect(PaytableModifier.metadata.inputs.roundTo.default).toBe(4);
    expect(PaytableModifier.metadata.inputs.paytable.type).toBe('object');
    expect(PaytableModifier.metadata.outputs.Done.type).toBe('signal');
    expect(PaytableModifier.metadata.outputs.paytable.type).toBe('object');
    expect(PaytableModifier.metadata.outputs.changed.type).toBe('boolean');
  });

  test('scale mode: global scale plus per-symbol factors equal the core', async () => {
    const args = { paytable: PAYTABLE, scale: 2, symbolOverrides: { 7: 0.5 }, mode: 'scale', roundTo: 4 };
    const h = await mount(PaytableModifier, args);
    h.fire('Do');
    const r = cores.modifyPaytable(args);
    expectParity(h, r);
    expect(h.out('paytable')['1']['3']).toBe(10);
    expect(h.out('paytable')['2']['5']).toBe(200);
    expect(h.out('paytable')['7']['3']).toBe(50);
    expect(h.out('paytable')['7']['5']).toBe(1000);
    expect(h.out('changed')).toBe(true);
    expect(h.out('scale')).toBe(2);
    expect(h.count('Done')).toBe(1);
  });

  test('absolute mode: override rows replace counts outright, others still scale (core parity)', async () => {
    const args = { paytable: PAYTABLE, scale: 1, symbolOverrides: { 7: { 3: 60, 6: 5000 } }, mode: 'absolute', roundTo: 4 };
    const h = await mount(PaytableModifier, args);
    h.fire('Do');
    expectParity(h, cores.modifyPaytable(args));
    expect(h.out('paytable')['7']).toEqual({ 3: 60, 4: 200, 5: 1000, 6: 5000 });
    expect(h.out('paytable')['1']).toEqual({ 3: 5, 4: 10, 5: 50 });
    expect(h.out('changed')).toBe(true);
  });

  test('identity (scale 1, no overrides) reports changed false; roundTo rounds (core parity)', async () => {
    const h = await mount(PaytableModifier, { paytable: PAYTABLE, scale: 1, symbolOverrides: {}, mode: 'scale', roundTo: 4 });
    h.fire('Do');
    expectParity(h, cores.modifyPaytable({ paytable: PAYTABLE, scale: 1, symbolOverrides: {}, mode: 'scale', roundTo: 4 }));
    expect(h.out('paytable')).toEqual(PAYTABLE);
    expect(h.out('changed')).toBe(false);

    h.set('scale', 1 / 3);
    h.set('roundTo', 2);
    h.fire('Do');
    const r = cores.modifyPaytable({ paytable: PAYTABLE, scale: 1 / 3, symbolOverrides: {}, mode: 'scale', roundTo: 2 });
    expectParity(h, r);
    expect(h.out('paytable')['1']['3']).toBe(1.67);
  });

  test('fails closed when the core throws: error logged + in inspect data, outputs empty, Done fires', async () => {
    const h = await mount(PaytableModifier, { paytable: PAYTABLE, scale: 2 });
    jest.spyOn(cores, 'modifyPaytable').mockImplementation(() => {
      throw new Error('boom');
    });
    h.fire('Do');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toBe('[Paytable Modifier] boom');
    expect(h.node.getInspectInfo().value.error).toBe('boom');
    expect(h.out('paytable')).toEqual({});
    expect(h.out('changed')).toBe(false);
    expect(h.out('scale')).toBe(0);
    expect(h.count('Done')).toBe(1);
  });
});
