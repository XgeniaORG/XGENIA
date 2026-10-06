// ─────────────────────────────────────────────────────────────────────────────
// A VERDICT IS NOT THE SAME THING AS "WE COULD NOT CHECK"
//
// (2026-09-15) Paying users saw "AI Chat requires a Pro subscription" on the first visit to
// the panel after every nightly update, and a restart cleared it. The server had answered
// correctly every time; the loader manufactured the paywall by racing the call against a
// fixed 5 s timer, discarding the reply that landed a moment later, returning a null session
// as `tier: 'free'` and PERSISTING it, and then holding whatever it had for an hour.
//
// These tests pin the rules that replaced that behaviour, as BEHAVIOUR: a fake backend, a
// fake clock/storage, and assertions on what callers and listeners receive.
// ─────────────────────────────────────────────────────────────────────────────
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PluginLoader,
  isVerdict,
  UNVERIFIED_TIER,
  type EntitlementsBackend,
  type EntitlementsResponse,
} from '../../src/editor/src/views/panels/ChatPanelBridge/PluginLoader';

const CACHE_KEY = 'xgenia_plugin_entitlements';
const CHAT = { id: 'ai-chat', name: 'AI Chat', url: 'https://xgenia-ai-app-xgenia.vercel.app', version: '0.1.0' };
const PRO = { plugins: [CHAT], tier: 'pro' };
const FREE = { plugins: [], tier: 'free' };
const HOUR = 60 * 60 * 1000;

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

type Session = { access_token: string; user: { id: string } } | null;

/** A backend whose session and answer the test controls, and whose auth events the test fires. */
function fakeBackend(initial: { session: Session; answer?: () => Promise<{ data: any; error: { message: string } | null }> }) {
  const state = { session: initial.session, invokes: 0, sessionReads: 0 };
  const listeners: Array<(event: string, session: { user?: { id: string } } | null) => void> = [];
  const answer = initial.answer ?? (async () => ({ data: PRO, error: null }));
  const backend: EntitlementsBackend = {
    auth: {
      async getSession() { state.sessionReads++; return { data: { session: state.session } }; },
      onAuthStateChange(cb) { listeners.push(cb); return { data: { subscription: { unsubscribe() { /* nothing to release in the fake */ } } } }; },
    },
    functions: {
      async invoke() { state.invokes++; return answer(); },
    },
  };
  return {
    backend, state,
    setSession(s: Session) { state.session = s; },
    emit(event: string, session: { user?: { id: string } } | null) { for (const l of listeners) l(event, session); },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Resolves with the next non-null answer pushed to listeners (or rejects after `ms`). */
function nextVerdict(loader: PluginLoader, ms = 1000): Promise<EntitlementsResponse> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { unsub(); reject(new Error('no listener notification')); }, ms);
    const unsub = loader.onChange((e) => {
      if (!e || !isVerdict(e)) return;
      clearTimeout(timer); unsub(); resolve(e);
    });
  });
}

function makeLoader(b: ReturnType<typeof fakeBackend>, storage: MemoryStorage, opts: { online?: boolean; now?: () => number; deadlines?: { noCacheMs: number; withCacheMs: number } } = {}) {
  return new PluginLoader({
    backend: b.backend,
    storage,
    isOnline: () => opts.online ?? true,
    now: opts.now ?? (() => Date.now()),
    deadlines: opts.deadlines ?? { noCacheMs: 60, withCacheMs: 30 },
  });
}

test('no session is a failed check, not a free account: nothing persisted, nothing remembered', async () => {
  const b = fakeBackend({ session: null });
  const storage = new MemoryStorage();
  const loader = makeLoader(b, storage);

  const first = await loader.getEntitledPlugins();
  assert.equal(first.tier, UNVERIFIED_TIER);
  assert.equal(isVerdict(first), false);
  assert.equal(first.plugins.length, 0);
  assert.equal(storage.getItem(CACHE_KEY), null, 'a guess must never be written to disk');
  assert.equal(loader.getPluginUrl('ai-chat'), null);

  // Not sticky: the next call asks again instead of serving the guess for an hour.
  await loader.getEntitledPlugins();
  assert.equal(b.state.sessionReads, 2);
  assert.equal(b.state.invokes, 0, 'no session means the function is never called');
});

test('an answer that lands after the deadline is adopted: listeners hear it and it is persisted', async () => {
  const b = fakeBackend({ session: { access_token: 't', user: { id: 'u1' } }, answer: async () => { await sleep(150); return { data: PRO, error: null }; } });
  const storage = new MemoryStorage();
  const loader = makeLoader(b, storage, { deadlines: { noCacheMs: 40, withCacheMs: 20 } });

  const late = nextVerdict(loader);
  const first = await loader.getEntitledPlugins();
  assert.equal(first.tier, UNVERIFIED_TIER, 'nothing stored to show, so the caller hears "could not check"');
  assert.equal(storage.getItem(CACHE_KEY), null);

  const adopted = await late;
  assert.equal(adopted.tier, 'pro');
  assert.equal(adopted.source, 'server');
  assert.equal(adopted.userId, 'u1');
  assert.equal(loader.getPluginUrl('ai-chat'), CHAT.url, 'the late verdict is now the loader\'s answer');
  const onDisk = JSON.parse(storage.getItem(CACHE_KEY)!);
  assert.equal(onDisk.tier, 'pro');
  assert.equal(onDisk.source, 'server');
  assert.equal(b.state.invokes, 1, 'the timed-out fetch was reused, not repeated');
});

test('a stored verdict inside the grace window is served while the server is slow, and the late verdict still lands', async () => {
  const now = Date.now();
  const b = fakeBackend({ session: { access_token: 't', user: { id: 'u1' } }, answer: async () => { await sleep(120); return { data: { plugins: [CHAT], tier: 'enterprise' }, error: null }; } });
  const storage = new MemoryStorage();
  storage.setItem(CACHE_KEY, JSON.stringify({ ...PRO, cachedAt: now - 3 * HOUR, source: 'server', userId: 'u1' }));
  const loader = makeLoader(b, storage, { now: () => now, deadlines: { noCacheMs: 5000, withCacheMs: 30 } });

  const late = nextVerdict(loader);
  const served = await loader.getEntitledPlugins();
  assert.equal(served.tier, 'pro');
  assert.equal(served.source, 'cache');
  assert.equal(loader.getPluginUrl('ai-chat'), CHAT.url, 'the panel opens on the stored verdict');

  const adopted = await late;
  assert.equal(adopted.tier, 'enterprise');
  assert.equal(JSON.parse(storage.getItem(CACHE_KEY)!).tier, 'enterprise', 'the fresh verdict replaced the stored one');
});

test('cache entries written by older builds are discarded, never served — they may be the persisted no-session guess', async () => {
  const b = fakeBackend({ session: { access_token: 't', user: { id: 'u1' } } });
  const storage = new MemoryStorage();
  // Pre-2026-09-15 shape: no `source`, and exactly what the old no-session path wrote.
  storage.setItem(CACHE_KEY, JSON.stringify({ plugins: [], tier: 'free', cachedAt: Date.now() }));
  const loader = makeLoader(b, storage, { online: false });

  assert.equal(loader.getCachedTier(), null, 'the legacy entry is not even good enough for a first frame');
  const answer = await loader.getEntitledPlugins();
  assert.equal(answer.tier, UNVERIFIED_TIER, 'offline with only a legacy entry: could not check, not "free"');
  assert.equal(storage.getItem(CACHE_KEY), null, 'the legacy entry was removed');
  assert.equal(b.state.invokes, 0);
});

test('a server-confirmed free IS a verdict: returned, persisted, and reused', async () => {
  const b = fakeBackend({ session: { access_token: 't', user: { id: 'u1' } }, answer: async () => ({ data: FREE, error: null }) });
  const storage = new MemoryStorage();
  const loader = makeLoader(b, storage);

  const answer = await loader.getEntitledPlugins();
  assert.equal(answer.tier, 'free');
  assert.equal(isVerdict(answer), true);
  assert.equal(loader.getPluginUrl('ai-chat'), null, 'the paywall is right for this account');
  assert.equal(JSON.parse(storage.getItem(CACHE_KEY)!).tier, 'free');

  await loader.getEntitledPlugins();
  assert.equal(b.state.invokes, 1, 'a fresh verdict is reused for the hour, as before');
});

test('a server error is not a verdict either: nothing stored, and the next call asks again', async () => {
  const b = fakeBackend({ session: { access_token: 't', user: { id: 'u1' } }, answer: async () => ({ data: null, error: { message: 'Edge Function returned a non-2xx status code' } }) });
  const storage = new MemoryStorage();
  const loader = makeLoader(b, storage);

  const answer = await loader.getEntitledPlugins();
  assert.equal(answer.tier, UNVERIFIED_TIER);
  assert.equal(storage.getItem(CACHE_KEY), null);
  await loader.getEntitledPlugins();
  assert.equal(b.state.invokes, 2);
});

test('signing in re-checks and unlocks without a restart; signing out clears everything', async () => {
  const b = fakeBackend({ session: null });
  const storage = new MemoryStorage();
  const loader = makeLoader(b, storage);

  const first = await loader.getEntitledPlugins();
  assert.equal(first.tier, UNVERIFIED_TIER);

  // The session appears (a sign-in, or the refresh that failed at mount finally succeeding).
  const unlocked = nextVerdict(loader);
  b.setSession({ access_token: 't', user: { id: 'u1' } });
  b.emit('SIGNED_IN', { user: { id: 'u1' } });
  const verdict = await unlocked;
  assert.equal(verdict.tier, 'pro');
  assert.equal(loader.getPluginUrl('ai-chat'), CHAT.url);
  assert.ok(storage.getItem(CACHE_KEY));

  let heardNull = false;
  loader.onChange((e) => { if (e === null) heardNull = true; });
  b.emit('SIGNED_OUT', null);
  await sleep(0);
  assert.equal(heardNull, true, 'panels are told the account is gone');
  assert.equal(storage.getItem(CACHE_KEY), null, 'the stored verdict belongs to the account that left');
  assert.equal(loader.getPluginUrl('ai-chat'), null);
});

test('a different account signing in does not inherit the previous account\'s verdict', async () => {
  const b = fakeBackend({ session: { access_token: 't1', user: { id: 'u1' } } });
  const storage = new MemoryStorage();
  const loader = makeLoader(b, storage);

  const first = await loader.getEntitledPlugins();
  assert.equal(first.tier, 'pro');
  assert.equal(first.userId, 'u1');

  // u2 is a free account. Its sign-in must produce u2's verdict, not serve u1's for an hour.
  const b2answer = async () => ({ data: FREE, error: null });
  (b.backend.functions as any).invoke = async () => { b.state.invokes++; return b2answer(); };
  const rechecked = nextVerdict(loader);
  b.setSession({ access_token: 't2', user: { id: 'u2' } });
  b.emit('SIGNED_IN', { user: { id: 'u2' } });
  const verdict = await rechecked;
  assert.equal(verdict.tier, 'free');
  assert.equal(verdict.userId, 'u2');
  assert.equal(loader.getPluginUrl('ai-chat'), null);
  assert.equal(JSON.parse(storage.getItem(CACHE_KEY)!).userId, 'u2');
});

test('concurrent callers share one server fetch', async () => {
  const b = fakeBackend({ session: { access_token: 't', user: { id: 'u1' } }, answer: async () => { await sleep(20); return { data: PRO, error: null }; } });
  const storage = new MemoryStorage();
  const loader = makeLoader(b, storage);

  const [a, c, d] = await Promise.all([loader.getEntitledPlugins(), loader.getEntitledPlugins(), loader.getEntitledPlugins()]);
  assert.equal(a.tier, 'pro'); assert.equal(c.tier, 'pro'); assert.equal(d.tier, 'pro');
  assert.equal(b.state.invokes, 1);
});
