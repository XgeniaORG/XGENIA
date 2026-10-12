// Web-panel plugin URLs may carry a short-lived ticket in the volatile query parameter `t`.
// Opening a panel on a stale answer refreshes it first; a refresh that only changes the ticket
// never reloads an open plugin.
//   npx tsx --test packages/xgenia-editor/tests/entitlements/webPluginTicket.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PluginLoader,
  stableUrl,
  TICKET_REFRESH_MS,
  type EntitlementsBackend,
} from '../../src/editor/src/views/panels/ChatPanelBridge/PluginLoader';
import { entitlementsForPanelOpen, nextFrameUrl } from '../../src/editor/src/views/panels/WebPluginPanel/webPluginFrame';

const MIN = 60 * 1000;
const panel = (t: string) => ({ id: 'example-panel', name: 'Example', url: `https://panel.example.com/app?x=1&t=${t}`, version: '1', kind: 'web-panel' });

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

/** A loader whose server hands out a new ticket on every call, and whose clock the test moves. */
function makeLoader(opts: { fail?: () => boolean } = {}) {
  let clock = 1_000_000;
  let calls = 0;
  const backend: EntitlementsBackend = {
    auth: {
      async getSession() { return { data: { session: { access_token: 'a', user: { id: 'u1' } } } }; },
      onAuthStateChange() { return {}; },
    },
    functions: {
      async invoke() {
        calls++;
        if (opts.fail?.()) return { data: null, error: { message: 'down' } };
        return { data: { tier: 'pro', plugins: [panel(`ticket${calls}`)] }, error: null };
      },
    },
  };
  const loader = new PluginLoader({ backend, storage: new MemoryStorage(), isOnline: () => true, now: () => clock, deadlines: { noCacheMs: 200, withCacheMs: 50 } });
  return { loader, advance: (ms: number) => { clock += ms; }, calls: () => calls };
}

const quiet = async <T>(fn: () => Promise<T>) => {
  const { warn, log } = console;
  console.warn = console.log = () => {};
  try { return await fn(); } finally { console.warn = warn; console.log = log; }
};

test('stableUrl drops only the ticket parameter', () => {
  assert.equal(stableUrl('https://panel.example.com/app?x=1&t=abc'), 'https://panel.example.com/app?x=1');
  assert.equal(stableUrl('https://panel.example.com/app?t=abc'), 'https://panel.example.com/app');
  assert.equal(stableUrl('https://panel.example.com/app?x=1#h'), 'https://panel.example.com/app?x=1#h');
  assert.equal(stableUrl('not a url'), 'not a url');
});

test('opening a panel on a fresh answer does not ask the server again', async () => {
  const l = makeLoader();
  await quiet(() => l.loader.getEntitledPlugins());
  l.advance(TICKET_REFRESH_MS - MIN);
  const e = await quiet(() => entitlementsForPanelOpen(l.loader));
  assert.equal(l.calls(), 1);
  assert.match(e.plugins[0].url, /t=ticket1$/);
});

test('opening a panel on an answer older than the ticket window refreshes it first', async () => {
  const l = makeLoader();
  await quiet(() => l.loader.getEntitledPlugins());
  l.advance(TICKET_REFRESH_MS + MIN);   // still well inside the 1 h cache TTL
  const e = await quiet(() => entitlementsForPanelOpen(l.loader));
  assert.equal(l.calls(), 2);
  assert.match(e.plugins[0].url, /t=ticket2$/, 'the fresh URL (new ticket) is used');
});

test('a failed refresh on open falls back to the URL already held', async () => {
  let down = false;
  const l = makeLoader({ fail: () => down });
  await quiet(() => l.loader.getEntitledPlugins());
  l.advance(TICKET_REFRESH_MS + MIN);
  down = true;
  const e = await quiet(() => entitlementsForPanelOpen(l.loader));
  assert.equal(e.plugins.length, 1);
  assert.match(e.plugins[0].url, /t=ticket1$/);
});

test('a ticket-only URL change keeps the mounted URL (no iframe reload)', () => {
  const mounted = panel('old').url;
  assert.equal(nextFrameUrl(mounted, panel('new').url), mounted);
});

test('a real URL change reloads the iframe', () => {
  const mounted = panel('old').url;
  assert.equal(nextFrameUrl(mounted, 'https://panel.example.com/v2/app?x=1&t=new'), 'https://panel.example.com/v2/app?x=1&t=new');
  assert.equal(nextFrameUrl(mounted, 'https://panel.example.com/app?x=2&t=old'), 'https://panel.example.com/app?x=2&t=old');
  assert.equal(nextFrameUrl(null, panel('first').url), panel('first').url, 'nothing mounted yet: mount it');
});
