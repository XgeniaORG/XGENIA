const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../../src/main/src/webview-policy');

// 2026-11-02: the guard attached only the docs chat, so the AI browser's every page timed out and no
// published link could be checked. Both are allowed now, each in its own session, both locked down.
const isDocs = (u) => u.startsWith('https://docsapp.xgenia.com/embed/chat/');

test('the docs chat and the AI browser attach; anything else is refused', () => {
  assert.equal(P.webviewKind({ partition: P.DOCS_CHAT_PARTITION, src: 'https://docsapp.xgenia.com/embed/chat/' }, isDocs), 'docs-chat');
  assert.equal(P.webviewKind({ partition: P.AI_BROWSER_PARTITION, src: 'https://gremlin-party.vercel.app' }, isDocs), 'ai-browser');
  assert.equal(P.webviewKind({ partition: P.AI_BROWSER_PARTITION, src: 'about:blank' }, isDocs), 'ai-browser');
  assert.equal(P.webviewKind({ partition: P.DOCS_CHAT_PARTITION, src: 'https://evil.example.com/' }, isDocs), null);
  assert.equal(P.webviewKind({ partition: P.AI_BROWSER_PARTITION, src: 'file:///etc/passwd' }, isDocs), null);
  assert.equal(P.webviewKind({ partition: undefined, src: 'https://example.com' }, isDocs), null);
  assert.equal(P.webviewKind({ partition: 'persist:other', src: 'https://example.com' }, isDocs), null);
});

test('whatever the renderer asked for, an attached webview has no preload, no Node and a sandbox', () => {
  const prefs = P.lockDown({ preload: '/x.js', preloadURL: 'file:///x.js', nodeIntegration: true, contextIsolation: false, webSecurity: false, sandbox: false, webviewTag: true });
  assert.deepEqual(prefs, { nodeIntegration: false, nodeIntegrationInSubFrames: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false });
});
