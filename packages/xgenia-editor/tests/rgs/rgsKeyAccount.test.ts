// The XGENIA RGS key belongs to the XGENIA account it was obtained under — not to the install.
//
// Before 2026-11-13 the stored key outlived the XGENIA sign-out: the next person to sign in to this
// editor published into the previous person's studio without ever signing in to the RGS. rgsClient
// now stamps a key with the account that was signed in when it was saved and reads it only while that
// account is signed in ("The key belongs to the XGENIA account…" in rgsClient.ts).
//
// Refusals first. These fail if a key is ever readable by another account or by nobody; if it comes
// back after being destroyed (the keychain answering late); if the order in which the keychain and the
// session answer at startup can show it to the wrong account; or if a lapsed session costs its owner
// their connection.
//   TSX_TSCONFIG_PATH=packages/xgenia-editor/tsconfig.json npx -y tsx@4.19.2 --test --test-force-exit packages/xgenia-editor/tests/rgs/rgsKeyAccount.test.ts
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
let events: Array<[string, unknown]> = [];
before(async () => {
  rgs = await import('../../src/editor/src/utils/rgs/rgsClient');
  const { EventDispatcher } = await import('@xgenia-shared/utils/EventDispatcher');
  const group = { name: 'rgs-key-account-test' };
  for (const name of ['rgs.connected', 'rgs.gameSelected']) {
    EventDispatcher.instance.on(name, (payload: unknown) => { events.push([name, payload]); }, group);
  }
});

const KEY = 'xrgs_live_secret_key_1234';
const OTHER_KEY = 'xrgs_other_secret_key_5678';
const SETTINGS = 'xgenia_rgs_settings';
const ADA = 'user-ada';
const BEN = 'user-ben';
const ENC = (p: string) => `ENC(${[...p].reverse().join('')})`;

/** A keychain. `gate` lets a test hold decrypt back until it says so. */
function fakeVault(opts: { available?: boolean; gate?: Promise<void> } = {}) {
  const calls = { encrypt: 0, decrypt: 0 };
  return {
    calls,
    isAvailable: async () => opts.available !== false,
    encrypt: async (p: string) => { calls.encrypt++; return ENC(p); },
    decrypt: async (c: string) => {
      calls.decrypt++;
      if (opts.gate) await opts.gate;
      const m = /^ENC\((.*)\)$/.exec(c);
      return m ? [...m[1]].reverse().join('') : undefined;
    }
  };
}

/** Who is signed in to XGENIA. `initial` may be a promise the test settles later, or one that rejects. */
function fakeAccount(initial: string | null | Promise<string | null>) {
  let listener: ((id: string | null) => void) | null = null;
  return {
    current: () => Promise.resolve(initial),
    onChange: (l: (id: string | null) => void) => { listener = l; },
    /** An auth event: this account is signed in now (null: nobody). */
    fire: (id: string | null) => { assert.ok(listener, 'no auth listener was attached'); listener!(id); }
  };
}
function gate<T = void>() {
  let open!: (v: T) => void;
  let fail!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { open = res; fail = rej; });
  return { promise, open, fail };
}
const tick = () => new Promise<void>((r) => setTimeout(r, 5));
const quiet = async <T>(fn: () => Promise<T> | T) => {
  const { warn, error } = console;
  console.warn = () => {};
  console.error = () => {};
  try { return await fn(); } finally { console.warn = warn; console.error = error; }
};
/** Storage as an editor left it after `owner` connected: the key in the keychain, stamped. */
function leftBy(owner: string | null, key = KEY) {
  storage.setItem(SETTINGS, JSON.stringify({ rgsUrl: 'u', activeGameByProject: { p: { id: 'g', slug: 'reel' } } }));
  storage.setItem(rgs.RGS_KEY_CIPHER_KEY, ENC(key));
  if (owner) storage.setItem(rgs.RGS_KEY_OWNER_KEY, owner);
}
const gone = () => storage.getItem(rgs.RGS_KEY_CIPHER_KEY) === null && storage.getItem(rgs.RGS_KEY_OWNER_KEY) === null && storage.getItem(SETTINGS) === null;

beforeEach(() => {
  storage.clear();
  rgs.resetRgsKeyVaultForTests();
  events = [];
});

test('another account\'s key is never readable, and is destroyed when that account signs in', async () => {
  leftBy(ADA);
  await quiet(() => rgs.initRgsKeyVault(fakeVault(), fakeAccount(BEN)));
  assert.equal(rgs.getRgsSettings(), null, 'Ben reads Ada\'s XGENIA RGS key');
  assert.equal(rgs.isRgsConnected(), false);
  assert.ok(gone(), 'Ada\'s key, its owner mark or her game selection is still on the machine Ben signed in to');
  await tick();
  assert.deepEqual(events, [['rgs.gameSelected', null]], 'the panels were not told the connection is gone');
  // Ben connects to HIS studio: the key is his from then on.
  rgs.saveRgsSettings({ apiKey: OTHER_KEY, rgsUrl: 'u' });
  await rgs.flushRgsKeyWrites();
  assert.equal(rgs.getRgsSettings()?.apiKey, OTHER_KEY);
  assert.equal(storage.getItem(rgs.RGS_KEY_OWNER_KEY), BEN);
});

test('nobody signed in: an owned key is not readable — and is kept for its owner', async () => {
  leftBy(ADA);
  const account = fakeAccount(null);
  const vault = fakeVault();
  await rgs.initRgsKeyVault(vault, account);
  assert.equal(rgs.getRgsSettings(), null, 'a key is readable while nobody is signed in to XGENIA');
  assert.equal(storage.getItem(rgs.RGS_KEY_CIPHER_KEY), ENC(KEY), 'a signed-out start threw the owner\'s connection away');
  await tick();
  assert.deepEqual(events, [], 'the panels were told of a connection nobody has');
  // Ada signs in: connected, without connecting again.
  account.fire(ADA);
  assert.equal(rgs.getRgsSettings()?.apiKey, KEY);
  assert.equal(vault.calls.decrypt, 1);
  await tick();
  assert.deepEqual(events, [['rgs.connected', { restored: true }]]);
});

test('a session that lapses locks the key; the same account signing in again unlocks it; a different one destroys it', async () => {
  const account = fakeAccount(ADA);
  await rgs.initRgsKeyVault(fakeVault(), account);
  rgs.saveRgsSettings({ apiKey: KEY, rgsUrl: 'u' });
  await rgs.flushRgsKeyWrites();
  assert.equal(storage.getItem(rgs.RGS_KEY_OWNER_KEY), ADA, 'a saved key is not stamped with who was signed in');
  assert.equal(storage.dump().includes(KEY), false);

  account.fire(null);                       // the session lapsed
  assert.equal(rgs.getRgsSettings(), null, 'the key outlived the XGENIA session');
  assert.equal(storage.getItem(rgs.RGS_KEY_CIPHER_KEY), ENC(KEY), 'a lapsed session cost its owner the connection');
  account.fire(ADA);                        // the same person, back
  assert.equal(rgs.getRgsSettings()?.apiKey, KEY);
  account.fire(ADA);                        // a token refresh is not a change
  assert.equal(rgs.getRgsSettings()?.apiKey, KEY);
  await tick();
  assert.deepEqual(events.map(([n]) => n), ['rgs.gameSelected', 'rgs.connected']);

  await quiet(() => account.fire(BEN));     // someone else, in the open editor
  assert.equal(rgs.getRgsSettings(), null, 'Ben reads Ada\'s key');
  assert.ok(gone());
  account.fire(ADA);                        // and it does not come back for Ada: it was destroyed, not hidden
  assert.equal(rgs.getRgsSettings(), null);
});

test('the keychain answers after a different account has signed in: the destroyed key stays destroyed', async () => {
  leftBy(ADA);
  const slow = gate();
  const session = gate<string | null>();
  const vault = fakeVault({ gate: slow.promise });
  const ready = rgs.initRgsKeyVault(vault, fakeAccount(session.promise));
  await tick();
  assert.equal(vault.calls.decrypt, 1, 'the keychain was not asked yet: this test would prove nothing');
  await quiet(async () => { session.open(BEN); await tick(); });   // Ben is known while the keychain is still answering
  assert.ok(gone());
  slow.open();                              // now the keychain hands back Ada's key
  await quiet(() => ready);
  assert.equal(rgs.getRgsSettings(), null, 'a late keychain answer put Ada\'s key back in memory for Ben');
  assert.equal(rgs.isRgsConnected(), false);
});

test('at startup the key is not readable until its owner is known to be signed in — whichever answers first', async () => {
  // The keychain first, the session later.
  leftBy(ADA);
  let session = gate<string | null>();
  let ready = rgs.initRgsKeyVault(fakeVault(), fakeAccount(session.promise));
  await tick();
  assert.equal(rgs.getRgsSettings(), null, 'the key was readable before anyone was known to be signed in');
  session.open(ADA);
  await ready;
  assert.equal(rgs.getRgsSettings()?.apiKey, KEY);

  // The session first, the keychain later.
  storage.clear(); rgs.resetRgsKeyVaultForTests(); leftBy(ADA);
  const slow = gate();
  ready = rgs.initRgsKeyVault(fakeVault({ gate: slow.promise }), fakeAccount(ADA));
  await tick();
  assert.equal(rgs.getRgsSettings(), null);
  slow.open();
  await ready;
  assert.equal(rgs.getRgsSettings()?.apiKey, KEY);

  // An auth event that arrives before the startup snapshot wins: the snapshot is older.
  storage.clear(); rgs.resetRgsKeyVaultForTests(); leftBy(ADA);
  session = gate<string | null>();
  const account = fakeAccount(session.promise);
  ready = rgs.initRgsKeyVault(fakeVault(), account);
  await tick();
  account.fire(null);                       // the session ended while the snapshot ("Ada") was still on its way
  session.open(ADA);
  await ready;
  assert.equal(rgs.getRgsSettings(), null, 'a stale startup answer unlocked the key after the session had ended');
  assert.equal(storage.getItem(rgs.RGS_KEY_CIPHER_KEY), ENC(KEY));
});

test('who is signed in cannot be told at startup: an owned key stays locked until an auth event says', async () => {
  leftBy(ADA);
  const account = fakeAccount(Promise.reject(new Error('offline')));
  await quiet(() => rgs.initRgsKeyVault(fakeVault(), account));
  assert.equal(rgs.getRgsSettings(), null, 'an unknown session was treated as the owner\'s');
  assert.equal(storage.getItem(rgs.RGS_KEY_CIPHER_KEY), ENC(KEY));
  account.fire(ADA);
  assert.equal(rgs.getRgsSettings()?.apiKey, KEY);
});

test('a key with no owner (an older editor\'s) is adopted by the first account to sign in — once', async () => {
  storage.setItem(SETTINGS, JSON.stringify({ apiKey: KEY, rgsUrl: 'u' }));   // plaintext, no owner: the oldest shape
  await rgs.initRgsKeyVault(fakeVault(), fakeAccount(ADA));
  assert.equal(rgs.getRgsSettings()?.apiKey, KEY, 'the update disconnected the person who was connected');
  assert.equal(storage.getItem(rgs.RGS_KEY_OWNER_KEY), ADA);
  assert.equal(storage.dump().includes(KEY), false, 'the plaintext key was not moved into the keychain');
  // From now on it is Ada's: Ben does not get it.
  rgs.resetRgsKeyVaultForTests();
  await quiet(() => rgs.initRgsKeyVault(fakeVault(), fakeAccount(BEN)));
  assert.equal(rgs.getRgsSettings(), null);
  assert.ok(gone());
});

test('a key saved while nobody is signed in works, and belongs to the next account to sign in', async () => {
  const account = fakeAccount(null);
  await rgs.initRgsKeyVault(fakeVault(), account);
  rgs.saveRgsSettings({ apiKey: KEY, rgsUrl: 'u' });
  await rgs.flushRgsKeyWrites();
  assert.equal(rgs.getRgsSettings()?.apiKey, KEY);
  assert.equal(storage.getItem(rgs.RGS_KEY_OWNER_KEY), null);
  account.fire(ADA);
  assert.equal(storage.getItem(rgs.RGS_KEY_OWNER_KEY), ADA);
  assert.equal(rgs.getRgsSettings()?.apiKey, KEY);
  await quiet(() => account.fire(BEN));
  assert.equal(rgs.getRgsSettings(), null);
});

test('a new connection replaces the owner: Ben connecting over an unowned or lapsed key makes it his', async () => {
  const account = fakeAccount(BEN);
  await rgs.initRgsKeyVault(fakeVault(), account);
  rgs.saveRgsSettings({ apiKey: OTHER_KEY, rgsUrl: 'u' });
  await rgs.flushRgsKeyWrites();
  account.fire(null);
  assert.equal(rgs.getRgsSettings(), null);
  // Someone connects while signed out of XGENIA: the key saved now has no owner, and Ben's mark does not cover it.
  rgs.saveRgsSettings({ apiKey: KEY, rgsUrl: 'u' });
  await rgs.flushRgsKeyWrites();
  assert.equal(storage.getItem(rgs.RGS_KEY_OWNER_KEY), null, 'a key saved with nobody signed in kept the previous owner\'s mark');
  assert.equal(rgs.getRgsSettings()?.apiKey, KEY);
});

test('sign out, on purpose: the key, its owner mark and the game selection are gone', async () => {
  const account = fakeAccount(ADA);
  await rgs.initRgsKeyVault(fakeVault(), account);
  rgs.saveRgsSettings({ apiKey: KEY, rgsUrl: 'u' });
  rgs.setActiveGame({ id: 'g1', slug: 'reel' });
  await rgs.flushRgsKeyWrites();
  events = [];
  rgs.forgetRgsKeyOnSignOut();
  assert.equal(rgs.getRgsSettings(), null);
  assert.ok(gone(), 'something of the connection was left on the computer after Sign out');
  assert.deepEqual(events, [['rgs.gameSelected', null]]);
  // Nothing stored: it says nothing and breaks nothing.
  events = [];
  rgs.forgetRgsKeyOnSignOut();
  assert.deepEqual(events, []);
  // The same person signing back in is not connected by a key that is gone.
  account.fire(null); account.fire(ADA);
  assert.equal(rgs.getRgsSettings(), null);
});

test('no keychain: the owner rule holds for a plaintext key too', async () => {
  storage.setItem(SETTINGS, JSON.stringify({ apiKey: KEY, rgsUrl: 'u' }));
  storage.setItem(rgs.RGS_KEY_OWNER_KEY, ADA);
  const account = fakeAccount(BEN);
  await quiet(() => rgs.initRgsKeyVault(fakeVault({ available: false }), account));
  assert.equal(rgs.getRgsSettings(), null, 'Ben reads Ada\'s key from local storage');
  assert.equal(storage.dump().includes(KEY), false, 'Ada\'s plaintext key was left on the machine');
});

test('without an account source nothing changes: the key is the install\'s, as in a build with no XGENIA sign-in', async () => {
  leftBy(ADA);
  await rgs.initRgsKeyVault(fakeVault());
  assert.equal(rgs.getRgsSettings()?.apiKey, KEY);
  rgs.saveRgsSettings({ apiKey: OTHER_KEY, rgsUrl: 'u' });
  await rgs.flushRgsKeyWrites();
  assert.equal(storage.getItem(rgs.RGS_KEY_OWNER_KEY), ADA, 'an unbound editor rewrote the owner mark');
  assert.equal(rgs.getRgsSettings()?.apiKey, OTHER_KEY);
});
