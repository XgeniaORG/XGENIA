import { connect } from './connection.js';
import { SELECTORS } from './selectors.js';

export function pngSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24) return null;
  // Verify full 8-byte PNG signature: 89 50 4E 47 0D 0A 1A 0A
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
  if (buf.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  // Verify IHDR chunk type at offset 12
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

export function jpegSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 4 || buf.readUInt16BE(0) !== 0xffd8) return null;
  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf.readUInt8(offset) !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buf.readUInt8(offset + 1);
    // Fill bytes: padding 0xFF 0xFF ... is legal before a marker.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // Standalone markers with no length field: RST0-RST7 (0xD0-0xD7), TEM (0x01), SOI (0xD8), EOI (0xD9).
    const isStandalone = marker === 0x01 || marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7);
    if (isStandalone) {
      offset += 2;
      continue;
    }
    // SOF0..SOF3 and SOF5..SOF15 carry the frame dimensions; the excluded
    // markers in that range are DHT (c4), JPG (c8) and DAC (cc).
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
    }
    const length = buf.readUInt16BE(offset + 2);
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

export function imageSize(buf: Buffer): { width: number; height: number } | null {
  return pngSize(buf) ?? jpegSize(buf);
}

/**
 * Capture the editor, or one region of it.
 *
 * `scale: 'css'` is used because the device-scale capture is 1.6x larger in
 * bytes for no extra legibility. The returned `scale` is measured from the
 * buffer rather than assumed: the editor runs at an Electron zoom factor, so the
 * ratio between image pixels and the CSS pixels that `page.mouse` expects is
 * neither 1 nor a fixed 2, and it moves when the user changes zoom.
 */
export async function screenshot(
  opts: { region?: 'full' | 'chat' | 'canvas'; format?: 'jpeg' | 'png' } = {}
) {
  const { page } = await connect();
  const region = opts.region ?? 'full';
  const format = opts.format ?? 'jpeg';

  const cssSize = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));

  let clip: { x: number; y: number; width: number; height: number } | undefined;
  if (region !== 'full') {
    const selector = region === 'chat' ? SELECTORS.chatIframe : SELECTORS.canvas;
    clip = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return undefined;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return undefined;
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }, selector);
    if (!clip) {
      return {
        error: 'selector-missing',
        tried: selector,
        hint: `No visible element for region '${region}'. Use region 'full', or run xgenia_probe.`
      };
    }
  }

  const buffer = await page.screenshot({
    scale: 'css',
    clip,
    type: format,
    ...(format === 'jpeg' ? { quality: 70 } : {})
  });

  const measured = imageSize(buffer);
  const referenceWidth = clip ? clip.width : cssSize.width;

  return {
    image: buffer.toString('base64'),
    mimeType: format === 'jpeg' ? 'image/jpeg' : 'image/png',
    region,
    cssSize: clip ? { width: clip.width, height: clip.height } : cssSize,
    imageSize: measured,
    scale: measured ? measured.width / referenceWidth : null,
    bytes: buffer.length
  };
}
