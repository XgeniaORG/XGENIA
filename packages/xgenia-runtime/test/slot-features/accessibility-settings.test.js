// Accessibility Settings (slot feature 29): reduced motion on/off/auto, the motion scale,
// colour-blind palettes and the changed signal.
'use strict';
const { defineFeature, mount, useFakeClock } = require('./harness');
const Def = defineFeature('accessibility-settings.js');
useFakeClock();

describe('Accessibility Settings', () => {
  test('ports match the spec', () => {
    const inputs = Object.keys(Def.metadata.inputs).filter((n) => n !== 'functionScript').sort();
    expect(inputs).toEqual(['reducedMotion', 'highContrast', 'colourBlindMode', 'motionScaleWhenReduced', 'refresh'].sort());
    expect(Object.keys(Def.metadata.outputs).sort()).toEqual(['reducedMotion', 'motionScale', 'highContrast', 'colourBlindMode', 'palette', 'changed'].sort());
    expect(Def.metadata.outputs.changed.type).toBe('signal');
  });

  test('forcing reduced motion on scales motion down; off restores 1', async () => {
    const h = await mount(Def, { reducedMotion: 'on', motionScaleWhenReduced: 0.25 });
    expect(h.out('reducedMotion')).toBe(true);
    expect(h.out('motionScale')).toBe(0.25);
    h.set('reducedMotion', 'off');
    expect(h.out('reducedMotion')).toBe(false);
    expect(h.out('motionScale')).toBe(1);
  });

  test('auto without a browser reports no reduced motion', async () => {
    const h = await mount(Def, { reducedMotion: 'auto' });
    expect(h.out('reducedMotion')).toBe(false);
    expect(h.out('motionScale')).toBe(1);
  });

  test('palettes: six distinct colours per mode, and the mode is echoed', async () => {
    const h = await mount(Def, {});
    const base = h.out('palette');
    expect(base && typeof base).toBe('object');
    const colours = Array.isArray(base) ? base : Object.values(base);
    expect(colours.length).toBeGreaterThanOrEqual(6);
    expect(new Set(colours).size).toBe(colours.length);
    h.set('colourBlindMode', 'deuteranopia');
    expect(h.out('colourBlindMode')).toBe('deuteranopia');
    const alt = h.out('palette');
    expect(JSON.stringify(alt)).not.toBe(JSON.stringify(base));
    h.set('highContrast', true);
    expect(h.out('highContrast')).toBe(true);
  });

  test('changed fires on a real change, not on a refresh that changes nothing', async () => {
    const h = await mount(Def, {});
    const before = h.count('changed');
    h.fire('refresh'); // no OS setting to re-read in Node, nothing changes
    expect(h.count('changed')).toBe(before);
    h.set('colourBlindMode', 'tritanopia');
    expect(h.count('changed')).toBe(before + 1);
    h.set('reducedMotion', 'on');
    expect(h.count('changed')).toBe(before + 2);
  });
});
