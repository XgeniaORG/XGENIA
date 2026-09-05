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
