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
 * What one image pixel is worth in CSS pixels, and how much of the buffer the page actually fills.
 *
 * (2026-09-06) The returned `scale` was `imageBuffer.width / cssWidth`, and every caller is told —
 * by this server's own tool description — to convert coordinates through it before handing them to
 * `page.mouse`. On the live editor it reported **1.2503 when the true value was exactly 1.0**, so
 * every converted coordinate landed 25% too far right and down.
 *
 * The buffer is not the page. Electron runs the editor at `zoomFactor` 0.8, which makes
 * `devicePixelRatio` 1.6 while the capture surface is still allocated at the display's backing
 * scale of 2. Playwright's `scale: 'css'` then divides the whole 3420px surface by 1.6 and returns
 * 2138px — of which the page occupies the first 1710, exactly one image pixel per CSS pixel, and
 * the remaining 20% is blank. Measured on the live editor, every capture path (Playwright css and
 * device scale, raw CDP at three clip scales) showed the same 20% margin: it is `1 - zoomFactor`,
 * not an artefact of one option.
 *
 * So the one number worth measuring is `ratio = bufferWidth / cssWidth`, which is `1 / zoomFactor`:
 *
 *   ratio >= 1  (zoomed OUT, or no zoom) — the page is rendered at 1 image px per CSS px into a
 *               larger buffer. scale is 1, and the right/bottom margin is blank padding.
 *   ratio <  1  (zoomed IN) — the page needs MORE device pixels than the surface has, so it is
 *               cut off rather than padded. scale is the ratio, and part of the page is missing
 *               from the image entirely, which a caller needs to be told rather than left to
 *               discover by clicking somewhere that is not there.
 */
export function analyseCapture(
  cssSize: { width: number; height: number },
  imageSize: { width: number; height: number } | null
): {
  scale: number | null;
  contentSize: { width: number; height: number } | null;
  padded: boolean;
  cropped: boolean;
} {
  if (!imageSize || !cssSize?.width || !cssSize?.height) {
    return { scale: null, contentSize: null, padded: false, cropped: false };
  }
  const ratio = imageSize.width / cssSize.width;
  // A hair either side of 1 is rounding on a fractional CSS width, not zoom.
  if (ratio >= 0.999) {
    return {
      scale: 1,
      contentSize: { width: cssSize.width, height: cssSize.height },
      padded: ratio > 1.001,
      cropped: false,
    };
  }
  return {
    scale: ratio,
    contentSize: { width: imageSize.width, height: imageSize.height },
    padded: false,
    cropped: true,
  };
}

/**
 * Capture the editor, or one region of it.
 *
 * `scale: 'css'` is used because the device-scale capture is 1.6x larger in
 * bytes for no extra legibility. See analyseCapture for why the returned `scale`
 * cannot be read off the buffer's width.
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
  const regionCss = clip ? { width: clip.width, height: clip.height } : cssSize;
  const geometry = analyseCapture(regionCss, measured);

  return {
    image: buffer.toString('base64'),
    mimeType: format === 'jpeg' ? 'image/jpeg' : 'image/png',
    region,
    cssSize: regionCss,
    imageSize: measured,
    scale: geometry.scale,
    // Where the page actually is inside the buffer. Anchored top-left; anything outside it is
    // blank padding, not part of the editor.
    contentSize: geometry.contentSize,
    ...(geometry.padded
      ? { note: 'The buffer is larger than the page: everything right of contentSize.width or below contentSize.height is blank padding from the Electron zoom factor, not editor UI.' }
      : {}),
    ...(geometry.cropped
      ? { note: 'The editor is zoomed IN past what the capture surface holds, so the right/bottom of the page is MISSING from this image. Coordinates inside it are still valid through scale.' }
      : {}),
    bytes: buffer.length
  };
}
