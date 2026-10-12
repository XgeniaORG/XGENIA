// EditorBridge handshake for generic web-panel plugins. Bundles the real EditorBridge.ts with the
// real PluginLoader.ts (every other editor import stubbed, Supabase faked), loads entitlements
// through the loader, then posts handshakes from an iframe and reads what the bridge replies.
//   node --test packages/xgenia-editor/tests/bridge/web-plugin-handshake.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const req = createRequire(path.join(root, 'package.json'));
const { build } = req('esbuild');
const { JSDOM } = req('jsdom');
const BRIDGE_DIR = path.resolve(here, '../../src/editor/src/views/panels/ChatPanelBridge');

const PANEL_URL = 'https://panel.example.com/app/';
const PANEL_ORIGIN = 'https://panel.example.com';
const CHAT_URL = 'https://chat.example.com';
const ENTITLEMENTS = {
  tier: 'pro',
  plugins: [
    { id: 'ai-chat', name: 'AI Chat', url: CHAT_URL, version: '1' },
    { id: 'example-panel', name: 'Example Panel', url: PANEL_URL, version: '1', kind: 'web-panel' },
    { id: 'plain-tool', name: 'Plain', url: 'https://plain.example.com', version: '1' },
  ],
};

// Real: the bridge and PluginLoader. Fake: supabaseInit (reads the test's answer off the window).
// Everything else: a do-nothing proxy, as in one-bridge-per-window.test.mjs.
const stubImports = {
  name: 'stub-imports',
  setup(b) {
    b.onResolve({ filter: /.*/ }, (a) => {
      if (a.kind === 'entry-point') return null;
      if (a.path === './PluginLoader') return { path: path.join(BRIDGE_DIR, 'PluginLoader.ts') };
      if (a.path === './EditorBridge' && a.importer === '<stdin>') return { path: path.join(BRIDGE_DIR, 'EditorBridge.ts') };
      if (/supabaseInit$/.test(a.path)) return { path: 'supabase', namespace: 'fake' };
      return { path: a.path, namespace: 'stub', pluginData: { importer: a.importer } };
    });
    b.onLoad({ filter: /.*/, namespace: 'fake' }, () => ({
      contents: `
        export const supabase = {
          auth: {
            async getSession() { return { data: { session: { access_token: 't', user: { id: 'u1' } } } }; },
            onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
          },
          functions: { async invoke() { return { data: JSON.parse(JSON.stringify(globalThis.__entitlements)), error: null }; } },
        };
        export const refreshSessionShared = async () => null;`,
      loader: 'js',
    }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => {
      const src = readFileSync(a.pluginData.importer, 'utf8');
      const names = new Set();
      const esc = a.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`import\\s+(?:type\\s+)?(?:[\\w$]+\\s*,\\s*)?\\{([^}]*)\\}\\s*from\\s*['"]${esc}['"]`, 'g');
      for (const m of src.matchAll(re)) {
        for (const part of m[1].split(',')) {
          const n = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
          if (n && /^[\w$]+$/.test(n)) names.add(n);
        }
      }
      const P = 'new Proxy(function(){}, { get: (t, k) => (k === "then" ? undefined : k === Symbol.toPrimitive ? () => "" : __P), apply: () => __P, construct: () => __P })';
      return { contents: `const __P = ${P}; export default __P; ${[...names].map((n) => `export const ${n} = __P;`).join(' ')}`, loader: 'js' };
    });
  },
};

async function setup() {
  const out = await build({
    stdin: {
      contents: "export * from './EditorBridge'; export { PluginLoader } from './PluginLoader';",
      resolveDir: BRIDGE_DIR,
      loader: 'ts',
    },
    bundle: true, write: false, format: 'iife', globalName: 'EB', platform: 'browser', plugins: [stubImports], logLevel: 'silent',
  });
  const w = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' }).window;
  w.console.warn = w.console.log = w.console.error = w.console.debug = () => {};
  w.__entitlements = ENTITLEMENTS;
  w.eval(out.outputFiles[0].text);
  const verdict = await w.EB.PluginLoader.instance.getEntitledPlugins();
  assert.equal(verdict.source, 'server');

  /**
   * An iframe in the document loaded from `src`, whose outgoing replies the test records.
   * `webPlugin` marks it the way WebPluginPanel marks its frame (data-xgenia-web-plugin).
   */
  function frame(src, webPlugin) {
    const f = w.document.createElement('iframe');
    f.setAttribute('src', src);
    if (webPlugin) f.setAttribute('data-xgenia-web-plugin', webPlugin);
    w.document.body.appendChild(f);
    const replies = [];
    f.contentWindow.postMessage = (message, targetOrigin) => replies.push({ message, targetOrigin });
    return { f, replies };
  }
  async function handshake(fr, plugin, origin) {
    w.dispatchEvent(new w.MessageEvent('message', { data: { type: 'handshake', plugin, version: '1' }, origin, source: fr.f.contentWindow }));
    await new Promise((r) => setTimeout(r, 50));
    return fr.replies.filter((r) => r.message && r.message.type === 'handshake-ack');
  }
  let n = 0;
  /** Send one command from `fr` at `origin`; resolves with the number of replies to it. */
  async function command(fr, origin) {
    const id = `cmd_${++n}_test`;
    w.dispatchEvent(new w.MessageEvent('message', { data: { type: 'command', id, command: 'project.getId', args: [] }, origin, source: fr.f.contentWindow }));
    await new Promise((r) => setTimeout(r, 100));
    return fr.replies.filter((r) => r.message && r.message.id === id).length;
  }
  return { w, frame, handshake, command };
}

test('an entitled web plugin at its own origin gets an ack, entitled, sent to that origin only', async () => {
  const { frame, handshake } = await setup();
  const fr = frame(PANEL_URL, 'example-panel');
  const acks = await handshake(fr, 'example-panel', PANEL_ORIGIN);
  assert.equal(acks.length, 1);
  assert.deepEqual({ ...acks[0].message }, { type: 'handshake-ack', entitled: true, tier: 'pro' });
  assert.equal(acks[0].targetOrigin, PANEL_ORIGIN);
});

test('the same plugin id from a wrong origin is ignored', async () => {
  const { frame, handshake } = await setup();
  assert.equal((await handshake(frame(PANEL_URL, 'example-panel'), 'example-panel', 'https://evil.example.com')).length, 0);
  // Right message origin, but the iframe that sent it was not loaded from the plugin URL.
  assert.equal((await handshake(frame('https://evil.example.com/', 'example-panel'), 'example-panel', PANEL_ORIGIN)).length, 0);
});

test('a handshake is refused from a frame not given that plugin id', async () => {
  const { frame, handshake } = await setup();
  assert.equal((await handshake(frame(PANEL_URL), 'example-panel', PANEL_ORIGIN)).length, 0);
  assert.equal((await handshake(frame(PANEL_URL, 'other-panel'), 'example-panel', PANEL_ORIGIN)).length, 0);
});

test('commands from a web-panel frame whose handshake was refused are dropped', async () => {
  const { frame, handshake, command } = await setup();
  const fr = frame(PANEL_URL, 'example-panel');
  assert.equal(await command(fr, PANEL_ORIGIN), 0, 'no handshake yet');
  await handshake(fr, 'example-panel', 'https://evil.example.com');
  assert.equal(await command(fr, 'https://evil.example.com'), 0);
  assert.equal(await command(fr, PANEL_ORIGIN), 0, 'still no accepted handshake');
});

test('commands from an accepted web-panel frame run, until its origin changes', async () => {
  const { frame, handshake, command } = await setup();
  const fr = frame(PANEL_URL, 'example-panel');
  assert.equal((await handshake(fr, 'example-panel', PANEL_ORIGIN)).length, 1);
  assert.equal(await command(fr, PANEL_ORIGIN), 1);
  // The frame navigated itself to another origin: same element, different sender.
  assert.equal(await command(fr, 'https://evil.example.com'), 0);
});

test('commands from frames that are not web panels behave as before (no handshake needed)', async () => {
  const { frame, command } = await setup();
  assert.equal(await command(frame(CHAT_URL), CHAT_URL), 1);
});

test('plugins that are not entitled web panels get no ack', async () => {
  const { frame, handshake } = await setup();
  assert.equal((await handshake(frame('https://plain.example.com/'), 'plain-tool', 'https://plain.example.com')).length, 0);
  assert.equal((await handshake(frame('https://nope.example.com/'), 'not-entitled', 'https://nope.example.com')).length, 0);
});

test('the two built-in plugins keep their handshake (ack at their own origin)', async () => {
  const { frame, handshake } = await setup();
  const chat = await handshake(frame(CHAT_URL), 'xgenia-ai', CHAT_URL);
  assert.equal(chat.length, 1);
  assert.deepEqual({ ...chat[0].message }, { type: 'handshake-ack', entitled: true, tier: 'pro' });
  assert.equal(chat[0].targetOrigin, CHAT_URL);
  const image = await handshake(frame('https://image.example.com/'), 'xgenia-image-editor', 'https://image.example.com');
  assert.equal(image.length, 1);
  assert.equal(image[0].message.entitled, false); // not in this account's entitlements
});

test('a web-panel frame cannot use the built-in plugins\' handshake', async () => {
  const { w, frame, handshake } = await setup();
  const bridge = w.EB.editorBridge;
  const before = { origin: bridge.pluginOrigin, connected: bridge.isConnected() };
  for (const name of ['xgenia-ai', 'xgenia-image-editor']) {
    // Even from an accepted web-panel frame at its own origin.
    const fr = frame(PANEL_URL, 'example-panel');
    await handshake(fr, 'example-panel', PANEL_ORIGIN);
    const acks = await handshake(fr, name, PANEL_ORIGIN);
    assert.equal(acks.length, 1, 'only the web-panel ack, none for the built-in name');
  }
  assert.equal(bridge.pluginOrigin, before.origin);
  assert.equal(bridge.isConnected(), before.connected);
});

test('events from a web-panel frame are dropped unless its handshake was accepted', async () => {
  const { w, frame, handshake } = await setup();
  const got = [];
  w.EB.editorBridge.on('example-event', (d) => got.push(d));
  const send = async (fr, origin, data) => {
    w.dispatchEvent(new w.MessageEvent('message', { data: { type: 'event', event: 'example-event', data }, origin, source: fr.f.contentWindow }));
    await new Promise((r) => setTimeout(r, 20));
  };
  const fr = frame(PANEL_URL, 'example-panel');
  await send(fr, PANEL_ORIGIN, 'before-handshake');
  await handshake(fr, 'example-panel', PANEL_ORIGIN);
  await send(fr, PANEL_ORIGIN, 'accepted');
  await send(fr, 'https://evil.example.com', 'wrong-origin');
  await send(frame(CHAT_URL), CHAT_URL, 'unmarked');
  assert.deepEqual(got, ['accepted', 'unmarked']);
});
