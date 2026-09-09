// Jurisdiction Rules (slot feature 28): defaults, a supplied rules object, and the
// rgs-fn __client-rules fetch (success and failure), with the loaded/failed signals.
'use strict';
const { defineFeature, mount, useFakeClock } = require('./harness');
const Def = defineFeature('jurisdiction-rules.js');
useFakeClock();

const flush = async (h) => { for (let i = 0; i < 4; i++) { await new Promise((r) => setImmediate(r)); h.ctx.update(); } };

describe('Jurisdiction Rules', () => {
  afterEach(() => { delete global.fetch; });

  test('ports match the spec', () => {
    const inputs = Object.keys(Def.metadata.inputs).filter((n) => n !== 'functionScript').sort();
    expect(inputs).toEqual(['rules', 'fetch', 'gameSlug', 'rgsUrl', 'fallbackAutoplay', 'fallbackTurbo', 'fallbackSlamStop', 'fallbackFeatureBuy'].sort());
    expect(Object.keys(Def.metadata.outputs).sort()).toEqual(['autoplayAllowed', 'turboAllowed', 'slamStopAllowed', 'featureBuyAllowed', 'maxStake', 'minSpinIntervalMs', 'realityCheckIntervalMin', 'netPositionDisplay', 'jurisdictionCode', 'source', 'loaded', 'failed', 'error'].sort());
    expect(Def.metadata.outputs.loaded.type).toBe('signal');
    expect(Def.metadata.outputs.failed.type).toBe('signal');
  });

  test('defaults are permissive and say so', async () => {
    const h = await mount(Def, {});
    expect(h.out('source')).toBe('default');
    expect(h.out('autoplayAllowed')).toBe(true);
    expect(h.out('turboAllowed')).toBe(true);
    expect(h.out('maxStake')).toBe(0);
    expect(h.out('minSpinIntervalMs')).toBe(0);
  });

  test('a supplied rules object wins over defaults', async () => {
    const h = await mount(Def, {});
    h.set('rules', { code: 'DE', autoplay_allowed: false, turbo_allowed: false, slam_stop_allowed: false, feature_buy_allowed: false, min_spin_interval_ms: 5000, max_stake: 100, reality_check_interval_min: 60, net_position_display: true });
    expect(h.out('source')).toBe('input');
    expect(h.out('jurisdictionCode')).toBe('DE');
    expect(h.out('autoplayAllowed')).toBe(false);
    expect(h.out('maxStake')).toBe(100);
    expect(h.out('minSpinIntervalMs')).toBe(5000);
    expect(h.out('realityCheckIntervalMin')).toBe(60);
    expect(h.out('netPositionDisplay')).toBe(true);
  });

  test('fetch reads __client-rules from rgs-fn and fires loaded', async () => {
    const calls = [];
    global.fetch = jest.fn((url) => { calls.push(String(url)); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ game_slug: 'g1', source: 'operator', jurisdiction: { code: 'GB', autoplay_allowed: false, turbo_allowed: false, slam_stop_allowed: false, feature_buy_allowed: false, min_spin_interval_ms: 2500, max_stake: null, reality_check_interval_min: null, net_position_display: false } }) }); });
    const h = await mount(Def, { gameSlug: 'g1', rgsUrl: 'https://x.test/functions/v1' });
    h.fire('fetch');
    await flush(h);
    expect(calls[0]).toBe('https://x.test/functions/v1/rgs-fn/g1/__client-rules');
    expect(h.out('source')).toBe('server');
    expect(h.out('jurisdictionCode')).toBe('GB');
    expect(h.out('autoplayAllowed')).toBe(false);
    expect(h.out('minSpinIntervalMs')).toBe(2500);
    expect(h.out('maxStake')).toBe(0);
    expect(h.count('loaded')).toBe(1);
    expect(h.count('failed')).toBe(0);
  });

  test('a failed fetch fires failed, keeps defaults and reports the error', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: 'Unknown game' }) }));
    const h = await mount(Def, { gameSlug: 'nope' });
    h.fire('fetch');
    await flush(h);
    expect(h.count('failed')).toBe(1);
    expect(h.count('loaded')).toBe(0);
    expect(typeof h.out('error')).toBe('string');
    expect(h.out('error').length).toBeGreaterThan(0);
    expect(h.out('source')).toBe('default');
    expect(h.out('autoplayAllowed')).toBe(true);
  });
});
