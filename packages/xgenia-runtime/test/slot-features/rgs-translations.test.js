// RGS Translations (platform exposure): the game-translations catalogue fetch, key lookup with
// a key fallback, the language list, and the failure path.
'use strict';
const { defineFeature, mount, useFakeClock } = require('./harness');
const Def = defineFeature('rgs-translations.js');
useFakeClock();
const flush = async (h) => { for (let i = 0; i < 4; i++) { await new Promise((r) => setImmediate(r)); h.ctx.update(); } };

describe('RGS Translations', () => {
  afterEach(() => { delete global.fetch; });

  test('ports', () => {
    const inputs = Object.keys(Def.metadata.inputs).filter((n) => n !== 'functionScript').sort();
    expect(inputs).toEqual(['fetch', 'listLanguages', 'gameSlug', 'lang', 'rgsUrl', 'key'].sort());
    expect(Object.keys(Def.metadata.outputs).sort()).toEqual(['strings', 'text', 'lang', 'requestedLang', 'fallback', 'languages', 'error', 'loaded', 'failed'].sort());
  });

  test('fetch loads the catalogue, text follows key, missing keys fall back to the key', async () => {
    const calls = [];
    global.fetch = jest.fn((url) => { calls.push(String(url)); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ result: true, requested_lang: 'pt-BR', lang: 'pt', fallback: true, strings: { spin: 'Girar', balance: 'Saldo' } }) }); });
    const h = await mount(Def, { gameSlug: 'g1', lang: 'pt-BR', rgsUrl: 'https://x.test/functions/v1/', key: 'spin' });
    expect(h.out('text')).toBe('spin'); // nothing loaded yet: the key itself
    h.fire('fetch');
    await flush(h);
    expect(calls[0]).toBe('https://x.test/functions/v1/game-translations?lang=pt-BR&game_slug=g1');
    expect(h.out('strings')).toEqual({ spin: 'Girar', balance: 'Saldo' });
    expect(h.out('text')).toBe('Girar');
    expect(h.out('lang')).toBe('pt');
    expect(h.out('requestedLang')).toBe('pt-BR');
    expect(h.out('fallback')).toBe(true);
    expect(h.count('loaded')).toBe(1);
    h.set('key', 'balance');
    expect(h.out('text')).toBe('Saldo');
    h.set('key', 'jackpot');
    expect(h.out('text')).toBe('jackpot');
  });

  test('listLanguages fills languages', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ languages: ['de', 'en', 'pt-BR'] }) }));
    const h = await mount(Def, {});
    h.fire('listLanguages');
    await flush(h);
    expect(h.out('languages')).toEqual(['de', 'en', 'pt-BR']);
    expect(global.fetch.mock.calls[0][0]).toContain('/game-translations?langs=1');
  });

  test('a failed fetch fires failed and keeps the last good catalogue', async () => {
    let n = 0;
    global.fetch = jest.fn(() => { n++; return n === 1 ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ lang: 'en', requested_lang: 'en', fallback: false, strings: { spin: 'Spin' } }) }) : Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: 'No translations available' }) }); });
    const h = await mount(Def, { gameSlug: 'g1' });
    h.fire('fetch');
    await flush(h);
    expect(h.out('strings')).toEqual({ spin: 'Spin' });
    h.set('lang', 'xx');
    h.fire('fetch');
    await flush(h);
    expect(h.count('failed')).toBe(1);
    expect(h.out('error')).toBe('No translations available');
    expect(h.out('strings')).toEqual({ spin: 'Spin' });
  });
});
