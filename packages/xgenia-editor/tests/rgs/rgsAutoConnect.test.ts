// Signed in to XGENIA is signed in to XGENIA RGS: when the editor connects by itself, and when it must not.
//
// rgsClient's "Connected by itself" section (XRGS contract §10). The protocol is tests/rgs/rgsSilentConnect; this
// is its use. Refusals first — each fails if the behaviour it names regresses:
//   - it does nothing unless turned on, unless somebody is signed in to XGENIA, and after a Sign out of the RGS
//     on purpose (a sign-out that reconnects by itself is not one) — for THAT person only;
//   - with several studios it never guesses;
//   - a key obtained while the XGENIA account changed is not stored;
//   - a full key (from the browser sign-in) is never probed or dropped;
//   - a dead play-money key is dropped — the key only, the game selection stays — and a new one asked for.
// Then: it connects, stores the key as that person's play-money key, remembers the studio, and Sign in with
// XGENIA uses it before it ever opens a browser.
//   TSX_TSCONFIG_PATH=packages/xgenia-editor/tsconfig.json npx -y tsx@4.19.2 --test --test-force-exit packages/xgenia-editor/tests/rgs/rgsAutoConnect.test.ts
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
let events: Array<[string, any]> = [];
before(async () => {
  rgs = await import('../../src/editor/src/utils/rgs/rgsClient');
  const { EventDispatcher } = await import('@xgenia-shared/utils/EventDispatcher');
  const group = { name: 'rgs-auto-connect-test' };
  for (const name of ['rgs.connected', 'rgs.gameSelected']) {
    EventDispatcher.instance.on(name, (payload: unknown) => { events.push([name, payload]); }, group);
  }
});

const SETTINGS = 'xgenia_rgs_settings';
const ADA = 'user-ada';
const BEN = 'user-ben';
const SESSION = 'eyJ.adas-xgenia-session.sig';
const EP = { xgeniaFunctionsUrl: 'https://xgenia.test/functions/v1', xgeniaAnonKey: 'xa', functionsUrl: 'https://rgs.test/functions/v1', anonKey: 'ra' };

function fakeVault() {
  return {
    isAvailable: async () => true,
    encrypt: async (p: string) => `ENC(${[...p].reverse().join('')})`,
    decrypt: async (c: string) => { const m = /^ENC\((.*)\)$/.exec(c); return m ? [...m[1]].reverse().join('') : undefined; }
  };
}
function fakeAccount(initial: string | null) {
  let listener: ((id: string | null) => void) | null = null;
  return { current: () => Promise.resolve(initial), onChange: (l: (id: string | null) => void) => { listener = l; }, fire: (id: string | null) => listener!(id) };
}
const source = (token = SESSION) => ({ accessToken: async () => token, endpoints: async () => EP });

type Call = { url: string; body: any; headers: Record<string, string> };
type Answer = { status: number; body: any } | 'down';
/** The network: XGENIA's ticket, the RGS's editor-connect, and the RGS's "who is this key" (maths-deployer). */
function net(answers: { ticket?: Answer; connect?: Answer | ((body: any) => Answer); probe?: Answer }, calls: Call[] = []) {
  let n = 0;
  const fetchFn = async (url: string, init: any) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body, headers: init.headers });
    let a: Answer | undefined;
    if (url.endsWith('/rgs-editor-ticket')) a = answers.ticket ?? { status: 200, body: { ticket: `xet1.t${++n}.s`, expires_in: 60 } };
    else if (url.endsWith('/xgenia-auth')) a = typeof answers.connect === 'function' ? answers.connect(body) : answers.connect;
    else if (url.endsWith('/maths-deployer')) a = answers.probe;
    if (!a || a === 'down') throw new Error('network down');
    const answer = a;
    return { ok: answer.status >= 200 && answer.status < 300, status: answer.status, text: async () => JSON.stringify(answer.body), json: async () => answer.body };
  };
  return { fetchFn, calls };
}
const key = (apiKey: string, slug = 'fox', name = 'Fox') => ({ status: 200, body: { api_key: apiKey, operator_slug: `${slug}-demo`, studio: { name, slug }, play_money_only: true } });
const tick = () => new Promise<void>((r) => setTimeout(r, 5));
const quiet = async <T>(fn: () => Promise<T> | T) => {
  const { warn, error } = console;
  console.warn = () => {}; console.error = () => {};
  try { return await fn(); } finally { console.warn = warn; console.error = error; }
};
const to = (calls: Call[], suffix: string) => calls.filter((c) => c.url.endsWith(suffix));

/** An editor that has started, with this XGENIA account signed in (null: nobody), connecting-by-itself ON. */
async function started(who: string | null) {
  const account = fakeAccount(who);
  await rgs.initRgsKeyVault(fakeVault(), account);
  // The attempts nobody calls by hand (now, and whenever the account changes) get a source with nobody signed
  // in: they end at once, sending nothing. Each test then calls autoConnectRgs with its own source and network.
  rgs.enableSilentRgsConnect({ source: source(''), fetchFn: async () => { throw new Error('an attempt nobody made reached the network'); } });
  await tick();
  return account;
}

beforeEach(async () => {
  await tick();
  storage.clear();
  rgs.resetRgsKeyVaultForTests();
  events = [];
});

test('off unless turned on; nothing while nobody is signed in to XGENIA', async () => {
  const a = net({ connect: key('op_1') });
  await rgs.initRgsKeyVault(fakeVault(), fakeAccount(ADA));
  await rgs.autoConnectRgs({ source: source(), fetchFn: a.fetchFn });
  assert.equal(a.calls.length, 0, 'the editor connected by itself without being told it may');
  assert.equal(rgs.isRgsConnected(), false);

  storage.clear(); rgs.resetRgsKeyVaultForTests();
  const b = net({ connect: key('op_1') });
  await started(null);
  await rgs.autoConnectRgs({ source: source(), fetchFn: b.fetchFn });
  assert.equal(b.calls.length, 0, 'a ticket was asked for with nobody signed in');
});

test('signed in to XGENIA, not connected: it connects — the key is that person\'s play-money key, the studio is remembered', async () => {
  const { fetchFn, calls } = net({ connect: key('op_play_1') });
  await started(ADA);
  await rgs.autoConnectRgs({ source: source(), fetchFn });
  await rgs.flushRgsKeyWrites();
  const s = rgs.getRgsSettings();
  assert.equal(s?.apiKey, 'op_play_1');
  assert.equal(s?.playMoneyOnly, true);
  assert.deepEqual(s?.studio, { name: 'Fox', slug: 'fox' });
  assert.equal(storage.getItem(rgs.RGS_KEY_OWNER_KEY), ADA, 'the key is not stamped with who was signed in');
  assert.equal(storage.dump().includes('op_play_1'), false, 'the key is in local storage in the clear');
  assert.equal(storage.dump().includes('adas-xgenia-session'), false, 'the XGENIA session was written to disk');
  assert.deepEqual(JSON.parse(storage.getItem(rgs.RGS_LAST_STUDIO_KEY)!), { [ADA]: 'fox' });
  assert.deepEqual(events.filter(([n]) => n === 'rgs.connected').map(([, p]) => [p.silent, p.playMoneyOnly, p.studio?.slug]), [[true, true, 'fox']]);
  assert.equal(to(calls, '/xgenia-auth')[0].body.studio_slug, undefined, 'a studio was named that nobody chose');
  // Connected: asking again does not ask for another key (it checks the one it has — see below).
  const again = net({ connect: key('op_other'), probe: { status: 200, body: { operator: {} } } });
  await rgs.autoConnectRgs({ source: source(), fetchFn: again.fetchFn });
  assert.equal(to(again.calls, '/rgs-editor-ticket').length, 0);
  assert.equal(rgs.getRgsSettings()?.apiKey, 'op_play_1');
});

test('one at a time: two triggers at once make one attempt', async () => {
  const { fetchFn, calls } = net({ connect: key('op_1') });
  await started(ADA);
  await Promise.all([rgs.autoConnectRgs({ source: source(), fetchFn }), rgs.autoConnectRgs({ source: source(), fetchFn })]);
  assert.equal(to(calls, '/rgs-editor-ticket').length, 1);
});

test('a Sign out of the RGS on purpose stays signed out — for that person, until they connect themselves', async () => {
  const account = await started(ADA);
  await rgs.autoConnectRgs({ source: source(), fetchFn: net({ connect: key('op_1') }).fetchFn });
  assert.equal(rgs.isRgsConnected(), true);

  rgs.disconnectRgsOnPurpose();
  assert.equal(rgs.isRgsConnected(), false);
  const after = net({ connect: key('op_2') });
  await rgs.autoConnectRgs({ source: source(), fetchFn: after.fetchFn });
  assert.equal(after.calls.length, 0, 'the editor reconnected by itself after a Sign out');
  // …also after a restart, and after their XGENIA session is refreshed.
  rgs.resetRgsKeyVaultForTests();
  const again = await started(ADA);
  again.fire(ADA);
  await rgs.autoConnectRgs({ source: source(), fetchFn: after.fetchFn });
  assert.equal(after.calls.length, 0, 'the editor reconnected by itself after a restart');

  // Another person signing in to XGENIA here is not bound by Ada's sign-out.
  await quiet(() => again.fire(BEN));
  const ben = net({ connect: key('op_ben', 'ben', 'Ben') });
  await rgs.autoConnectRgs({ source: source('eyJ.bens-session.sig'), fetchFn: ben.fetchFn });
  assert.equal(rgs.getRgsSettings()?.apiKey, 'op_ben');
  assert.equal(storage.getItem(rgs.RGS_KEY_OWNER_KEY), BEN);

  // Ada again: still signed out by her own choice (Ben's key is destroyed on the way: it is not hers)…
  await quiet(() => again.fire(ADA));
  assert.equal(rgs.isRgsConnected(), false);
  // …until she connects herself (any saved key ends it). Then it is by itself again next time.
  rgs.disconnectRgsOnPurpose();
  rgs.saveRgsSettings({ apiKey: 'op_ada_manual', rgsUrl: 'u', playMoneyOnly: false });
  assert.equal(storage.getItem(rgs.RGS_STAY_SIGNED_OUT_KEY), null);
});

test('several studios and none remembered: it never guesses', async () => {
  const choose = { status: 409, body: { code: 'CHOOSE_STUDIO', studios: [{ name: 'Fox', slug: 'fox', play_money_only: true }, { name: 'North', slug: 'north', play_money_only: false }] } };
  const { fetchFn, calls } = net({ connect: choose });
  await started(ADA);
  await rgs.autoConnectRgs({ source: source(), fetchFn });
  assert.equal(rgs.isRgsConnected(), false);
  assert.equal(to(calls, '/xgenia-auth').length, 1, 'a second request named a studio nobody chose');
});

test('the studio this person last used on this computer is the one it reconnects to; one that is no longer theirs is forgotten', async () => {
  const account = await started(ADA);
  await rgs.autoConnectRgs({ source: source(), fetchFn: net({ connect: key('op_1', 'north', 'North') }).fetchFn });
  rgs.clearRgsSettings();            // (their XGENIA sign-out does this; it is NOT a "stay signed out")
  account.fire(null); account.fire(ADA);

  const back = net({ connect: (body) => (body.studio_slug === 'north' ? key('op_2', 'north', 'North') : { status: 409, body: { code: 'CHOOSE_STUDIO', studios: [] } }) });
  await rgs.autoConnectRgs({ source: source(), fetchFn: back.fetchFn });
  assert.equal(to(back.calls, '/xgenia-auth')[0].body.studio_slug, 'north');
  assert.equal(rgs.getRgsSettings()?.apiKey, 'op_2');

  rgs.clearRgsSettings();
  const gone = net({ connect: { status: 403, body: { code: 'NOT_YOUR_STUDIO', error: 'x' } } });
  await rgs.autoConnectRgs({ source: source(), fetchFn: gone.fetchFn });
  assert.equal(rgs.isRgsConnected(), false);
  assert.deepEqual(JSON.parse(storage.getItem(rgs.RGS_LAST_STUDIO_KEY)!), {}, 'a studio they are no longer in is still the one it asks for');
});

test('the XGENIA account changes while the RGS answers: the key is not stored', async () => {
  const account = await started(ADA);
  const slow = { status: 200, body: key('op_for_ada').body };
  const { fetchFn } = net({ connect: slow });
  const racing = async (url: string, init: any) => {
    if (url.endsWith('/xgenia-auth')) await quiet(() => account.fire(BEN));   // Ben signs in while Ada's request is in flight
    return fetchFn(url, init);
  };
  await rgs.autoConnectRgs({ source: source(), fetchFn: racing });
  assert.equal(rgs.getRgsSettings(), null, 'a key obtained for Ada was stored for Ben');
  assert.equal(storage.getItem(rgs.RGS_KEY_OWNER_KEY), null);
});

test('a FULL key (from the browser sign-in) is never probed, dropped or replaced', async () => {
  await started(ADA);
  rgs.saveRgsSettings({ apiKey: 'op_full', rgsUrl: 'u', studio: { name: 'Fox', slug: 'fox' }, playMoneyOnly: false });
  const { fetchFn, calls } = net({ connect: key('op_play'), probe: { status: 401, body: {} } });
  await rgs.autoConnectRgs({ source: source(), fetchFn });
  assert.equal(calls.length, 0);
  assert.equal(rgs.getRgsSettings()?.apiKey, 'op_full');
});

test('a play-money key the RGS no longer accepts is dropped — the key only — and a new one asked for', async () => {
  await started(ADA);
  await rgs.autoConnectRgs({ source: source(), fetchFn: net({ connect: key('op_old') }).fetchFn });
  (globalThis as any).ProjectModel = { instance: { id: 'project-1' } };   // the game selection is per project
  rgs.setActiveGame({ id: 'g1', slug: 'reel', name: 'Reel' });
  await rgs.flushRgsKeyWrites();

  // Still accepted, or the RGS could not be asked: nothing changes.
  for (const probe of [{ status: 200, body: { operator: {} } }, { status: 500, body: {} }, 'down' as const]) {
    const alive = net({ connect: key('op_new'), probe });
    await rgs.autoConnectRgs({ source: source(), fetchFn: alive.fetchFn });
    assert.equal(rgs.getRgsSettings()?.apiKey, 'op_old', JSON.stringify(probe));
    assert.equal(to(alive.calls, '/rgs-editor-ticket').length, 0);
    assert.equal(to(alive.calls, '/maths-deployer')[0].headers['X-Operator-Key'], 'op_old');
  }

  // Refused (thirty days up, or revoked): dropped, and replaced by itself — same studio, same game selection.
  events = [];
  const replaced = net({ connect: (body) => (body.studio_slug === 'fox' ? key('op_new') : { status: 409, body: { code: 'CHOOSE_STUDIO', studios: [] } }), probe: { status: 401, body: {} } });
  await rgs.autoConnectRgs({ source: source(), fetchFn: replaced.fetchFn });
  await rgs.flushRgsKeyWrites();
  assert.equal(rgs.getRgsSettings()?.apiKey, 'op_new');
  assert.deepEqual(rgs.getActiveGame(), { id: 'g1', slug: 'reel', name: 'Reel' }, 'the game selection was lost with the key');
  assert.equal(storage.dump().includes('op_old'), false);

  // Refused, and the studio now has a real-money game: dropped, NOT connected — Publish shows Sign in with XGENIA.
  events = [];
  const live = net({ connect: { status: 403, body: { code: 'SECOND_FACTOR_REQUIRED', error: 'has a real-money game' } }, probe: { status: 403, body: {} } });
  await rgs.autoConnectRgs({ source: source(), fetchFn: live.fetchFn });
  assert.equal(rgs.getRgsSettings(), null, 'a key the RGS refuses is still shown as a connection');
  assert.equal(storage.getItem(rgs.RGS_KEY_CIPHER_KEY), null);
  assert.equal(JSON.parse(storage.getItem(SETTINGS)!).studio.slug, 'fox', 'the studio was forgotten with the key');
  assert.ok(events.some(([n]) => n === 'rgs.gameSelected'), 'the panels were not told the connection is gone');
  delete (globalThis as any).ProjectModel;
});

test('an attempt that ends at once does not block the next one', async () => {
  // Nobody signed in, then signed out on purpose: both end without waiting on anything. The guard that makes
  // attempts one-at-a-time must be free again afterwards (it once held such an attempt for ever).
  const account = await started(null);
  await rgs.autoConnectRgs({ source: source(), fetchFn: net({ connect: key('op_x') }).fetchFn });
  account.fire(ADA);
  rgs.disconnectRgsOnPurpose();
  await rgs.autoConnectRgs({ source: source(), fetchFn: net({ connect: key('op_x') }).fetchFn });
  rgs.saveRgsSettings({ apiKey: 'op_manual', rgsUrl: 'u', playMoneyOnly: false });   // connects themselves…
  rgs.clearRgsSettings();                                                             // …and is disconnected by an XGENIA sign-out
  const { fetchFn, calls } = net({ connect: key('op_after') });
  await rgs.autoConnectRgs({ source: source(), fetchFn });
  assert.equal(to(calls, '/rgs-editor-ticket').length, 1, 'connecting by itself stopped working after an attempt that had nothing to do');
  assert.equal(rgs.getRgsSettings()?.apiKey, 'op_after');
});

test('Sign in with XGENIA connects by itself first — the browser is never opened when that works', async () => {
  await started(ADA);
  const loopback = {
    opened: 0,
    listen: async () => { loopback.opened++; return { id: 'l1', redirectUri: 'http://127.0.0.1:5555/xgenia-rgs?state=s', installLabel: 'laptop' }; },
    openBrowser: async () => {},
    wait: async () => ({ error: 'CANCELLED' } as any),
    cancel: async () => {}
  };
  const { fetchFn, calls } = net({ connect: key('op_silent') });
  const steps: string[] = [];
  const result = await rgs.connectWithXgeniaRgs({ silent: source(), fetchFn, loopback, onStep: (s) => steps.push(s) });
  assert.equal(result.apiKey, 'op_silent');
  assert.equal(loopback.opened, 0, 'the browser flow was started although the editor could connect by itself');
  assert.deepEqual(steps, ['connecting']);
  assert.equal(to(calls, '/xgenia-auth').every((c) => c.body.action === 'editor-connect'), true);
});

test('Sign in with XGENIA: several studios — the person picks; a studio with a real-money game goes to the browser, already chosen', async () => {
  await started(ADA);
  const studios = [{ name: 'Fox', slug: 'fox', play_money_only: true }, { name: 'North', slug: 'north', play_money_only: false }];
  const connect = (body: any): Answer => {
    if (body.action === 'editor-connect') return body.studio_slug === 'fox' ? key('op_fox') : { status: 409, body: { code: 'CHOOSE_STUDIO', studios } };
    if (body.action === 'start') return { status: 200, body: { authorize_url: 'https://rgs.test/authorize' } };
    if (body.action === 'editor-redeem') return { status: 200, body: { api_key: 'op_full_north', operator_slug: 'north-demo', studio: { name: 'North', slug: body.studio_slug } } };
    return { status: 400, body: {} };
  };
  // A play-money studio: connected by itself, on a second ticket that names it.
  let asked: any[] = [];
  const a = net({ connect });
  const fox = await rgs.connectWithXgeniaRgs({ silent: source(), fetchFn: a.fetchFn, loopback: null as any, chooseStudio: async (list) => { asked = list; return 'fox'; } });
  assert.equal(fox.apiKey, 'op_fox');
  assert.deepEqual(asked.map((s) => [s.slug, s.playMoneyOnly]), [['fox', true], ['north', false]]);
  assert.equal(to(a.calls, '/rgs-editor-ticket').length, 2, 'the chosen studio was not asked for on a ticket of its own');

  // Cancelled at the picker: nothing happens, and no browser.
  await assert.rejects(() => rgs.connectWithXgeniaRgs({ silent: source(), fetchFn: net({ connect }).fetchFn, loopback: null as any, chooseStudio: async () => null }), (e: any) => e.code === 'CANCELLED');

  // The studio with a real-money game: the browser — and the redeem names it, so they are not asked twice.
  rgs.clearRgsSettings();
  const loopback = {
    listen: async () => ({ id: 'l1', redirectUri: 'http://127.0.0.1:5555/xgenia-rgs?state=s', installLabel: 'laptop' }),
    openBrowser: async () => {},
    wait: async () => ({ code: 'one-time-code' } as any),
    cancel: async () => {}
  };
  const b = net({ connect });
  let picks = 0;
  const north = await rgs.connectWithXgeniaRgs({ silent: source(), fetchFn: b.fetchFn, loopback, chooseStudio: async () => { picks++; return 'north'; } });
  assert.equal(north.apiKey, 'op_full_north');
  assert.equal(picks, 1, 'the person was asked which studio twice');
  assert.equal(to(b.calls, '/rgs-editor-ticket').length, 1, 'a second ticket was spent on a studio the RGS had already said needs the authenticator');
  const redeem = to(b.calls, '/xgenia-auth').find((c) => c.body.action === 'editor-redeem')!;
  assert.equal(redeem.body.studio_slug, 'north');
  assert.equal(rgs.getRgsSettings()?.playMoneyOnly, false, 'a key from the browser sign-in is marked play money');
  assert.deepEqual(rgs.getRgsSettings()?.studio, { name: 'North', slug: 'north' });
});

test('Sign in with XGENIA: when connecting by itself is refused, the browser flow runs exactly as before', async () => {
  await started(ADA);
  const connect = (body: any): Answer => {
    if (body.action === 'editor-connect') return { status: 403, body: { code: 'NOT_ENTITLED', error: 'no plan' } };
    if (body.action === 'start') return { status: 200, body: { authorize_url: 'https://rgs.test/authorize' } };
    return { status: 200, body: { api_key: 'op_browser', operator_slug: 'fox-demo', studio: { name: 'Fox', slug: 'fox' } } };
  };
  const loopback = {
    listen: async () => ({ id: 'l1', redirectUri: 'http://127.0.0.1:5555/xgenia-rgs?state=s', installLabel: 'laptop' }),
    openBrowser: async () => {},
    wait: async () => ({ code: 'one-time-code' } as any),
    cancel: async () => {}
  };
  const { fetchFn } = net({ connect });
  const out = await rgs.connectWithXgeniaRgs({ silent: source(), fetchFn, loopback });
  assert.equal(out.apiKey, 'op_browser');
  // And with `silent: false`, or with a test's own loopback/fetch and no silent source, it is never tried.
  const none = net({ connect });
  await rgs.connectWithXgeniaRgs({ silent: false, fetchFn: none.fetchFn, loopback });
  await rgs.connectWithXgeniaRgs({ fetchFn: none.fetchFn, loopback });
  assert.equal(to(none.calls, '/rgs-editor-ticket').length, 0);
});

test('in the editor (connecting-by-itself turned on) the Publish button needs no option to use it; where it is not turned on, nothing changes', async () => {
  const realFetch = (globalThis as any).fetch;
  const { fetchFn, calls } = net({ connect: key('op_from_button') });
  (globalThis as any).fetch = fetchFn;
  try {
    // Not turned on (a test, a build without XGENIA sign-in): the button goes to the browser path, which here has no loopback.
    await rgs.initRgsKeyVault(fakeVault(), fakeAccount(ADA));
    await assert.rejects(() => rgs.connectWithXgeniaRgs(), (e: any) => e.code === 'NOT_DESKTOP');
    assert.equal(calls.length, 0, 'a ticket was asked for although connecting-by-itself was never turned on');

    // Turned on, as editor/index.ts does: the same call connects, and no loopback is ever asked for.
    rgs.enableSilentRgsConnect({ source: source() });
    const out = await rgs.connectWithXgeniaRgs();
    assert.equal(out.apiKey, 'op_from_button');
    assert.equal(rgs.getRgsSettings()?.playMoneyOnly, true);
  } finally {
    (globalThis as any).fetch = realFetch;
  }
});
