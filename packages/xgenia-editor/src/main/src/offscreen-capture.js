// A design-size screenshot of the game taken in a hidden, offscreen window of its own.
//
// WHY (2026-11-12). Since Electron 44 the live preview <iframe> runs in a process of its own
// (preview-frame.js). Its guest window can lose its size while the pane still shows the last frame it
// painted: the guest reports innerWidth 0 (or stays at an old 1157x504), the in-place design capture
// fails "did not reach 1920x1080 (it reports 0x0)", and the pane capture returns a black image. The
// in-place capture also cannot work while the editor window is hidden or minimised.
//
// This capture does not depend on the editor's layout, focus or window size at all: a hidden
// BrowserWindow with offscreen rendering, sized exactly to the design, loads the same preview URL,
// waits for the game to mount and settle, and captures. It is a FRESH load, so it shows the game as
// it starts, not the state the user has played it into — the in-place capture stays for "what the
// user sees".
//
// The window registers with the editor as a viewer like any preview. Its User-Agent carries
// CAPTURE_UA_TAG; the relay (web-server.js) marks its socket, and the editor never addresses it as
// "the game" (ViewerConnection.ts), so a signal or eval meant for the user's preview never lands here.

const CAPTURE_UA_TAG = 'XgeniaCapture/1';
// A session of its own (in memory). Chromium keeps zoom per HOST, ignoring the port: the editor's
// UI zoom on localhost:8080 (0.8 by default) also zoomed this window's localhost:8574 page, so a
// 1920x1080 window laid the game out at 2400x1350 and every capture failed GUEST_UNSIZED (found live
// 2026-11-12). Zoom lives per session, so here it stays 1 and the editor's zoom is never touched.
const CAPTURE_PARTITION = 'xgenia-capture';
const MAX_SIDE = 4096;

/** True for the User-Agent of a capture window (see CAPTURE_UA_TAG). */
function isCaptureUserAgent(ua) {
  return typeof ua === 'string' && ua.includes(CAPTURE_UA_TAG);
}

/** Probed in the capture window: its viewport, how much has mounted, and the game's canvas. */
const STATE_JS = `(() => {
  let cw = 0, ch = 0;
  for (const c of document.querySelectorAll('canvas')) {
    const r = c.getBoundingClientRect();
    if (r.width * r.height > cw * ch) { cw = Math.round(r.width); ch = Math.round(r.height); }
  }
  return {
    w: window.innerWidth, h: window.innerHeight,
    ready: document.readyState,
    nodes: document.getElementsByTagName('*').length,
    cw, ch
  };
})()`;

/**
 * Whether a run of probes (oldest first) shows a settled page at width x height: the viewport is that
 * size, the document is complete, something has mounted, and the last `stableCount` probes agree on
 * how much has mounted and how big the canvas is.
 */
function isSettled(samples, width, height, stableCount = 3) {
  if (!Array.isArray(samples) || samples.length < stableCount) return false;
  const last = samples.slice(-stableCount);
  const first = last[0];
  if (!first) return false;
  for (const s of last) {
    if (!s || s.ready !== 'complete') return false;
    if (Math.abs(s.w - width) > 2 || Math.abs(s.h - height) > 2) return false;
    // Mounted: a DOM of some size, or a canvas game (Pixi draws into one element and little else).
    if (!(s.nodes > 5) && !(s.cw > 0 && s.ch > 0)) return false;
    if (s.nodes !== first.nodes || s.cw !== first.cw || s.ch !== first.ch) return false;
  }
  return true;
}

/**
 * True when a BGRA/RGBA bitmap is one colour (within `tolerance` per channel) at every sampled point:
 * a page that painted nothing, or a black surface. Sampled on a grid, so a 1920x1080 image costs
 * ~1,000 reads, not two million.
 */
function isUniformBitmap(buf, width, height, tolerance = 4, grid = 32) {
  if (!buf || !(width > 0) || !(height > 0) || buf.length < width * height * 4) return true;
  const at = (x, y) => (y * width + x) * 4;
  const o = at(0, 0);
  const ref = [buf[o], buf[o + 1], buf[o + 2]];
  for (let gy = 0; gy <= grid; gy++) {
    const y = Math.min(height - 1, Math.round((gy * (height - 1)) / grid));
    for (let gx = 0; gx <= grid; gx++) {
      const x = Math.min(width - 1, Math.round((gx * (width - 1)) / grid));
      const i = at(x, y);
      if (
        Math.abs(buf[i] - ref[0]) > tolerance ||
        Math.abs(buf[i + 1] - ref[1]) > tolerance ||
        Math.abs(buf[i + 2] - ref[2]) > tolerance
      ) {
        return false;
      }
    }
  }
  return true;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function withTimeout(promise, ms, what) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      t = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
    })
  ]).finally(() => clearTimeout(t));
}

let inFlight = null;

/**
 * Capture `url` at exactly width x height in a hidden offscreen window.
 *
 * Resolves (never rejects) with
 *   { success: true, image: <png data URL>, width, height, offscreen: true, settled, message }
 *   { success: false, code, message, ... }     code: BAD_SIZE | BUSY | LOAD_FAILED | GUEST_UNSIZED | BLANK_CAPTURE | FAILED
 *
 * `deps.BrowserWindow` is Electron's (injectable for tests).
 */
async function captureDesignOffscreen({ url, width, height, timeoutMs = 20000, minSettleMs = 1200, pollMs = 250 }, deps) {
  width = Math.round(Number(width));
  height = Math.round(Number(height));
  if (!(width > 0) || !(height > 0) || width > MAX_SIDE || height > MAX_SIDE) {
    return { success: false, code: 'BAD_SIZE', message: `offscreen capture: ${width}x${height} is not a size it can draw (1..${MAX_SIDE} each side)` };
  }
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
    return { success: false, code: 'LOAD_FAILED', message: 'offscreen capture: no preview URL to load' };
  }
  if (inFlight) {
    return { success: false, code: 'BUSY', busy: true, message: 'offscreen capture: another offscreen capture is running — retry in a moment' };
  }
  const { BrowserWindow } = deps;
  const started = Date.now();
  const deadline = started + timeoutMs;
  let win = null;
  const run = (async () => {
    try {
      win = new BrowserWindow({
        show: false,
        width,
        height,
        useContentSize: true,
        frame: false,
        resizable: false,
        skipTaskbar: true,
        paintWhenInitiallyHidden: true,
        webPreferences: {
          offscreen: true,
          partition: CAPTURE_PARTITION,
          zoomFactor: 1,
          backgroundThrottling: false,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true
        }
      });
      const wc = win.webContents;
      try { win.setContentSize(width, height); } catch { /* the constructor size stands */ }
      try { wc.setAudioMuted(true); } catch { /* no audio API */ }
      try { wc.setFrameRate(30); } catch { /* not an offscreen window */ }
      const userAgent = `${wc.getUserAgent()} ${CAPTURE_UA_TAG}`;
      try {
        await withTimeout(win.loadURL(url, { userAgent }), Math.max(1000, deadline - Date.now()), 'loading the preview');
      } catch (e) {
        return { success: false, code: 'LOAD_FAILED', message: `offscreen capture: the preview did not load (${e && e.message ? e.message : e})` };
      }
      // Belt and braces: in its own session this changes no other page's zoom.
      try { if (wc.getZoomFactor() !== 1) wc.setZoomFactor(1); } catch { /* no zoom API */ }

      const samples = [];
      let settled = false;
      while (Date.now() < deadline) {
        try { samples.push(await withTimeout(wc.executeJavaScript(STATE_JS), 2000, 'probing the page')); } catch { samples.push(null); }
        if (Date.now() - started >= minSettleMs && isSettled(samples, width, height)) { settled = true; break; }
        await sleep(pollMs);
      }
      const last = samples.filter(Boolean).pop() || { w: 0, h: 0 };
      if (Math.abs(last.w - width) > 2 || Math.abs(last.h - height) > 2) {
        return {
          success: false,
          code: 'GUEST_UNSIZED',
          guest: { width: last.w, height: last.h },
          message: `offscreen capture: the capture window did not reach ${width}x${height} (it reports ${last.w}x${last.h})`
        };
      }

      // A page that has not painted yet captures as one colour; give it until the deadline.
      for (;;) {
        let img = await wc.capturePage();
        const size = img && !img.isEmpty() ? img.getSize() : { width: 0, height: 0 };
        if (size.width > 0 && (size.width !== width || size.height !== height)) {
          // Offscreen rendering draws at the display's scale factor on some machines: same aspect,
          // more pixels. Resample to the exact design size; a different aspect is the wrong surface.
          if (Math.abs(size.width / size.height - width / height) <= 0.01) img = img.resize({ width, height, quality: 'best' });
          else {
            return { success: false, code: 'FAILED', message: `offscreen capture: the image came back ${size.width}x${size.height}, not the shape of ${width}x${height}` };
          }
        }
        const uniform = !img || img.isEmpty() || isUniformBitmap(img.toBitmap(), width, height);
        if (!uniform) {
          return {
            success: true,
            image: img.toDataURL(),
            width,
            height,
            offscreen: true,
            settled,
            message:
              `captured offscreen: a fresh load of the preview laid out at ${width}x${height} in a hidden window` +
              (settled ? '' : ' (the page was still changing when the time ran out)') +
              ' — it shows the game as it starts, not the state the preview pane is in'
          };
        }
        if (Date.now() + 500 > deadline) {
          return { success: false, code: 'BLANK_CAPTURE', message: `offscreen capture: the game painted a single colour at ${width}x${height} — nothing rendered within ${timeoutMs} ms` };
        }
        await sleep(500);
      }
    } catch (e) {
      return { success: false, code: 'FAILED', message: `offscreen capture failed: ${e && e.message ? e.message : e}` };
    } finally {
      try { if (win && !win.isDestroyed()) win.destroy(); } catch { /* already gone */ }
    }
  })();
  inFlight = run;
  try {
    return await run;
  } finally {
    inFlight = null;
  }
}

/**
 * What a capture window may tell the editor: only what it needs to receive the project (its node
 * library, the module list). Its warnings, console, selection, metadata and eval results would be
 * mistaken for the user's preview, so the relay drops them.
 */
const CAPTURE_VIEWER_CMDS = new Set(['nodelibrary', 'nodelibraryOffer', 'getXgeniaModules']);

function captureMayRelay(request) {
  return !!request && CAPTURE_VIEWER_CMDS.has(request.cmd);
}

module.exports = {
  captureDesignOffscreen,
  isCaptureUserAgent,
  captureMayRelay,
  isSettled,
  isUniformBitmap,
  CAPTURE_UA_TAG,
  CAPTURE_PARTITION,
  STATE_JS
};
