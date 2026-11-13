// Which <webview> the editor window may attach, and how. Two exist: the docs chat, and the AI browser
// the builder AI uses to open and check pages (a published game's link, for one). Both get a session of
// their own and the locked-down preferences below whatever the renderer asked for; any other webview
// is refused. The AI browser was refused too from 2026-10-19 to 2026-11-02, so every page it opened
// timed out ("AI browser timed out waiting for the page to load") and no publish could be checked.

const DOCS_CHAT_PARTITION = 'persist:xgenia-docs-chat';
const AI_BROWSER_PARTITION = 'xgenia-ai-browser';

/** 'docs-chat' | 'ai-browser' | null (refuse). `isDocsChatUrl` decides the docs chat's own pages. */
function webviewKind(params, isDocsChatUrl) {
  const src = String((params && params.src) || '');
  if (params && params.partition === DOCS_CHAT_PARTITION) return isDocsChatUrl(src) ? 'docs-chat' : null;
  if (params && params.partition === AI_BROWSER_PARTITION) return src === 'about:blank' || /^https?:\/\//i.test(src) ? 'ai-browser' : null;
  return null;
}

/** The preferences every allowed webview runs with: no preload, no Node, isolated, sandboxed. */
function lockDown(webPreferences) {
  delete webPreferences.preload;
  delete webPreferences.preloadURL;
  webPreferences.nodeIntegration = false;
  webPreferences.nodeIntegrationInSubFrames = false;
  webPreferences.contextIsolation = true;
  webPreferences.sandbox = true;
  webPreferences.webSecurity = true;
  webPreferences.webviewTag = false;
  return webPreferences;
}

module.exports = { DOCS_CHAT_PARTITION, AI_BROWSER_PARTITION, webviewKind, lockDown };
