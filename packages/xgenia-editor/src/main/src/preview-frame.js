// Runs script inside the editor's live preview <iframe> for the renderer (IframeViewer.ts).
//
// The preview used to be scriptable straight from the editor page: the window runs with webSecurity
// off and, up to Electron 31, a cross-origin iframe stayed in the editor's own process, so
// iframe.contentWindow.eval() worked. From Electron 44 the preview (http://localhost:<port>) always
// gets a process of its own, whatever site-isolation switches are set, and the editor page can no
// longer touch it. The viewer bridge was never injected, so Edit mode did nothing: the toolbar said
// Edit while the preview ignored every click. (Measured 2026-11-06, same repro on 31.7.7 and 44.7.2.)
//
// WebFrameMain.executeJavaScript reaches a frame in any process, so the renderer asks here instead.

/** Only the local preview server, never a remote panel (the AI chat, plugins) in the same window. */
function isPreviewOrigin(origin) {
  try {
    const u = new URL(origin);
    if (u.origin !== origin) return false;
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
  } catch {
    return false;
  }
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** The sender's sub-frame showing `origin`; the newest one if a reload briefly left two. */
function findPreviewFrame(sender, origin) {
  const root = sender && sender.mainFrame;
  if (!root) return null;
  const matches = root.framesInSubtree.filter((f) => f !== root && !f.detached && originOf(f.url) === origin);
  return matches.length ? matches[matches.length - 1] : null;
}

function registerPreviewFrameHandlers(ipcMain) {
  ipcMain.handle('preview-frame:exec', async (event, payload) => {
    const origin = payload && payload.origin;
    const code = payload && payload.code;
    if (typeof code !== 'string' || !isPreviewOrigin(origin)) {
      throw new Error('preview-frame:exec: not a local preview origin');
    }
    const frame = findPreviewFrame(event.sender, origin);
    if (!frame) throw new Error('Preview frame not found');
    return frame.executeJavaScript(code);
  });
}

module.exports = { registerPreviewFrameHandlers, isPreviewOrigin, findPreviewFrame };
