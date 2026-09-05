import { describe, it, expect } from 'vitest';
import { pngSize, jpegSize, imageSize } from './screenshot.js';

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
});

describe('jpegSize', () => {
  it('reads dimensions from the SOF0 segment', () => {
    expect(jpegSize(fakeJpeg(386, 1091))).toEqual({ width: 386, height: 1091 });
  });

  it('returns null for a non-JPEG buffer', () => {
    expect(jpegSize(Buffer.from('not an image'))).toBeNull();
  });
});

describe('imageSize', () => {
  it('dispatches on the magic bytes', () => {
    expect(imageSize(fakePng(10, 20))).toEqual({ width: 10, height: 20 });
    expect(imageSize(fakeJpeg(30, 40))).toEqual({ width: 30, height: 40 });
    expect(imageSize(Buffer.from('xx'))).toBeNull();
  });
});
