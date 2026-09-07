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
 */

import { ipcRenderer } from 'electron';

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

  constructor(element: HTMLIFrameElement, preloadPath: string) {
    this.element = element;
    this.preloadPath = preloadPath;
    element.addEventListener('load', this.onLoad);
  }

  dispose(): void {
    this.disposed = true;
    this.element.removeEventListener('load', this.onLoad);
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
    this.injectPreload();
    this.applyZoom();
    this.emit('dom-ready');
    this.emit('did-stop-loading');
    this.emit('did-finish-load');
  };

  canGoBack(): boolean {
    try {
      return (this.element.contentWindow?.history.length || 0) > 1;
    } catch {
      return false;
    }
  }

  canGoForward(): boolean {
    return false;
  }

  goBack(): void {
    try {
      this.element.contentWindow?.history.back();
    } catch {
      /* ignore */
    }
  }

  goForward(): void {
    try {
      this.element.contentWindow?.history.forward();
    } catch {
      /* ignore */
    }
  }

  reload(): void {
    try {
      this.element.contentWindow?.location.reload();
    } catch {
      // eslint-disable-next-line no-self-assign
      this.src = this.src;
    }
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
    const win = this.element.contentWindow as any;
    if (!win) throw new Error('Preview frame has no window');
    // Same semantics as webview.executeJavaScript: evaluate in the page's global scope and
    // resolve with the completion value (awaiting a promise if the code returned one).
    const result = win.eval(code);
    return result && typeof result.then === 'function' ? await result : result;
  }

  private injectPreload(): void {
    const win = this.element.contentWindow as any;
    if (!win || !this.preloadPath) return;
    let source: string;
    try {
      source = readPreload(this.preloadPath.replace(/^file:\/\//, '').replace(/\?.*$/, ''));
    } catch (e: any) {
      debugState.lastError = `read: ${e?.message || e}`;
      console.error('[IframeViewer] preload not readable, viewer bridge will be missing:', e);
      return;
    }

    this.dropIpcSubscriptions();
    const adapter = this;
    const shimIpc = {
      send: (channel: string, ...args: any[]) => ipcRenderer.send(channel, ...args),
      on: (channel: string, fn: (...a: any[]) => void) => {
        const wrapped = (...a: any[]) => fn(...a);
        adapter.ipcSubscriptions.push({ channel, fn: wrapped });
        ipcRenderer.on(channel, wrapped);
      },
      once: (channel: string, fn: (...a: any[]) => void) => ipcRenderer.once(channel, fn),
      removeListener: (channel: string, fn: (...a: any[]) => void) => ipcRenderer.removeListener(channel, fn),
      // What the preload used to reach its embedder with; the embedder is us.
      sendToHost: (channel: string, ...args: any[]) => adapter.emit('ipc-message', { channel, args })
    };
    const nodePath = nodeRequire('path');
    const preloadDir = nodePath.dirname(this.preloadPath.replace(/^file:\/\//, '').replace(/\?.*$/, ''));
    const shimRequire = (id: string) => {
      if (id === 'electron') return { ipcRenderer: shimIpc, contextBridge: { exposeInMainWorld: () => undefined } };
      if (id === 'path') return nodePath;
      // Sibling files of the preload (its CSP config) resolve on disk, through Node's require.
      if (id.startsWith('./') || id.startsWith('../')) return nodeRequire(nodePath.join(preloadDir, id));
      return nodeRequire(id);
    };

    try {
      // Evaluate INSIDE the frame so `window`, `document` and the API it installs are the
      // viewer's, not ours. The wrapper supplies the CommonJS globals the file assumes.
      const factory = win.eval(
        '(function (require, module, exports, process, __dirname, __filename) {\n' + source + '\n})'
      );
      const mod = { exports: {} };
      factory(shimRequire, mod, mod.exports, { env: { NODE_ENV: process.env.NODE_ENV } }, preloadDir, this.preloadPath);
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
    try {
      const doc = this.element.contentDocument;
      if (doc?.documentElement) (doc.documentElement.style as any).zoom = String(this.zoom);
    } catch {
      /* not reachable yet */
    }
  }

  // ── capture / devtools / identity ─────────────────────────────────────────

  async capturePage(): Promise<Electron.NativeImage> {
    // The frame is painted by THIS webContents, so capture our own page clipped to the
    // frame's visual box. The rect is CSS pixels; Electron scales for the display.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const remote = require('@electron/remote');
    const r = this.element.getBoundingClientRect();
    const rect = {
      x: Math.max(0, Math.round(r.x)),
      y: Math.max(0, Math.round(r.y)),
      width: Math.max(1, Math.round(r.width)),
      height: Math.max(1, Math.round(r.height))
    };
    return remote.getCurrentWebContents().capturePage(rect);
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
