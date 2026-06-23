const { getAbsoluteUrl } = require('../src/utils');

// Locks getAbsoluteUrl's contract: existing (non-uid) inputs must resolve EXACTLY as
// before, and the new `uid://` indirection must resolve via XGENIA.assetsManifest with a
// safe fallback. getAbsoluteUrl reads a global `XGENIA`; we set/clear it per test.
describe('getAbsoluteUrl', () => {
  afterEach(() => {
    delete global.XGENIA;
  });

  describe('backward compatibility — non-uid inputs unchanged', () => {
    test('absolute http/https returned as-is', () => {
      expect(getAbsoluteUrl('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png');
      expect(getAbsoluteUrl('http://x/a.png')).toBe('http://x/a.png');
    });

    test('data: URLs returned as-is', () => {
      expect(getAbsoluteUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    });

    test('empty string returned as-is', () => {
      expect(getAbsoluteUrl('')).toBe('');
    });

    test('relative path with no base resolves against "/"', () => {
      expect(getAbsoluteUrl('assets/x.png')).toBe('/assets/x.png');
    });

    test('root-absolute path joins a nested base', () => {
      global.XGENIA = { Env: { BaseUrl: '/game/v1/' } };
      expect(getAbsoluteUrl('/assets/x.png')).toBe('/game/v1/assets/x.png');
    });

    test('relative path joins an absolute base', () => {
      global.XGENIA = { Env: { BaseUrl: 'https://cdn/' } };
      expect(getAbsoluteUrl('assets/x.png')).toBe('https://cdn/assets/x.png');
    });

    test('a value containing "uid://" NOT at the start is treated as a normal URL', () => {
      // e.g. a query param — must not be mistaken for a stable ref
      expect(getAbsoluteUrl('https://x/p?u=uid://abc')).toBe('https://x/p?u=uid://abc');
    });
  });

  describe('uid:// stable references', () => {
    test('resolves via manifest, then applies the base URL', () => {
      global.XGENIA = { Env: { BaseUrl: 'https://cdn/' }, assetsManifest: { abc: 'assets/x.png' } };
      expect(getAbsoluteUrl('uid://abc')).toBe('https://cdn/assets/x.png');
    });

    test('uid mapping to a root-absolute path joins a nested base', () => {
      global.XGENIA = { Env: { BaseUrl: '/game/v1/' }, assetsManifest: { abc: '/assets/x.png' } };
      expect(getAbsoluteUrl('uid://abc')).toBe('/game/v1/assets/x.png');
    });

    test('unknown id returns the raw ref (no silent mis-resolve)', () => {
      global.XGENIA = { Env: { BaseUrl: 'https://cdn/' }, assetsManifest: {} };
      expect(getAbsoluteUrl('uid://nope')).toBe('uid://nope');
    });

    test('missing manifest returns the raw ref', () => {
      global.XGENIA = { Env: { BaseUrl: 'https://cdn/' } };
      expect(getAbsoluteUrl('uid://abc')).toBe('uid://abc');
    });
  });
});
