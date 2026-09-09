// Telemetry Event (slot feature 33): batching by time and size, the flush signal, the
// payload shape with a session id, and the failure path.
'use strict';
const { defineFeature, mount, useFakeClock } = require('./harness');
const Def = defineFeature('telemetry-event.js');
useFakeClock();

const flush = async (h) => { for (let i = 0; i < 4; i++) { await new Promise((r) => setImmediate(r)); h.ctx.update(); } };

describe('Telemetry Event', () => {
  afterEach(() => { delete global.fetch; });

  test('ports match the spec', () => {
    const inputs = Object.keys(Def.metadata.inputs).filter((n) => n !== 'functionScript').sort();
    expect(inputs).toEqual(['send', 'event', 'payload', 'endpoint', 'headers', 'batch', 'flushMs', 'maxBatch', 'flush', 'sessionId'].sort());
    expect(Object.keys(Def.metadata.outputs).sort()).toEqual(['queued', 'sent', 'failed', 'flushed', 'sendFailed', 'error'].sort());
  });

  test('batched events are queued, then posted together after flushMs with a session id', async () => {
    const bodies = [];
    global.fetch = jest.fn((url, init) => { bodies.push({ url, init }); return Promise.resolve({ ok: true, status: 200 }); });
    const h = await mount(Def, { endpoint: 'https://t.test/ingest', batch: true, flushMs: 2000, maxBatch: 20, event: 'spin', payload: { bet: 100 } });
    h.fire('send');
    h.set('event', 'win');
    h.fire('send');
    expect(h.out('queued')).toBe(2);
    expect(bodies).toHaveLength(0);
    h.advance(2000);
    await flush(h);
    expect(bodies).toHaveLength(1);
    expect(bodies[0].url).toBe('https://t.test/ingest');
    const parsed = JSON.parse(bodies[0].init.body);
    expect(parsed.events).toHaveLength(2);
    expect(parsed.events.map((e) => e.event)).toEqual(['spin', 'win']);
    expect(typeof parsed.events[0].sessionId).toBe('string');
    expect(parsed.events[0].sessionId.length).toBeGreaterThan(0);
    expect(typeof parsed.events[0].ts).toBe('number');
    expect(h.out('sent')).toBe(2);
    expect(h.out('queued')).toBe(0);
    expect(h.count('flushed')).toBe(1);
  });

  test('reaching maxBatch or firing flush posts immediately', async () => {
    let posts = 0;
    global.fetch = jest.fn(() => { posts++; return Promise.resolve({ ok: true, status: 200 }); });
    const h = await mount(Def, { endpoint: 'https://t.test/ingest', batch: true, flushMs: 60000, maxBatch: 3, event: 'e' });
    h.fire('send'); h.fire('send');
    expect(posts).toBe(0);
    h.fire('send');
    await flush(h);
    expect(posts).toBe(1);
    h.fire('send');
    h.fire('flush');
    await flush(h);
    expect(posts).toBe(2);
    expect(h.out('sent')).toBe(4);
  });

  test('a failed post fires sendFailed and counts the events as failed', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('offline')));
    const h = await mount(Def, { endpoint: 'https://t.test/ingest', batch: false, event: 'e' });
    h.fire('send');
    await flush(h);
    expect(h.count('sendFailed')).toBe(1);
    expect(h.out('failed')).toBeGreaterThan(0);
    expect(h.out('error')).toContain('offline');
  });
});
