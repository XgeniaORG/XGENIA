// Audio Mixer (slot feature 23): master x channel x duck, mute, immediate vs ramped changes,
// re-triggerable `changed`, and frame cleanup on delete.
'use strict';

const { defineFeature, mount, useFakeClock } = require('./harness');

const AudioMixer = defineFeature('audio-mixer.js');

useFakeClock();

describe('Audio Mixer', () => {
  test('module shape and metadata', () => {
    const mod = require('../../../../private/xgenia-pro-nodes/src/slot-games/features/audio-mixer.js');
    expect(Object.keys(mod)).toEqual(['node']);
    expect(mod.node.name).toBe('Audio Mixer');
    expect(mod.node.category).toBe('Utilities');
    expect(mod.node.docs).toBe('https://docsapp.xgenia.com/nodes/slot-features/audio-mixer');
    expect(typeof mod.node.description).toBe('string');
    const inputs = Object.keys(AudioMixer.metadata.inputs).filter((n) => n !== 'functionScript');
    expect(inputs.sort()).toEqual(
      ['master', 'muted', 'music', 'sfx', 'voice', 'duck', 'unduck', 'duckLevel', 'duckMs', 'fadeMs'].sort()
    );
    expect(Object.keys(AudioMixer.metadata.outputs).sort()).toEqual(
      ['musicVolume', 'sfxVolume', 'voiceVolume', 'duckActive', 'changed'].sort()
    );
    expect(AudioMixer.metadata.outputs.changed.type).toBe('signal');
  });

  test('defaults: every channel at 1, not ducked, no spurious changed on load', async () => {
    const h = await mount(AudioMixer, {});
    expect(h.out('musicVolume')).toBe(1);
    expect(h.out('sfxVolume')).toBe(1);
    expect(h.out('voiceVolume')).toBe(1);
    expect(h.out('duckActive')).toBe(false);
    expect(h.signals).toEqual([]);
  });

  test('volume = master x channel; changed fires once per applied update', async () => {
    const h = await mount(AudioMixer, {});
    h.set('master', 0.5);
    expect(h.out('musicVolume')).toBeCloseTo(0.5);
    expect(h.out('sfxVolume')).toBeCloseTo(0.5);
    expect(h.count('changed')).toBe(1);
    h.set('music', 0.5);
    expect(h.out('musicVolume')).toBeCloseTo(0.25);
    expect(h.out('sfxVolume')).toBeCloseTo(0.5);
    expect(h.count('changed')).toBe(2);
  });

  test('levels are clamped to 0..1', async () => {
    const h = await mount(AudioMixer, {});
    h.set('master', 3);
    expect(h.out('musicVolume')).toBe(1);
    h.set('sfx', -1);
    expect(h.out('sfxVolume')).toBe(0);
  });

  test('muted forces 0 and unmuting restores the mix', async () => {
    const h = await mount(AudioMixer, { master: 0.8, voice: 0.5 });
    expect(h.out('voiceVolume')).toBeCloseTo(0.4);
    h.set('muted', true);
    expect(h.out('musicVolume')).toBe(0);
    expect(h.out('sfxVolume')).toBe(0);
    expect(h.out('voiceVolume')).toBe(0);
    h.set('muted', false);
    expect(h.out('musicVolume')).toBeCloseTo(0.8);
    expect(h.out('voiceVolume')).toBeCloseTo(0.4);
  });

  test('duck/unduck with duckMs 0 apply duckLevel immediately', async () => {
    const h = await mount(AudioMixer, { duckMs: 0, duckLevel: 0.25 });
    h.fire('duck');
    expect(h.out('duckActive')).toBe(true);
    expect(h.out('musicVolume')).toBeCloseTo(0.25);
    expect(h.out('sfxVolume')).toBeCloseTo(0.25);
    expect(h.count('changed')).toBe(1);
    h.fire('duck'); // already ducked: no-op
    expect(h.count('changed')).toBe(1);
    h.fire('unduck');
    expect(h.out('duckActive')).toBe(false);
    expect(h.out('musicVolume')).toBe(1);
    expect(h.count('changed')).toBe(2);
  });

  test('duck ramps over duckMs and settles exactly on the duck level', async () => {
    const h = await mount(AudioMixer, { duckMs: 250, duckLevel: 0.3 });
    h.fire('duck');
    expect(h.out('duckActive')).toBe(true);
    expect(h.out('musicVolume')).toBe(1); // first frame has not run yet
    h.advance(100);
    const mid = h.out('musicVolume');
    expect(mid).toBeLessThan(1);
    expect(mid).toBeGreaterThan(0.3);
    h.advance(200);
    expect(h.out('musicVolume')).toBeCloseTo(0.3);
    expect(h.out('sfxVolume')).toBeCloseTo(0.3);
    expect(h.count('changed')).toBeGreaterThan(2); // one per frame
    expect(jest.getTimerCount()).toBe(0); // ramp finished, no frame left
  });

  test('fadeMs ramps any level change; a new change restarts from the current value', async () => {
    const h = await mount(AudioMixer, { fadeMs: 200 });
    h.set('master', 0);
    h.advance(100);
    const mid = h.out('musicVolume');
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    // Reverse mid-ramp: continues from `mid`, not from 0.
    h.set('master', 1);
    h.advance(16);
    expect(h.out('musicVolume')).toBeGreaterThanOrEqual(mid - 1e-9);
    h.advance(300);
    expect(h.out('musicVolume')).toBeCloseTo(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('fadeMs 0 changes are immediate', async () => {
    const h = await mount(AudioMixer, { fadeMs: 0 });
    h.set('master', 0.2);
    expect(h.out('musicVolume')).toBeCloseTo(0.2);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('deleting the node mid-ramp cancels the frame (dispose path)', async () => {
    const h = await mount(AudioMixer, { fadeMs: 1000 });
    h.set('master', 0);
    h.advance(50);
    expect(jest.getTimerCount()).toBe(1);
    const before = h.count('changed');
    h.dispose();
    expect(jest.getTimerCount()).toBe(0);
    h.advance(2000);
    expect(h.count('changed')).toBe(before);
  });

  test('getInspectInfo shows the three volumes', async () => {
    const h = await mount(AudioMixer, { muted: true });
    expect(h.node.getInspectInfo()).toMatch(/music 0\.00/);
    expect(h.node.getInspectInfo()).toMatch(/MUTED/);
  });
});
