// Volume Ramp (slot feature 24): from/to over durationMs, easing curves, tick per frame,
// finished once, stop freezes, immediate when durationMs is 0, frame cleanup on delete.
'use strict';

const { defineFeature, mount, useFakeClock } = require('./harness');

const VolumeRamp = defineFeature('volume-ramp.js');

useFakeClock();

describe('Volume Ramp', () => {
  test('module shape and metadata', () => {
    const mod = require('../../../../private/xgenia-pro-nodes/src/slot-games/features/volume-ramp.js');
    expect(Object.keys(mod)).toEqual(['node']);
    expect(mod.node.name).toBe('Volume Ramp');
    expect(mod.node.category).toBe('Utilities');
    expect(mod.node.docs).toBe('https://docsapp.xgenia.com/nodes/slot-features/volume-ramp');
    expect(typeof mod.node.description).toBe('string');
    const inputs = Object.keys(VolumeRamp.metadata.inputs).filter((n) => n !== 'functionScript');
    expect(inputs.sort()).toEqual(['start', 'from', 'to', 'durationMs', 'easing', 'stop'].sort());
    expect(Object.keys(VolumeRamp.metadata.outputs).sort()).toEqual(
      ['value', 'progress', 'running', 'finished', 'tick'].sort()
    );
    expect(VolumeRamp.metadata.inputs.easing.type.name).toBe('enum');
    expect(VolumeRamp.metadata.inputs.easing.type.enums.map((e) => e.value)).toEqual(
      ['linear', 'easeIn', 'easeOut', 'easeInOut']
    );
  });

  test('linear ramp 0 -> 1 over 1000ms: ticks each frame, finishes once at exactly `to`', async () => {
    const h = await mount(VolumeRamp, {});
    h.fire('start');
    expect(h.out('running')).toBe(true);
    expect(h.out('value')).toBe(0);
    expect(h.out('progress')).toBe(0);
    expect(h.count('tick')).toBe(1); // frame 0
    h.advance(500);
    expect(h.out('value')).toBeGreaterThan(0.45);
    expect(h.out('value')).toBeLessThan(0.55);
    expect(h.out('progress')).toBeCloseTo(h.out('value'));
    expect(h.count('tick')).toBeGreaterThan(20);
    expect(h.count('finished')).toBe(0);
    h.advance(600);
    expect(h.out('value')).toBe(1);
    expect(h.out('progress')).toBe(1);
    expect(h.out('running')).toBe(false);
    expect(h.count('finished')).toBe(1);
    // the final frame ticks before it finishes
    expect(h.signals[h.signals.length - 1]).toBe('finished');
    expect(h.signals[h.signals.length - 2]).toBe('tick');
    expect(jest.getTimerCount()).toBe(0);
  });

  test('from/to are honoured, including a downward ramp (crossfade partner)', async () => {
    const h = await mount(VolumeRamp, { from: 1, to: 0, durationMs: 400 });
    h.fire('start');
    expect(h.out('value')).toBe(1);
    h.advance(200);
    expect(h.out('value')).toBeGreaterThan(0.4);
    expect(h.out('value')).toBeLessThan(0.6);
    h.advance(300);
    expect(h.out('value')).toBe(0);
    expect(h.count('finished')).toBe(1);
  });

  test('easing curves: easeIn is below linear at the midpoint, easeOut above, easeInOut is symmetric', async () => {
    const at = async (easing, ms) => {
      const h = await mount(VolumeRamp, { easing, durationMs: 1000 });
      h.fire('start');
      h.advance(ms);
      return h.out('value');
    };
    expect(await at('easeIn', 500)).toBeLessThan(0.3);
    expect(await at('easeIn', 500)).toBeGreaterThan(0.2);
    expect(await at('easeOut', 500)).toBeGreaterThan(0.7);
    expect(await at('easeOut', 500)).toBeLessThan(0.8);
    expect(await at('easeInOut', 250)).toBeLessThan(0.2);
    expect(await at('easeInOut', 750)).toBeGreaterThan(0.8);
    expect(await at('linear', 500)).toBeCloseTo(0.5, 1);
  });

  test('an unknown easing falls back to linear', async () => {
    const h = await mount(VolumeRamp, { easing: 'bounce', durationMs: 1000 });
    h.fire('start');
    h.advance(500);
    expect(h.out('value')).toBeCloseTo(0.5, 1);
  });

  test('stop freezes the value and never fires finished', async () => {
    const h = await mount(VolumeRamp, { durationMs: 1000 });
    h.fire('start');
    h.advance(300);
    const frozen = h.out('value');
    expect(frozen).toBeGreaterThan(0);
    h.fire('stop');
    expect(h.out('running')).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
    h.advance(2000);
    expect(h.out('value')).toBe(frozen);
    expect(h.count('finished')).toBe(0);
  });

  test('durationMs 0 jumps straight to the end', async () => {
    const h = await mount(VolumeRamp, { from: 0.2, to: 0.9, durationMs: 0 });
    h.fire('start');
    expect(h.out('value')).toBe(0.9);
    expect(h.out('progress')).toBe(1);
    expect(h.out('running')).toBe(false);
    expect(h.count('finished')).toBe(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('restart mid-ramp snaps back to `from`; finished is re-triggerable', async () => {
    const h = await mount(VolumeRamp, { durationMs: 500 });
    h.fire('start');
    h.advance(250);
    expect(h.out('value')).toBeGreaterThan(0.3);
    h.fire('start');
    expect(h.out('value')).toBe(0);
    expect(h.out('progress')).toBe(0);
    h.advance(600);
    expect(h.count('finished')).toBe(1);
    h.fire('start');
    h.advance(600);
    expect(h.count('finished')).toBe(2);
  });

  test('deleting the node mid-ramp cancels the frame (dispose path)', async () => {
    const h = await mount(VolumeRamp, { durationMs: 1000 });
    h.fire('start');
    h.advance(100);
    expect(jest.getTimerCount()).toBe(1);
    const ticks = h.count('tick');
    h.dispose();
    expect(jest.getTimerCount()).toBe(0);
    h.advance(2000);
    expect(h.count('tick')).toBe(ticks);
    expect(h.count('finished')).toBe(0);
  });

  test('getInspectInfo reports state', async () => {
    const h = await mount(VolumeRamp, {});
    expect(h.node.getInspectInfo()).toMatch(/Idle/);
    h.fire('start');
    expect(h.node.getInspectInfo()).toMatch(/Ramping/);
  });
});
