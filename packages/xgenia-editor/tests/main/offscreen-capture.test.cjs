// The offscreen design capture (2026-11-12): a hidden window sized to the design, so the screenshot
// no longer depends on the editor's layout, focus or window size, or on the preview frame's guest.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../src/main/src/offscreen-capture');

function bitmap(w, h, fill, paint) {
  const buf = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) buf.set(fill, i * 4);
  if (paint) for (let y = paint.y; y < paint.y + paint.h; y++) for (let x = paint.x; x < paint.x + paint.w; x++) buf.set([200, 30, 30, 255], (y * w + x) * 4);
  return buf;
}

/** A BrowserWindow stand-in: the page reports `probe()` and paints `image()`. */
function fakeElectron({ probe, image, loadFails = false }) {
  const made = [];
  class BrowserWindow {
    constructor(opts) {
      this.opts = opts;
      this.destroyed = false;
      this.loaded = null;
      const self = this;
      this.webContents = {
        getUserAgent: () => 'Mozilla/5.0 Electron/44.7.2',
        setAudioMuted(v) { self.muted = v; },
        setFrameRate() {},
        executeJavaScript: async () => probe(self),
        capturePage: async () => image(self)
      };
      made.push(this);
    }
    setContentSize() {}
    async loadURL(url, o) {
      if (loadFails) throw new Error('ERR_CONNECTION_REFUSED');
      this.loaded = { url, ...o };
    }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
  }
  return { BrowserWindow, made };
}

function nativeImage(w, h, buf) {
  return {
    isEmpty: () => w === 0,
    getSize: () => ({ width: w, height: h }),
    toBitmap: () => buf,
    toDataURL: () => `data:image/png;base64,${w}x${h}`,
    resize: ({ width, height }) => nativeImage(width, height, bitmap(width, height, [0, 0, 0, 255], { x: 1, y: 1, w: 3, h: 3 }))
  };
}

const settledPage = () => ({ w: 64, h: 36, ready: 'complete', nodes: 40, cw: 64, ch: 36 });
const fast = { timeoutMs: 3000, minSettleMs: 0, pollMs: 5 };

test('a capture-window User-Agent is recognised, a normal one is not', () => {
  assert.equal(C.isCaptureUserAgent(`Mozilla/5.0 Electron/44 ${C.CAPTURE_UA_TAG}`), true);
  assert.equal(C.isCaptureUserAgent('Mozilla/5.0 Electron/44'), false);
  assert.equal(C.isCaptureUserAgent(undefined), false);
});

test('a capture window may only fetch the project through the relay', () => {
  for (const cmd of ['nodelibrary', 'nodelibraryOffer', 'getXgeniaModules']) assert.equal(C.captureMayRelay({ cmd }), true);
  for (const cmd of ['showwarning', 'viewerConsole', 'runtimeEvalResult', 'select', 'projectMetadata']) assert.equal(C.captureMayRelay({ cmd }), false);
});

test('settled = right viewport, complete, mounted, and unchanged over the last probes', () => {
  const s = settledPage();
  assert.equal(C.isSettled([s, s, s], 64, 36), true);
  assert.equal(C.isSettled([s, s], 64, 36), false);
  assert.equal(C.isSettled([s, s, { ...s, nodes: 41 }], 64, 36), false);
  assert.equal(C.isSettled([s, s, s].map((x) => ({ ...x, w: 0, h: 0 })), 64, 36), false);
  assert.equal(C.isSettled([s, s, s].map((x) => ({ ...x, ready: 'loading' })), 64, 36), false);
  // A canvas game mounts one element and little else (found on Electron 44: a 5-element page never settled).
  const canvasOnly = { ...s, nodes: 5 };
  assert.equal(C.isSettled([canvasOnly, canvasOnly, canvasOnly], 64, 36), true);
  const empty = { ...s, nodes: 5, cw: 0, ch: 0 };
  assert.equal(C.isSettled([empty, empty, empty], 64, 36), false);
});

test('a one-colour bitmap is uniform; one with a painted patch is not', () => {
  assert.equal(C.isUniformBitmap(bitmap(64, 36, [0, 0, 0, 255]), 64, 36), true);
  assert.equal(C.isUniformBitmap(bitmap(64, 36, [0, 0, 0, 255], { x: 10, y: 10, w: 20, h: 10 }), 64, 36), false);
});

test('captures at exactly the design size, muted, tagged, and closes the window', async () => {
  const fake = fakeElectron({ probe: settledPage, image: () => nativeImage(64, 36, bitmap(64, 36, [10, 10, 10, 255], { x: 5, y: 5, w: 10, h: 10 })) });
  const r = await C.captureDesignOffscreen({ url: 'http://localhost:8574/?t=1', width: 64, height: 36, ...fast }, fake);
  assert.equal(r.success, true, r.message);
  assert.equal(r.width, 64);
  assert.equal(r.height, 36);
  assert.equal(r.offscreen, true);
  assert.equal(r.settled, true);
  const w = fake.made[0];
  assert.equal(w.opts.show, false);
  assert.equal(w.opts.webPreferences.offscreen, true);
  assert.equal(w.opts.width, 64);
  assert.equal(w.muted, true);
  assert.ok(C.isCaptureUserAgent(w.loaded.userAgent));
  assert.equal(w.destroyed, true);
});

test('a high-density image of the same shape is resampled to the design size', async () => {
  const fake = fakeElectron({ probe: settledPage, image: () => nativeImage(128, 72, bitmap(128, 72, [10, 10, 10, 255], { x: 5, y: 5, w: 10, h: 10 })) });
  const r = await C.captureDesignOffscreen({ url: 'http://localhost:8574/', width: 64, height: 36, ...fast }, fake);
  assert.equal(r.success, true, r.message);
  assert.equal(r.width, 64);
});

test('a window that never reaches the size is GUEST_UNSIZED, with what it reports', async () => {
  const fake = fakeElectron({ probe: () => ({ ...settledPage(), w: 0, h: 0 }), image: () => nativeImage(64, 36, bitmap(64, 36, [0, 0, 0, 255])) });
  const r = await C.captureDesignOffscreen({ url: 'http://localhost:8574/', width: 64, height: 36, ...fast, timeoutMs: 150 }, fake);
  assert.equal(r.success, false);
  assert.equal(r.code, 'GUEST_UNSIZED');
  assert.match(r.message, /did not reach 64x36 \(it reports 0x0\)/);
  assert.equal(fake.made[0].destroyed, true);
});

test('a page that only ever paints one colour is BLANK_CAPTURE, never a black success', async () => {
  const fake = fakeElectron({ probe: settledPage, image: () => nativeImage(64, 36, bitmap(64, 36, [0, 0, 0, 255])) });
  const r = await C.captureDesignOffscreen({ url: 'http://localhost:8574/', width: 64, height: 36, ...fast, timeoutMs: 400 }, fake);
  assert.equal(r.success, false);
  assert.equal(r.code, 'BLANK_CAPTURE');
});

test('bad sizes, no URL and a failed load are refused without a crash', async () => {
  const fake = fakeElectron({ probe: settledPage, image: () => nativeImage(1, 1, bitmap(1, 1, [0, 0, 0, 255])) });
  assert.equal((await C.captureDesignOffscreen({ url: 'http://localhost:8574/', width: 0, height: 36 }, fake)).code, 'BAD_SIZE');
  assert.equal((await C.captureDesignOffscreen({ url: 'http://localhost:8574/', width: 9000, height: 36 }, fake)).code, 'BAD_SIZE');
  assert.equal((await C.captureDesignOffscreen({ url: '', width: 64, height: 36 }, fake)).code, 'LOAD_FAILED');
  const failing = fakeElectron({ probe: settledPage, image: () => null, loadFails: true });
  const r = await C.captureDesignOffscreen({ url: 'http://localhost:8574/', width: 64, height: 36, ...fast }, failing);
  assert.equal(r.code, 'LOAD_FAILED');
  assert.equal(failing.made[0].destroyed, true);
});

test('one capture at a time', async () => {
  const fake = fakeElectron({ probe: settledPage, image: () => nativeImage(64, 36, bitmap(64, 36, [10, 10, 10, 255], { x: 5, y: 5, w: 10, h: 10 })) });
  const a = C.captureDesignOffscreen({ url: 'http://localhost:8574/', width: 64, height: 36, ...fast, minSettleMs: 50 }, fake);
  const b = await C.captureDesignOffscreen({ url: 'http://localhost:8574/', width: 64, height: 36, ...fast }, fake);
  assert.equal(b.code, 'BUSY');
  assert.equal((await a).success, true);
});
