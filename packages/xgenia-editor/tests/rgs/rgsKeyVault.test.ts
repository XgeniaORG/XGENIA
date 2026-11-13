// The XGENIA RGS operator key at rest: in the OS keychain, never in localStorage.
//
// XRGS GO_TO_MARKET_PLAN G1-S14. The key used to be plaintext in
// `xgenia_rgs_settings.apiKey`. rgsClient now keeps it encrypted through an
// RgsKeyVault (Electron safeStorage via store/_internal/StorageApi in the editor),
// decrypted once into memory so getRgsSettings() stays synchronous. A fake vault
// stands in for the keychain here; these fail if the key ever lands in
// localStorage again while a vault is available, if an existing plaintext key is
// not migrated, or if a missing/broken keychain loses the key.
//   TSX_TSCONFIG_PATH=packages/xgenia-editor/tsconfig.json npx -y tsx@4.19.2 --test --test-force-exit packages/xgenia-editor/tests/rgs/rgsKeyVault.test.ts
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

class MemoryStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  dump() { return [...this.m.values()].join('\n'); }
}
const storage = new MemoryStorage();
(globalThis as any).localStorage = storage;

type RgsClient = typeof import('../../src/editor/src/utils/rgs/rgsClient');
let rgs: RgsClient;
before(async () => {
  rgs = await import('../../src/editor/src/utils/rgs/rgsClient');
});
const KEY = 'xrgs_live_secret_key_1234';
const SETTINGS = 'xgenia_rgs_settings';

/** A keychain: "encrypts" by reversing and tagging, so plaintext never appears in the ciphertext. */
function fakeVault(opts: { available?: boolean; encryptFails?: boolean; decryptFails?: boolean } = {}) {
  const calls = { encrypt: 0, decrypt: 0 };
  return {
    calls,
    isAvailable: async () => opts.available !== false,
    encrypt: async (p: string) => {
      calls.encrypt++;
      if (opts.encryptFails) throw new Error('keychain locked');
      return `ENC(${[...p].reverse().join('')})`;
    },
    decrypt: async (c: string) => {
      calls.decrypt++;
      if (opts.decryptFails) return undefined;
      const m = /^ENC\((.*)\)$/.exec(c);
      return m ? [...m[1]].reverse().join('') : undefined;
    }
  };
}

const quiet = <T>(fn: () => Promise<T>) => {
  const { warn, error } = console;
  console.warn = () => {};
  console.error = () => {};
  return fn().finally(() => { console.warn = warn; console.error = error; });
};

beforeEach(() => {
  storage.clear();
  rgs.resetRgsKeyVaultForTests();
});

test('an existing plaintext key is moved into the keychain on first run and read back synchronously', async () => {
  storage.setItem(SETTINGS, JSON.stringify({ apiKey: KEY, rgsUrl: 'u', testSettings: { rtp: 96 }, activeGameByProject: { p: { id: 'g' } } }));
  await rgs.initRgsKeyVault(fakeVault());
  assert.equal(rgs.getRgsSettings()?.apiKey, KEY);
  const stored = JSON.parse(storage.getItem(SETTINGS)!);
  assert.equal('apiKey' in stored, false, 'the plaintext key is still in localStorage');
  assert.deepEqual(stored.testSettings, { rtp: 96 }, 'other settings survive the migration');
  assert.equal(storage.dump().includes(KEY), false);
  assert.ok(storage.getItem(rgs.RGS_KEY_CIPHER_KEY));
});

test('a restart decrypts the stored key once; callers stay synchronous', async () => {
  storage.setItem(SETTINGS, JSON.stringify({ apiKey: KEY }));
  await rgs.initRgsKeyVault(fakeVault());
  rgs.resetRgsKeyVaultForTests(); // "restart": memory gone, storage kept
  assert.equal(rgs.getRgsSettings(), null, 'nothing readable before the keychain answers');
  const vault = fakeVault();
  await rgs.initRgsKeyVault(vault);
  assert.equal(vault.calls.decrypt, 1);
  for (let i = 0; i < 3; i++) assert.equal(rgs.getRgsSettings()?.apiKey, KEY);
  assert.equal(vault.calls.decrypt, 1);
  assert.equal(rgs.isRgsConnected(), true);
});

test('a key saved after sign-in goes to memory at once and to the keychain, never to localStorage', async () => {
  await rgs.initRgsKeyVault(fakeVault());
  rgs.saveRgsSettings(KEY);
  assert.equal(rgs.getRgsSettings()?.apiKey, KEY, 'readable synchronously, before encryption finishes');
  await rgs.flushRgsKeyWrites();
  assert.equal(storage.dump().includes(KEY), false);
  rgs.setActiveGame({ id: 'g1', slug: 'reel' });
  assert.equal(storage.dump().includes(KEY), false, 'a later settings write put the key back');
  assert.equal(rgs.getRgsSettings()?.apiKey, KEY);
});

test('signing out clears the key from memory and the keychain copy', async () => {
  await rgs.initRgsKeyVault(fakeVault());
  rgs.saveRgsSettings(KEY);
  await rgs.flushRgsKeyWrites();
  rgs.clearRgsSettings();
  assert.equal(rgs.getRgsSettings(), null);
  assert.equal(storage.getItem(rgs.RGS_KEY_CIPHER_KEY), null);
});

test('no keychain: the key stays where it was (plaintext, as before) rather than being lost', async () => {
  storage.setItem(SETTINGS, JSON.stringify({ apiKey: KEY }));
  await quiet(() => rgs.initRgsKeyVault(fakeVault({ available: false })));
  assert.equal(rgs.getRgsSettings()?.apiKey, KEY);
  rgs.saveRgsSettings('another_key');
  assert.equal(JSON.parse(storage.getItem(SETTINGS)!).apiKey, 'another_key');
});

test('a keychain that refuses to encrypt keeps the key usable after a restart', async () => {
  storage.setItem(SETTINGS, JSON.stringify({ apiKey: KEY }));
  await quiet(() => rgs.initRgsKeyVault(fakeVault({ encryptFails: true })));
  assert.equal(rgs.getRgsSettings()?.apiKey, KEY);
  assert.equal(JSON.parse(storage.getItem(SETTINGS)!).apiKey, KEY, 'the only copy was deleted');

  storage.clear();
  rgs.resetRgsKeyVaultForTests();
  const vault = fakeVault();
  await rgs.initRgsKeyVault(vault);
  // Now break it for the next save only.
  vault.encrypt = async () => { throw new Error('keychain locked'); };
  await quiet(async () => {
    rgs.saveRgsSettings(KEY);
    await rgs.flushRgsKeyWrites();
  });
  assert.equal(JSON.parse(storage.getItem(SETTINGS)!).apiKey, KEY);
});

test('an undecryptable stored key reads as signed out, not as an error', async () => {
  storage.setItem(SETTINGS, JSON.stringify({}));
  storage.setItem(rgs.RGS_KEY_CIPHER_KEY, 'ENC(garbage-from-another-machine');
  await quiet(() => rgs.initRgsKeyVault(fakeVault({ decryptFails: true })));
  assert.equal(rgs.getRgsSettings(), null);
});
