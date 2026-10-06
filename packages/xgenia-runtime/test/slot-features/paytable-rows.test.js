// Paytable Rows (slot feature 21): registry port mirror, client/core parity with array and
// object symbol names, bet re-pricing, and the fail-closed error contract (exercised by making
// the core throw).
'use strict';

const { defineFeature, mount } = require('./harness');
const cores = require('@xgenia/runtime/src/api/slot-feature-cores');

const PaytableRows = defineFeature('paytable-rows.js');

const REGISTRY_INPUTS = ['paytable', 'symbolNames', 'betAmount', 'paylinesCount'];
const REGISTRY_OUTPUTS = ['rows', 'flatRows', 'symbolCount', 'betPerLine'];

const PAYTABLE = {
  7: { 3: 50, 5: 1000 },
  1: { 3: 5, 4: 10, 5: 50 }
};
const NAMES = ['Cherry', 'Lemon', 'Orange', 'Plum', 'Bell', 'Bar', 'Seven'];

function expectParity(h, r) {
  for (const name of REGISTRY_OUTPUTS) expect(h.out(name)).toEqual(r[name]);
}

describe('Paytable Rows', () => {
  let errorSpy;
  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
    jest.restoreAllMocks();
  });

  test('module shape and metadata mirror the registry', () => {
    const mod = require('../../../../private/xgenia-pro-nodes/src/slot-games/features/paytable-rows.js');
    expect(Object.keys(mod)).toEqual(['node']);
    expect(mod.node.name).toBe('Paytable Rows');
    expect(mod.node.category).toBe('Math');
    expect(mod.node.color).toBe('math');
    expect(mod.node.docs).toBe('https://docsapp.xgenia.com/nodes/slot-features/paytable-rows');
    expect(typeof mod.node.description).toBe('string');
    expect(mod.node.description).toMatch(/Get Paytable\.paytable/);
    const inputs = Object.keys(PaytableRows.metadata.inputs).filter((n) => n !== 'functionScript');
    expect(inputs.sort()).toEqual(REGISTRY_INPUTS.concat(['Do']).sort());
    expect(Object.keys(PaytableRows.metadata.outputs).sort()).toEqual(REGISTRY_OUTPUTS.concat(['Done']).sort());
    expect(PaytableRows.metadata.inputs.Do.type.name).toBe('signal');
    expect(PaytableRows.metadata.inputs.betAmount.default).toBe(100);
    expect(PaytableRows.metadata.inputs.paylinesCount.default).toBe(20);
    expect(PaytableRows.metadata.inputs.symbolNames.type).toBe('array');
    expect(PaytableRows.metadata.outputs.Done.type).toBe('signal');
    expect(PaytableRows.metadata.outputs.rows.type).toBe('array');
    expect(PaytableRows.metadata.outputs.betPerLine.type).toBe('number');
  });

  test('Do builds the rows the core builds (array names, symbols and counts ascending, minor-unit payouts)', async () => {
    const args = { paytable: PAYTABLE, symbolNames: NAMES, betAmount: 2000, paylinesCount: 20 };
    const h = await mount(PaytableRows, args);
    h.fire('Do');
    const r = cores.paytableRows(args);
    expectParity(h, r);
    expect(h.out('betPerLine')).toBe(100);
    expect(h.out('symbolCount')).toBe(2);
    expect(h.out('rows')[0]).toEqual({
      symbol: 1,
      name: 'Cherry',
      entries: [
        { count: 3, multiplier: 5, payout: 500 },
        { count: 4, multiplier: 10, payout: 1000 },
        { count: 5, multiplier: 50, payout: 5000 }
      ]
    });
    expect(h.out('rows')[1].name).toBe('Seven');
    expect(h.out('rows')[1].entries.map((e) => e.count)).toEqual([3, 5]);
    expect(h.out('flatRows')).toHaveLength(5);
    expect(h.out('flatRows')[4]).toEqual({ symbol: 7, name: 'Seven', count: 5, multiplier: 1000, payout: 100000 });
    expect(h.count('Done')).toBe(1);
  });

  test('object symbol names and a bet change re-price the rows (core parity)', async () => {
    const h = await mount(PaytableRows, { paytable: PAYTABLE, symbolNames: { 7: 'Lucky Seven' }, betAmount: 100, paylinesCount: 10 });
    h.fire('Do');
    expectParity(h, cores.paytableRows({ paytable: PAYTABLE, symbolNames: { 7: 'Lucky Seven' }, betAmount: 100, paylinesCount: 10 }));
    expect(h.out('rows')[0].name).toBe('1');
    expect(h.out('rows')[1].name).toBe('Lucky Seven');
    expect(h.out('betPerLine')).toBe(10);
    expect(h.out('rows')[0].entries[0].payout).toBe(50);

    h.set('betAmount', 500);
    h.fire('Do');
    expectParity(h, cores.paytableRows({ paytable: PAYTABLE, symbolNames: { 7: 'Lucky Seven' }, betAmount: 500, paylinesCount: 10 }));
    expect(h.out('betPerLine')).toBe(50);
    expect(h.out('rows')[0].entries[0].payout).toBe(250);
  });

  test('an empty paytable yields no rows without error (core parity)', async () => {
    const h = await mount(PaytableRows, { paytable: {}, betAmount: 100, paylinesCount: 20 });
    h.fire('Do');
    expectParity(h, cores.paytableRows({ paytable: {}, symbolNames: [], betAmount: 100, paylinesCount: 20 }));
    expect(h.out('rows')).toEqual([]);
    expect(h.out('symbolCount')).toBe(0);
    expect(h.out('betPerLine')).toBe(5);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test('fails closed when the core throws: error logged + in inspect data, outputs empty, Done fires', async () => {
    const h = await mount(PaytableRows, { paytable: PAYTABLE, symbolNames: NAMES });
    jest.spyOn(cores, 'paytableRows').mockImplementation(() => {
      throw new Error('boom');
    });
    h.fire('Do');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toBe('[Paytable Rows] boom');
    expect(h.node.getInspectInfo().value.error).toBe('boom');
    expect(h.out('rows')).toEqual([]);
    expect(h.out('flatRows')).toEqual([]);
    expect(h.out('symbolCount')).toBe(0);
    expect(h.out('betPerLine')).toBe(0);
    expect(h.count('Done')).toBe(1);
  });
});
