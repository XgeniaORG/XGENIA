/**
 * IframeViewer — the live preview as an in-process <iframe>, wearing the <webview> API.
 *
 * WHY (2026-09-07). The whole editor window flashed — another surface showing for a frame —
 * on hover, scroll and while the chat streamed, on an M5 under macOS 26. A day of in-page
 * instrumentation saw nothing, because the fault is below the page: a screen recording at
 * 120fps caught the frame, and it is the <webview>'s OWN surface presented raw, unscaled and
 * letterboxed, without the parent frame it belongs in. A <webview> is a separate renderer
 * with its own compositor surface that the GPU process stitches into ours every frame; on
 * this OS that stitch occasionally presents the child alone. Measured, 60s of scripted
 * scrolling each: <webview> guest 1 flash, same animation as an in-process <iframe> 0, guest
 * removed 0. The chat panel — a cross-origin iframe, drawn by our own renderer because the
 * app runs with site isolation off — never flashed.
 *
 * So the preview becomes an <iframe>. Nothing above CanvasView knows: this object exposes
 * the subset of Electron.WebviewTag that CanvasView, VisualCanvas and the AI tools actually
 * call (executeJavaScript, capturePage, src, the did-… / dom-ready / ipc-message events,
 * setZoomFactor, reload, navigation state), so the surface XGENIA has built against for a
 * year is unchanged.
 *
 * HOW the preload survives. webview-preload-viewer.js gave the viewer `window.XgeniaEditorAPI`
 * and the inspector; an iframe cannot run a preload. It IS still needed, so on every load the
 * same file is read from disk and evaluated inside the frame's window, with a `require` that
 * supplies exactly what the file asks for: `electron` (ipcRenderer routed through THIS
 * renderer's ipcRenderer, and `sendToHost` turned into an 'ipc-message' on this adapter),
 * `path`, and its sibling CSP config. This works because the main window runs with
 * webSecurity off and site isolation off, so a cross-origin frame's window is reachable and
 * shares our process. If either of those ever changes, this adapter stops being possible and
 * the flash comes back with the <webview>.
 *
 * The main process already routes editor-api-request/response by the requesting
 * webContents (main.js setupEditorApiRouting); with the frame in-process the requester is
 * the editor window itself, so replies arrive on our ipcRenderer and are handed to the
 * injected preload's own token table. Nothing in main changes.
 *
 * (2026-11-06) Electron 44 broke the "in-process" half: the preview now always gets a process
 * of its own, so contentWindow is cross-origin and every eval threw. The preload was never
 * injected and Edit mode did nothing. Script now runs through the main process
 * (main/src/preview-frame.js, WebFrameMain.executeJavaScript), and the preload's ipcRenderer is
 * a postMessage shim relayed here. Both work whichever process the frame lands in.
 */

import { ipcRenderer } from 'electron';
import { afterNextPaint } from './paintWait';

type Listener = (event: any) => void;

/** The Electron.WebviewTag members CanvasView, VisualCanvas and the AI tools use. */
export interface PreviewHost {
  src: string;
  readonly isConnected: boolean;
  readonly element: HTMLIFrameElement;
  executeJavaScript(code: string): Promise<any>;
  capturePage(): Promise<Electron.NativeImage>;
  addEventListener(type: string, fn: Listener): void;
  removeEventListener(type: string, fn: Listener): void;
  setZoomFactor(factor: number): void;
  getZoomFactor(): number;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  reloadIgnoringCache(): void;
  openDevTools(): void;
  closeDevTools(): void;
  isDevToolsOpened(): boolean;
  getWebContentsId(): number;
  setAttribute(name: string, value: string): void;
  getBoundingClientRect(): DOMRect;
  /** The host element's inline style and parent, for the sizing code that used to poke the
   *  <webview> element directly. */
  readonly style: CSSStyleDeclaration;
  readonly parentElement: HTMLElement | null;
}

/** Observable from DevTools or CDP as `window.__IframeViewerDebug`, so "did the preload land"
 *  is a question with an answer rather than a guess. */
const debugState = {
  loads: 0,
  loadsWhileDisposed: 0,
  injected: 0,
  lastLoadAt: 0,
  lastError: null as string | null
};
try {
  (window as any).__IframeViewerDebug = debugState;
} catch {
  /* not in a window */
}

let preloadSourceCache: { path: string; text: string } | null = null;

/** IPC the viewer preload may send through the bridge, and the replies it may listen for. */
const FRAME_SEND_CHANNELS = new Set(['editor-api-request', 'request-media-access']);
const FRAME_LISTEN_CHANNELS = new Set(['editor-api-response', 'request-media-access-reply']);

/**
 * The script evaluated inside the preview frame: an ipcRenderer that speaks postMessage to the
 * editor (which relays it to real IPC), a require that hands the preload exactly what it asks
 * for, then the preload itself.
 */
function bridgeSource(preload: string, csp: unknown, nodeEnv: string): string {
  return [
    '(function () {',
    "  if (window.__xgPreviewBridgeInstalled) return 'already';",
    '  window.__xgPreviewBridgeInstalled = true;',
    '  var host = window.parent;',
    '  var subs = Object.create(null);',
    "  function post(m) { m.__xgPreviewBridge = 1; host.postMessage(m, '*'); }",
    "  window.addEventListener('message', function (e) {",
    '    var d = e.data;',
    "    if (e.source !== host || !d || d.__xgPreviewHost !== 1 || d.type !== 'ipc') return;",
    '    var fns = (subs[d.channel] || []).slice();',
    '    for (var i = 0; i < fns.length; i++) {',
    "      try { fns[i].apply(null, [{ sender: null }].concat(d.args || [])); } catch (err) { console.error('[preview bridge]', err); }",
    '    }',
    '  });',
    '  var ipcRenderer = {',
    "    send: function (c) { post({ type: 'send', channel: c, args: [].slice.call(arguments, 1) }); },",
    "    sendToHost: function (c) { post({ type: 'host', channel: c, args: [].slice.call(arguments, 1) }); },",
    "    on: function (c, fn) { if (!subs[c]) { subs[c] = []; post({ type: 'sub', channel: c }); } subs[c].push(fn); return ipcRenderer; },",
    '    once: function (c, fn) { var w = function () { ipcRenderer.removeListener(c, w); return fn.apply(null, arguments); }; return ipcRenderer.on(c, w); },',
    '    removeListener: function (c, fn) { var l = subs[c]; if (l) { var i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } return ipcRenderer; }',
    '  };',
    '  var csp = ' + JSON.stringify(csp ?? {}) + ';',
    '  function req(id) {',
    "    if (id === 'electron') return { ipcRenderer: ipcRenderer, contextBridge: { exposeInMainWorld: function () {} } };",
    "    if (id === 'path') return {};",
    "    if (/webview-csp-config(\\.js)?$/.test(id)) return csp;",
    "    throw new Error('preview bridge: cannot require ' + id);",
    '  }',
    '  var module = { exports: {} };',
    '  (function (require, module, exports, process, __dirname, __filename) {',
    preload,
    "  })(req, module, module.exports, { env: { NODE_ENV: " + JSON.stringify(nodeEnv) + " } }, '', '');",
    "  return 'ok';",
    '})()'
  ].join('\n');
}

/**
 * Node's real `require`, not webpack's. Inside this bundle `require` is webpack's module
 * resolver, which only knows what was bundled — asking it for the preload's sibling CSP
 * config by absolute path fails with "Cannot find module". The editor window runs with
 * nodeIntegration on, so the page's global `require` is Node's and resolves files on disk.
 */
function nodeRequire(id: string): any {
  const w = window as any;
  const r = typeof w.require === 'function' ? w.require : require;
  return r(id);
}

function readPreload(preloadPath: string): string {
  if (preloadSourceCache && preloadSourceCache.path === preloadPath) return preloadSourceCache.text;
  const fs = nodeRequire('fs');
  const text = fs.readFileSync(preloadPath, 'utf8');
  preloadSourceCache = { path: preloadPath, text };
  return text;
}

export class IframeViewer implements PreviewHost {
  readonly element: HTMLIFrameElement;
  private listeners = new Map<string, Set<Listener>>();
  private preloadPath: string;
  private zoom = 1;
  private lastUrl = '';
  private ipcSubscriptions: Array<{ channel: string; fn: (...a: any[]) => void }> = [];
  private disposed = false;
  private loadGeneration = 0;
  private historyLength = 0;

  constructor(element: HTMLIFrameElement, preloadPath: string) {
    this.element = element;
    this.preloadPath = preloadPath;
    element.addEventListener('load', this.onLoad);
    window.addEventListener('message', this.onFrameMessage);
  }

  dispose(): void {
    this.disposed = true;
    this.element.removeEventListener('load', this.onLoad);
    window.removeEventListener('message', this.onFrameMessage);
    this.dropIpcSubscriptions();
    this.listeners.clear();
  }

  // ── events ────────────────────────────────────────────────────────────────

  addEventListener(type: string, fn: Listener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }

  removeEventListener(type: string, fn: Listener): void {
    this.listeners.get(type)?.delete(fn);
  }

  private emit(type: string, event: any = {}): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(event);
      } catch (e) {
        console.error(`[IframeViewer] listener for '${type}' threw`, e);
      }
    }
  }

  // ── navigation ────────────────────────────────────────────────────────────

  get src(): string {
    return this.element.getAttribute('src') || '';
  }

  set src(value: string) {
    if (this.disposed) return;
    this.lastUrl = value;
    this.emit('did-start-loading');
    this.element.setAttribute('src', value);
  }

  get isConnected(): boolean {
    return this.element.isConnected;
  }

  private onLoad = (): void => {
    debugState.loads++;
    debugState.lastLoadAt = Date.now();
    if (this.disposed) {
      debugState.loadsWhileDisposed++;
      return;
    }
    let url = this.lastUrl;
    try {
      url = this.element.contentWindow?.location.href || url;
    } catch {
      /* cross-origin without webSecurity off — then nothing below works either */
    }
    this.emit('load-commit', { url, isMainFrame: true });
    void this.finishLoad();
  };

  /** The preload must be in the frame before dom-ready: listeners call its APIs right away. */
  private async finishLoad(): Promise<void> {
    const generation = ++this.loadGeneration;
    await this.injectPreload();
    if (this.disposed || generation !== this.loadGeneration) return;
    this.applyZoom();
    this.emit('dom-ready');
    this.emit('did-stop-loading');
    this.emit('did-finish-load');
    this.executeJavaScript('history.length').then(
      (n) => {
        this.historyLength = Number(n) || 0;
      },
      () => {
        this.historyLength = 0;
      }
    );
  }

  /** Messages from the bridge running inside the preview frame (see bridgeSource). */
  private onFrameMessage = (e: MessageEvent): void => {
    if (this.disposed || !e.source || e.source !== this.element.contentWindow) return;
    const d = e.data;
    if (!d || d.__xgPreviewBridge !== 1) return;
    const channel = String(d.channel || '');
    const args = Array.isArray(d.args) ? d.args : [];
    if (d.type === 'host') {
      this.emit('ipc-message', { channel, args });
    } else if (d.type === 'send') {
      if (FRAME_SEND_CHANNELS.has(channel)) ipcRenderer.send(channel, ...args);
    } else if (d.type === 'sub') {
      if (!FRAME_LISTEN_CHANNELS.has(channel) || this.ipcSubscriptions.some((s) => s.channel === channel)) return;
      const fn = (_event: any, ...a: any[]) => this.postToFrame({ type: 'ipc', channel, args: a });
      this.ipcSubscriptions.push({ channel, fn });
      ipcRenderer.on(channel, fn);
    }
  };

  private postToFrame(message: Record<string, unknown>): void {
    const origin = this.previewOrigin();
    if (!origin) return;
    try {
      this.element.contentWindow?.postMessage({ __xgPreviewHost: 1, ...message }, origin);
    } catch {
      /* frame gone */
    }
  }

  private previewOrigin(): string | null {
    try {
      return new URL(this.element.src || this.lastUrl).origin;
    } catch {
      return null;
    }
  }

  canGoBack(): boolean {
    return this.historyLength > 1;
  }

  canGoForward(): boolean {
    return false;
  }

  goBack(): void {
    this.executeJavaScript('history.back()').catch(() => undefined);
  }

  goForward(): void {
    this.executeJavaScript('history.forward()').catch(() => undefined);
  }

  reload(): void {
    this.executeJavaScript('location.reload()').catch(() => {
      // eslint-disable-next-line no-self-assign
      this.src = this.src;
    });
  }

  reloadIgnoringCache(): void {
    // Cache-bust the URL; a location.reload(true) is not honoured by Chromium any more.
    const base = this.src.replace(/([?&])_nc=\d+/, '').replace(/[?&]$/, '');
    const sep = base.includes('?') ? '&' : '?';
    this.src = `${base}${sep}_nc=${Date.now()}`;
  }

  setAttribute(name: string, value: string): void {
    // The <webview>-only security attributes are meaningless on an iframe; keep the call
    // shape so VisualCanvas's existing setup code does not have to know which host it has.
    if (name === 'disablewebsecurity' || name === 'allowpopups' || name === 'nodeintegration') return;
    this.element.setAttribute(name, value);
  }

  getBoundingClientRect(): DOMRect {
    return this.element.getBoundingClientRect();
  }

  // ── scripting ─────────────────────────────────────────────────────────────

  async executeJavaScript(code: string): Promise<any> {
    // Same semantics as webview.executeJavaScript: evaluate in the page's global scope and
    // resolve with the completion value (awaiting a promise if the code returned one). Runs via
    // the main process (main/src/preview-frame.js) because the frame is in another process.
    const origin = this.previewOrigin();
    if (!origin) throw new Error('Preview frame has no origin');
    return ipcRenderer.invoke('preview-frame:exec', { origin, code });
  }

  private async injectPreload(): Promise<void> {
    if (!this.preloadPath) return;
    let source: string;
    try {
      source = readPreload(this.preloadPath.replace(/^file:\/\//, '').replace(/\?.*$/, ''));
    } catch (e: any) {
      debugState.lastError = `read: ${e?.message || e}`;
      console.error('[IframeViewer] preload not readable, viewer bridge will be missing:', e);
      return;
    }

    this.dropIpcSubscriptions();
    const nodePath = nodeRequire('path');
    const preloadDir = nodePath.dirname(this.preloadPath.replace(/^file:\/\//, '').replace(/\?.*$/, ''));
    let csp: unknown = {};
    try {
      // The preload's sibling CSP config, read here on disk and handed over as data.
      csp = nodeRequire(nodePath.join(preloadDir, 'webview-csp-config.js'));
    } catch {
      /* the preload falls back to its own CSP handling */
    }

    try {
      // Evaluated INSIDE the frame so `window`, `document` and the API it installs are the
      // viewer's, not ours. bridgeSource supplies the CommonJS globals the file assumes.
      await this.executeJavaScript(bridgeSource(source, csp, process.env.NODE_ENV || ''));
      debugState.injected++;
      debugState.lastError = null;
    } catch (e: any) {
      debugState.lastError = `inject: ${e?.message || e}`;
      console.error('[IframeViewer] preload threw inside the frame:', e);
    }
  }

  private dropIpcSubscriptions(): void {
    for (const s of this.ipcSubscriptions) ipcRenderer.removeListener(s.channel, s.fn);
    this.ipcSubscriptions = [];
  }

  // ── zoom ──────────────────────────────────────────────────────────────────

  setZoomFactor(factor: number): void {
    this.zoom = factor;
    this.applyZoom();
  }

  getZoomFactor(): number {
    return this.zoom;
  }

  private applyZoom(): void {
    const zoom = JSON.stringify(String(this.zoom));
    this.executeJavaScript(`document.documentElement && (document.documentElement.style.zoom = ${zoom}), true`).catch(
      () => undefined /* not loaded yet: re-applied on the next load */
    );
  }

  // ── capture / devtools / identity ─────────────────────────────────────────

  async capturePage(): Promise<Electron.NativeImage> {
    // The frame is painted by THIS webContents, so capture our own page clipped to the
    // frame's visual box. The rect is CSS pixels; Electron scales for the display.
    //
    // (2026-10-07) capturePage() copies the frame the window last PRESENTED. Callers change the
    // DOM right before capturing (the design capture resizes this element; withOccludersHidden
    // hides panels), so wait until that change is painted — otherwise the image is the frame
    // from before it (paintWait.ts).
    await afterNextPaint();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const remote = require('@electron/remote');
    const wc = remote.getCurrentWebContents();
    const r = this.element.getBoundingClientRect();
    // (2026-09-16, run 8/9 thumbnails) capturePage()'s rect is in DEVICE-INDEPENDENT pixels of the
    // unzoomed view; getBoundingClientRect() is CSS px, and this editor runs at a zoom factor, so
    // CSS px = DIP / zoom. Measured live at zoom 0.8 on a 2x display (devicePixelRatio 1.6): a
    // 100x100 rect came back 200x200, i.e. DIP x display scale. Passing CSS px unscaled captured a
    // box 25% too large starting 25% too far right/down — every thumbnail carried a strip of the
    // node-graph canvas below the preview and the inspector to its right.
    let zoom = 1;
    try { zoom = wc.getZoomFactor() || 1; } catch { /* no zoom API — treat as 1 */ }
    const rect = {
      x: Math.max(0, Math.round(r.x * zoom)),
      y: Math.max(0, Math.round(r.y * zoom)),
      width: Math.max(1, Math.round(r.width * zoom)),
      height: Math.max(1, Math.round(r.height * zoom))
    };
    return wc.capturePage(rect);
  }

  openDevTools(): void {
    // The frame lives in our renderer; the editor's own DevTools shows it under its frame list.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('@electron/remote').getCurrentWebContents().openDevTools({ mode: 'detach' });
  }

  closeDevTools(): void {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('@electron/remote').getCurrentWebContents().closeDevTools();
  }

  isDevToolsOpened(): boolean {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('@electron/remote').getCurrentWebContents().isDevToolsOpened();
  }

  get style(): CSSStyleDeclaration {
    return this.element.style;
  }

  get parentElement(): HTMLElement | null {
    return this.element.parentElement;
  }

  getWebContentsId(): number {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('@electron/remote').getCurrentWebContents().id;
  }
}
