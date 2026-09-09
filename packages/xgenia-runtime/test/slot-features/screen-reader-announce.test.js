// Screen Reader Announce (slot feature 30): announcements are counted and re-triggerable,
// and the node works without a document (the live region is created only in a browser).
'use strict';
const { defineFeature, mount, useFakeClock } = require('./harness');
const Def = defineFeature('screen-reader-announce.js');
useFakeClock();

describe('Screen Reader Announce', () => {
  test('ports match the spec', () => {
    const inputs = Object.keys(Def.metadata.inputs).filter((n) => n !== 'functionScript').sort();
    expect(inputs).toEqual(['announce', 'text', 'politeness', 'clearAfterMs'].sort());
    expect(Object.keys(Def.metadata.outputs).sort()).toEqual(['lastAnnouncement', 'announcedCount', 'announced'].sort());
    expect(Def.metadata.outputs.announced.type).toBe('signal');
  });

  test('announce records the text, counts, and fires each time', async () => {
    const h = await mount(Def, { text: 'Big win 500', politeness: 'assertive', clearAfterMs: 1000 });
    expect(h.out('announcedCount')).toBe(0);
    h.fire('announce');
    expect(h.out('lastAnnouncement')).toBe('Big win 500');
    expect(h.out('announcedCount')).toBe(1);
    expect(h.count('announced')).toBe(1);
    h.set('text', 'Free spins');
    h.fire('announce');
    expect(h.out('lastAnnouncement')).toBe('Free spins');
    expect(h.out('announcedCount')).toBe(2);
    expect(h.count('announced')).toBe(2);
    h.advance(1500); // clear timer runs without a document and must not throw
    expect(h.out('announcedCount')).toBe(2);
  });
});
