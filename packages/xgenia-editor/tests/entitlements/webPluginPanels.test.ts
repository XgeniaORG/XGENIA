// Generic web-plugin panels: which entitled plugins get a sidebar entry, and when.
//   npx tsx --test packages/xgenia-editor/tests/entitlements/webPluginPanels.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  localPluginOverride,
  pluginOrigin,
  webPanelPlugins,
  UNVERIFIED_TIER,
  type EntitlementsResponse,
} from '../../src/editor/src/views/panels/ChatPanelBridge/PluginLoader';
import {
  syncWebPluginPanels,
  webPluginPanelId,
} from '../../src/editor/src/views/panels/WebPluginPanel/webPluginSidebar';

const CHAT = { id: 'ai-chat', name: 'AI Chat', url: 'https://chat.example.com', version: '1' };
const IMAGE = { id: 'ai-image-editor', name: 'AI Image Editor', url: 'https://image.example.com', version: '1' };
const PANEL = { id: 'example-panel', name: 'Example Panel', url: 'https://panel.example.com/app', version: '1', kind: 'web-panel', icon: 'plugin' };
const PLAIN = { id: 'other-tool', name: 'Other', url: 'https://other.example.com', version: '1' };

const verdict = (plugins: any[]): EntitlementsResponse => ({ plugins, tier: 'pro', source: 'server', cachedAt: 1 });

/** A sidebar that records what was registered, keyed by id like SidebarModel. */
function fakeSidebar(initial: string[] = []) {
  const items = new Map<string, any>(initial.map((id) => [id, { id }]));
  return {
    items,
    getItems: () => [...items.values()],
    register: (item: any) => { items.set(item.id, item); },
    unregister: (id: string) => { items.delete(id); },
  };
}

const makeItem = (p: any, index: number) => ({ id: webPluginPanelId(p.id), name: p.name || p.id, pluginId: p.id, index });

test('an entitled web-panel plugin gets a sidebar entry for its id', () => {
  const sidebar = fakeSidebar(['components', 'chat']);
  const r = syncWebPluginPanels(sidebar, verdict([CHAT, IMAGE, PANEL]), makeItem);
  assert.deepEqual(r.added, ['web-plugin:example-panel']);
  const item = sidebar.items.get('web-plugin:example-panel');
  assert.equal(item.pluginId, 'example-panel');
  assert.equal(item.name, 'Example Panel');
});

test('a plugin without kind gets no entry, and nothing changes for current users', () => {
  const sidebar = fakeSidebar(['components']);
  const r = syncWebPluginPanels(sidebar, verdict([CHAT, IMAGE, PLAIN]), makeItem);
  assert.deepEqual(r, { added: [], removed: [] });
  assert.deepEqual([...sidebar.items.keys()], ['components']);
});

test('the dedicated plugins never get a generic panel, even marked web-panel', () => {
  const plugins = [{ ...CHAT, kind: 'web-panel' }, { ...IMAGE, kind: 'web-panel' }];
  assert.deepEqual(webPanelPlugins(verdict(plugins)), []);
});

test('a web panel with no name is labelled with its id', () => {
  const sidebar = fakeSidebar();
  syncWebPluginPanels(sidebar, verdict([{ ...PANEL, name: undefined }]), makeItem);
  assert.equal(sidebar.items.get('web-plugin:example-panel').name, 'example-panel');
});

test('unloadable URLs and odd ids are refused', () => {
  const bad = [
    { ...PANEL, id: 'a', url: 'http://panel.example.com' },          // plain http off this machine
    { ...PANEL, id: 'b', url: 'javascript:alert(1)' },
    { ...PANEL, id: 'c', url: 'not a url' },
    { ...PANEL, id: '../x', url: 'https://x.example.com' },
    { ...PANEL, id: 'd', url: undefined },
  ];
  assert.deepEqual(webPanelPlugins(verdict(bad)), []);
  withDevBuild(true, () => assert.equal(webPanelPlugins(verdict([{ ...PANEL, url: 'http://localhost:5173' }])).length, 1));
  withDevBuild(false, () => assert.equal(webPanelPlugins(verdict([{ ...PANEL, url: 'http://localhost:5173' }])).length, 0));
});

/** Run `fn` as a dev build (devMode=yes, as dev-main.js sets) or as a packaged one. */
function withDevBuild(dev: boolean, fn: () => void) {
  const saved = { devMode: process.env.devMode, NODE_ENV: process.env.NODE_ENV };
  if (dev) process.env.devMode = 'yes'; else delete process.env.devMode;
  if (!dev && saved.NODE_ENV === 'development') delete process.env.NODE_ENV;
  try { fn(); } finally {
    if (saved.devMode === undefined) delete process.env.devMode; else process.env.devMode = saved.devMode;
    if (saved.NODE_ENV === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = saved.NODE_ENV;
  }
}

test('pluginOrigin in a packaged build: https only', () => {
  withDevBuild(false, () => {
    assert.equal(pluginOrigin('https://panel.example.com/app?x=1'), 'https://panel.example.com');
    assert.equal(pluginOrigin('http://localhost:5173/'), null);
    assert.equal(pluginOrigin('http://127.0.0.1:5173/'), null);
    assert.equal(pluginOrigin('http://panel.example.com'), null);
    assert.equal(pluginOrigin('file:///etc/passwd'), null);
  });
});

test('pluginOrigin in a dev build: https, or plain http on this machine', () => {
  withDevBuild(true, () => {
    assert.equal(pluginOrigin('https://panel.example.com/app'), 'https://panel.example.com');
    assert.equal(pluginOrigin('http://localhost:5173/'), 'http://localhost:5173');
    assert.equal(pluginOrigin('http://panel.example.com'), null);
  });
});

test('an unverified answer changes nothing; a later verdict removes a lost entitlement', () => {
  const sidebar = fakeSidebar();
  syncWebPluginPanels(sidebar, verdict([PANEL]), makeItem);
  const unverified: EntitlementsResponse = { plugins: [], tier: UNVERIFIED_TIER, source: 'unverified' };
  assert.deepEqual(syncWebPluginPanels(sidebar, unverified, makeItem), { added: [], removed: [] });
  assert.ok(sidebar.items.has('web-plugin:example-panel'));
  const r = syncWebPluginPanels(sidebar, verdict([CHAT]), makeItem);
  assert.deepEqual(r.removed, ['web-plugin:example-panel']);
});

test('signing out removes every web panel and only those', () => {
  const sidebar = fakeSidebar(['components', 'image-editor']);
  syncWebPluginPanels(sidebar, verdict([PANEL]), makeItem);
  syncWebPluginPanels(sidebar, null, makeItem);
  assert.deepEqual([...sidebar.items.keys()].sort(), ['components', 'image-editor']);
});

test('syncing twice registers once', () => {
  const sidebar = fakeSidebar();
  let registers = 0;
  const counting = { ...sidebar, register: (i: any) => { registers++; sidebar.register(i); } };
  syncWebPluginPanels(counting, verdict([PANEL]), makeItem);
  syncWebPluginPanels(counting, verdict([PANEL]), makeItem);
  assert.equal(registers, 1);
});

test('dev override: XGENIA_LOCAL_PLUGIN_<ID> accepts localhost only', () => {
  assert.equal(localPluginOverride('example-panel', { XGENIA_LOCAL_PLUGIN_EXAMPLE_PANEL: 'http://localhost:4000' }), 'http://localhost:4000');
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(localPluginOverride('example-panel', { XGENIA_LOCAL_PLUGIN_EXAMPLE_PANEL: 'https://evil.example.com' }), null);
  } finally { console.warn = warn; }
  assert.equal(localPluginOverride('example-panel', {}), null);
});
