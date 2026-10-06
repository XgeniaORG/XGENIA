// Performance Budget (slot feature 34): sampling starts and stops, the report shape, and a
// breach signal that fires once per breach type.
'use strict';
const { defineFeature, mount, useFakeClock } = require('./harness');
const Def = defineFeature('performance-budget.js');
useFakeClock();

describe('Performance Budget', () => {
  test('ports match the spec', () => {
    const inputs = Object.keys(Def.metadata.inputs).filter((n) => n !== 'functionScript').sort();
    expect(inputs).toEqual(['start', 'stop', 'fpsBudget', 'heapBudgetMB', 'loadTimeBudgetMs', 'sampleMs'].sort());
    expect(Object.keys(Def.metadata.outputs).sort()).toEqual(['fps', 'heapMB', 'loadTimeMs', 'overBudget', 'budgetExceeded', 'report', 'sampled'].sort());
  });

  test('start samples every sampleMs and stop ends it', async () => {
    const h = await mount(Def, { sampleMs: 1000, fpsBudget: 50, heapBudgetMB: 256, loadTimeBudgetMs: 4000 });
    h.fire('start');
    h.advance(1000);
    expect(h.count('sampled')).toBeGreaterThanOrEqual(1);
    const report = h.out('report');
    expect(report).toEqual(expect.objectContaining({ fps: expect.any(Number), heapMB: expect.any(Number), loadTimeMs: expect.any(Number), breaches: expect.any(Array) }));
    expect(typeof h.out('overBudget')).toBe('boolean');
    const after = h.count('sampled');
    h.fire('stop');
    h.advance(3000);
    expect(h.count('sampled')).toBe(after);
  });

  test('a breach fires budgetExceeded once until it recovers', async () => {
    // In Node frames run on a 16 ms timer (~60 fps), so a 1000 fps budget is a guaranteed breach.
    const h = await mount(Def, { sampleMs: 500, fpsBudget: 1000 });
    h.fire('start');
    h.advance(500);
    expect(h.out('fps')).toBeGreaterThan(0);
    expect(h.out('overBudget')).toBe(true);
    expect(h.out('report').breaches).toContain('fps');
    expect(h.count('budgetExceeded')).toBe(1);
    h.advance(1500);
    expect(h.count('budgetExceeded')).toBe(1); // still breached, not re-signalled
    h.set('fpsBudget', 1); // recover ...
    h.advance(500);
    expect(h.out('overBudget')).toBe(false);
    h.set('fpsBudget', 1000); // ... and breach anew: fires once more
    h.advance(500);
    expect(h.count('budgetExceeded')).toBe(2);
    h.fire('stop');
  });
});
