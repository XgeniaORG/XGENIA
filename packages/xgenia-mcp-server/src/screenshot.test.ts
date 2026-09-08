import { describe, it, expect } from 'vitest';
import { pngSize, jpegSize, imageSize, analyseCapture } from './screenshot.js';

// PNG: 8-byte signature, then IHDR length+type, then width/height big-endian.
function fakePng(w: number, h: number): Buffer {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12);
  buf.writeUInt32BE(w, 16);
  buf.writeUInt32BE(h, 20);
  return buf;
}

// JPEG: SOI, then an SOF0 segment carrying height then width.
function fakeJpeg(w: number, h: number): Buffer {
  const buf = Buffer.alloc(21);
  buf.writeUInt16BE(0xffd8, 0);
  buf.writeUInt16BE(0xffc0, 2);
  buf.writeUInt16BE(17, 4);
  buf.writeUInt8(8, 6);
  buf.writeUInt16BE(h, 7);
  buf.writeUInt16BE(w, 9);
  return buf;
}

describe('pngSize', () => {
  it('reads dimensions from the IHDR chunk', () => {
    expect(pngSize(fakePng(2138, 1406))).toEqual({ width: 2138, height: 1406 });
  });

  it('returns null for a non-PNG buffer', () => {
    expect(pngSize(Buffer.from('not an image'))).toBeNull();
  });

  it('returns null for a buffer with correct first 4 bytes but wrong PNG signature', () => {
    const buf = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xFF, 0xFF, 0xFF, 0xFF]).copy(buf, 0);
    buf.writeUInt32BE(13, 8);
    buf.write('IHDR', 12);
    buf.writeUInt32BE(100, 16);
    buf.writeUInt32BE(200, 20);
    expect(pngSize(buf)).toBeNull();
  });

  it('returns null for a valid PNG signature but non-IHDR chunk type', () => {
    const buf = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
    buf.writeUInt32BE(13, 8);
    buf.write('XXXX', 12);
    buf.writeUInt32BE(100, 16);
    buf.writeUInt32BE(200, 20);
    expect(pngSize(buf)).toBeNull();
  });
});

describe('jpegSize', () => {
  it('reads dimensions from the SOF0 segment', () => {
    expect(jpegSize(fakeJpeg(386, 1091))).toEqual({ width: 386, height: 1091 });
  });

  it('returns null for a non-JPEG buffer', () => {
    expect(jpegSize(Buffer.from('not an image'))).toBeNull();
  });

  it('skips fill bytes (0xFF padding) before SOF0', () => {
    // JPEG with fill bytes: SOI, then 0xFF 0xFF 0xFF (fill), then SOF0.
    const buf = Buffer.alloc(30);
    buf.writeUInt16BE(0xffd8, 0);
    buf.writeUInt8(0xff, 2);
    buf.writeUInt8(0xff, 3);
    buf.writeUInt8(0xff, 4);
    buf.writeUInt16BE(0xffc0, 5);
    buf.writeUInt16BE(17, 7);
    buf.writeUInt8(8, 9);
    buf.writeUInt16BE(456, 10);
    buf.writeUInt16BE(789, 12);
    expect(jpegSize(buf)).toEqual({ width: 789, height: 456 });
  });

  it('returns null for a buffer with only a standalone marker (RST)', () => {
    // JPEG with SOI, then only an RST marker (0xFF 0xD0), which has no length field.
    const buf = Buffer.alloc(10);
    buf.writeUInt16BE(0xffd8, 0);
    buf.writeUInt16BE(0xffd0, 2);
    expect(jpegSize(buf)).toBeNull();
  });
});

describe('imageSize', () => {
  it('dispatches on the magic bytes', () => {
    expect(imageSize(fakePng(10, 20))).toEqual({ width: 10, height: 20 });
    expect(imageSize(fakeJpeg(30, 40))).toEqual({ width: 30, height: 40 });
    expect(imageSize(Buffer.from('xx'))).toBeNull();
  });
});

/**
 * A SCALE NOBODY MEASURED AGAINST THE PAGE IS A COORDINATE BUG WAITING TO HAPPEN.
 *
 * (2026-09-06) `xgenia_screenshot` returned `scale: 1.2503` on the live editor. Its own tool
 * description tells every caller to convert coordinates through that number before handing them to
 * `page.mouse`. The true value was exactly **1.0**, so every converted coordinate landed 25% too
 * far right and down — and nothing about the image looks wrong enough to notice, so a click that
 * misses reads as "the selector moved".
 *
 * The cause: the buffer is not the page. Electron runs the editor at `zoomFactor` 0.8, so
 * `devicePixelRatio` is 1.6 while the capture surface is still allocated at the display's backing
 * scale of 2. Playwright's `scale: 'css'` divides the whole 3420px surface by 1.6 and hands back
 * 2138px, of which the editor occupies the first 1710 — one image pixel per CSS pixel — and the
 * last 20% is blank. `imageBuffer.width / cssWidth` measured that blank margin and called it zoom.
 *
 * The numbers below are the live measurements, not invented ones: viewport 1710x1125 CSS,
 * devicePixelRatio 1.6000000238, zoomFactor 0.8, buffer 2138x1406, content extent exactly
 * 1710x1125 confirmed pixel-by-pixel on the returned PNG.
 */

/** The live editor, 2026-09-06. */
const LIVE_CSS = { width: 1710, height: 1125 };
const LIVE_BUFFER = { width: 2138, height: 1406 };

describe('the zoomed-out editor that produced the wrong number', () => {
  const g = analyseCapture(LIVE_CSS, LIVE_BUFFER);

  it('reports the scale the page is really drawn at, not the buffer ratio', () => {
    expect(g.scale).toBe(1);
  });

  it('says where the page ends, so the blank 20% is not mistaken for editor UI', () => {
    expect(g.contentSize).toEqual({ width: 1710, height: 1125 });
    expect(g.padded).toBe(true);
    expect(g.cropped).toBe(false);
  });

  it('a coordinate read off the image needs no conversion at all here', () => {
    // The Publish button sits at CSS x 1629..1702. Through the OLD 1.2503 it became 2037..2128 —
    // past the right edge of the page, in the blank margin.
    const imageX = 1665;
    expect(imageX * (g.scale ?? 1)).toBe(1665);
  });
});

describe('a display with no zoom at all', () => {
  it('is the same answer, reached without a special case', () => {
    const g = analyseCapture({ width: 1440, height: 900 }, { width: 1440, height: 900 });
    expect(g.scale).toBe(1);
    expect(g.padded).toBe(false);
    expect(g.cropped).toBe(false);
  });
});

describe('a zoomed-IN editor loses page, and the caller has to be told', () => {
  // zoomFactor 1.25 → dpr 2.5 on a 2x display. The page needs more device pixels than the
  // surface has, so it is cut off rather than padded: buffer = css * (2 / 2.5) = css * 0.8.
  const g = analyseCapture({ width: 1000, height: 800 }, { width: 800, height: 640 });

  it('scales by what actually reached the image', () => {
    expect(g.scale).toBe(0.8);
  });

  it('and flags that the right and bottom of the page are simply absent', () => {
    expect(g.cropped).toBe(true);
    expect(g.padded).toBe(false);
    expect(g.contentSize).toEqual({ width: 800, height: 640 });
  });
});

describe('it never invents a number it does not have', () => {
  it.each([
    ['no image could be measured', LIVE_CSS, null],
    ['a zero-width region', { width: 0, height: 0 }, LIVE_BUFFER],
  ])('%s', (_label, css, image) => {
    const g = analyseCapture(css as any, image as any);
    expect(g.scale).toBeNull();
    expect(g.contentSize).toBeNull();
  });

  it('treats sub-pixel rounding on a fractional region as no zoom', () => {
    // Region clips come back fractional (the canvas measured 1260 x 704.013671875), so the ratio
    // lands a hair off 1. That is rounding, not a zoomed-in capture losing page.
    const g = analyseCapture({ width: 704.013671875, height: 704.013671875 }, { width: 704, height: 704 });
    expect(g.scale).toBe(1);
    expect(g.cropped).toBe(false);
  });
});
