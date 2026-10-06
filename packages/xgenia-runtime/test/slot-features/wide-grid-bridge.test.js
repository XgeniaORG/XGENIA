// Wide Grid Bridge (slot feature 37): two controllers as one grid wider than 12 columns —
// the split spin result, both spin signals, and allStopped only when both halves report.
'use strict';
const { defineFeature, mount, useFakeClock } = require('./harness');
const Def = defineFeature('wide-grid-bridge.js');
useFakeClock();

const cols = (n) => Array.from({ length: n }, (_, c) => [c, c, c]);

describe('Wide Grid Bridge', () => {
  test('ports match the spec', () => {
    const inputs = Object.keys(Def.metadata.inputs).filter((n) => n !== 'functionScript').sort();
    expect(inputs).toEqual(['spin', 'spinResult', 'splitAt', 'allStoppedA', 'allStoppedB', 'currentSymbolsA', 'currentSymbolsB'].sort());
    expect(Object.keys(Def.metadata.outputs).sort()).toEqual(['spinResultA', 'spinResultB', 'spinA', 'spinB', 'allStopped', 'currentSymbols', 'columnCount'].sort());
  });

  test('spin splits the grid and fires both halves; allStopped waits for both', async () => {
    const grid = cols(16);
    const h = await mount(Def, { splitAt: 12, spinResult: grid });
    h.fire('spin');
    expect(h.out('spinResultA')).toEqual(grid.slice(0, 12));
    expect(h.out('spinResultB')).toEqual(grid.slice(12));
    expect(h.out('columnCount')).toBe(16);
    expect(h.count('spinA')).toBe(1);
    expect(h.count('spinB')).toBe(1);
    h.fire('allStoppedA');
    expect(h.count('allStopped')).toBe(0);
    h.fire('allStoppedB');
    expect(h.count('allStopped')).toBe(1);
    // a second spin re-arms: one half alone is not enough again
    h.fire('spin');
    h.fire('allStoppedB');
    expect(h.count('allStopped')).toBe(1);
    h.fire('allStoppedA');
    expect(h.count('allStopped')).toBe(2);
  });

  test('currentSymbols is the concatenation of both halves', async () => {
    const h = await mount(Def, { splitAt: 2 });
    h.set('currentSymbolsA', [[1, 1], [2, 2]]);
    h.set('currentSymbolsB', [[3, 3]]);
    expect(h.out('currentSymbols')).toEqual([[1, 1], [2, 2], [3, 3]]);
  });
});
