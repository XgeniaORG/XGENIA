// Reel Stop Watcher (slot feature 35): rebuilds "all reels stopped" from per-column stops,
// with an expected subset, duplicate protection and a watchdog.
'use strict';
const { defineFeature, mount, useFakeClock } = require('./harness');
const Def = defineFeature('reel-stop-watcher.js');
useFakeClock();

describe('Reel Stop Watcher', () => {
  test('ports match the spec', () => {
    const inputs = Object.keys(Def.metadata.inputs).filter((n) => n !== 'functionScript');
    for (let i = 0; i < 12; i++) expect(inputs).toContain('stopped' + i);
    expect(inputs).toEqual(expect.arrayContaining(['arm', 'expected', 'columnCount', 'timeoutMs', 'disarm']));
    expect(Object.keys(Def.metadata.outputs).sort()).toEqual(['allStopped', 'stoppedCount', 'stoppedColumns', 'timedOut', 'armed'].sort());
  });

  test('all expected columns stopping fires allStopped once; duplicates do not count', async () => {
    const h = await mount(Def, { columnCount: 3, timeoutMs: 8000 });
    h.fire('arm');
    expect(h.out('armed')).toBe(true);
    h.fire('stopped0');
    h.fire('stopped0');
    h.fire('stopped2');
    expect(h.out('stoppedCount')).toBe(2);
    expect(h.out('stoppedColumns').sort()).toEqual([0, 2]);
    expect(h.count('allStopped')).toBe(0);
    h.fire('stopped1');
    expect(h.count('allStopped')).toBe(1);
    expect(h.out('stoppedCount')).toBe(3);
    h.fire('stopped1');
    expect(h.count('allStopped')).toBe(1);
  });

  test('expected narrows the wait to the free columns', async () => {
    const h = await mount(Def, { columnCount: 5, expected: '1,3' });
    h.fire('arm');
    h.fire('stopped0'); // not expected: ignored for completion
    h.fire('stopped1');
    expect(h.count('allStopped')).toBe(0);
    h.fire('stopped3');
    expect(h.count('allStopped')).toBe(1);
  });

  test('the watchdog fires timedOut when a column never reports, and disarm cancels it', async () => {
    const h = await mount(Def, { columnCount: 2, timeoutMs: 1000 });
    h.fire('arm');
    h.fire('stopped0');
    h.advance(1000);
    expect(h.count('timedOut')).toBe(1);
    expect(h.count('allStopped')).toBe(0);
    h.fire('arm');
    h.fire('disarm');
    expect(h.out('armed')).toBe(false);
    h.advance(2000);
    expect(h.count('timedOut')).toBe(1);
  });
});
