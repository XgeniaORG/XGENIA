// Column Spin Router (slot feature 36): fans one spin to the free columns only, slices the
// target grid per column, and reports the locked complement.
'use strict';
const { defineFeature, mount, useFakeClock } = require('./harness');
const Def = defineFeature('column-spin-router.js');
useFakeClock();

const GRID = [[1, 2, 3], [4, 5, 6], [7, 8, 9], [1, 1, 1]];

describe('Column Spin Router', () => {
  test('ports match the spec', () => {
    const inputs = Object.keys(Def.metadata.inputs).filter((n) => n !== 'functionScript').sort();
    expect(inputs).toEqual(['spin', 'stop', 'freeColumns', 'columnCount', 'targetSymbols', 'stopPositions'].sort());
    const outs = Object.keys(Def.metadata.outputs);
    for (let i = 0; i < 12; i++) { expect(outs).toContain('spin' + i); expect(outs).toContain('stop' + i); expect(outs).toContain('target' + i); expect(outs).toContain('stopPos' + i); }
    expect(outs).toEqual(expect.arrayContaining(['lockedColumns', 'routed']));
  });

  test('spin reaches only the free columns, with their own target slices', async () => {
    const h = await mount(Def, { columnCount: 4, freeColumns: [1, 3], targetSymbols: GRID, stopPositions: [3, 4, 5, 6] });
    h.fire('spin');
    expect(h.count('spin1')).toBe(1);
    expect(h.count('spin3')).toBe(1);
    expect(h.count('spin0')).toBe(0);
    expect(h.count('spin2')).toBe(0);
    expect(h.out('lockedColumns')).toEqual([0, 2]);
    expect(h.count('routed')).toBe(1);
    // the result lands on stop: each free column gets its symbols and stop index before stopN fires
    h.fire('stop');
    expect(h.out('target1')).toEqual([4, 5, 6]);
    expect(h.out('target3')).toEqual([1, 1, 1]);
    expect(h.out('stopPos1')).toBe(4);
    expect(h.out('target0')).toEqual([]); // locked columns receive nothing
    expect(h.count('stop1')).toBe(1);
    expect(h.count('stop3')).toBe(1);
    expect(h.count('stop0')).toBe(0);
    expect(h.count('routed')).toBe(2);
  });

  test('an empty freeColumns spins every column up to columnCount', async () => {
    const h = await mount(Def, { columnCount: 3, freeColumns: [], targetSymbols: GRID });
    h.fire('spin');
    expect(h.count('spin0')).toBe(1);
    expect(h.count('spin1')).toBe(1);
    expect(h.count('spin2')).toBe(1);
    expect(h.count('spin3')).toBe(0);
    expect(h.out('lockedColumns')).toEqual([]);
  });
});
