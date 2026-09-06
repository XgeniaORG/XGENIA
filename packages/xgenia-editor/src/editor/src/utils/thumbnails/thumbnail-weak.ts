/**
 * thumbnail-weak.ts — telling cover art apart from a photograph of nothing.
 *
 * The 20-second capture in `UseCaptureThumbnails` photographs whatever the editor happened to be
 * showing. For a game that has been built that is key art; for a project someone opened once and
 * abandoned it is a white rectangle, and for one whose author was on a config screen it is a form.
 * On a real profile those sit in the grid at exactly the same weight as a finished slot cabinet,
 * which is most of why the old screen was hard to read.
 *
 * A card whose art says nothing is better off showing a monogram: it is honest about being empty,
 * and it stops a blank tile from reading as a broken one.
 *
 * The decision and the measurement are separate on purpose. `isWeakCapture` is arithmetic over
 * numbers and is tested directly; `measureImage` is the DOM half that produces those numbers.
 */

export interface ImageStats {
  /** Mean luminance, 0 (black) to 1 (white). */
  luminance: number;
  /** Standard deviation of luminance, 0 (flat) to ~0.5 (high contrast). */
  variance: number;
}

/**
 * Thresholds, named so the numbers are arguable rather than magic.
 *
 * Derived by measuring the 24 thumbnails on the development profile: real key art landed at
 * variance 0.17-0.31, the blank-canvas captures at 0.00-0.04, and the two "Hello World" captures
 * at luminance 0.97 with variance 0.05.
 */
export const WEAK_VARIANCE_MAX = 0.06;
export const WEAK_LUMINANCE_LIGHT = 0.93;
export const WEAK_LUMINANCE_DARK = 0.04;

/**
 * Whether a capture is too empty to be worth showing.
 *
 * Three ways to be empty: almost no variation at all, near-white, or near-black. The variance
 * test carries most of it — a screenshot of a form is bright but busy, so luminance alone would
 * throw away perfectly informative captures.
 */
export function isWeakCapture(stats: ImageStats | null | undefined): boolean {
  if (!stats) return false; // Not measured yet is not the same as measured and empty.

  if (stats.variance <= WEAK_VARIANCE_MAX) return true;
  if (stats.luminance >= WEAK_LUMINANCE_LIGHT) return true;
  if (stats.luminance <= WEAK_LUMINANCE_DARK) return true;

  return false;
}

/**
 * Two initials for the monogram that replaces a weak capture.
 *
 * Words first, so "Neon Reels" gives NR. A single word gives its first two letters, which is why
 * `sdsds` reads as "Sd" rather than as one lonely S. Digits count as letters — plenty of these
 * games are called things like "777 Test".
 */
export function monogramFor(name: string): string {
  const words = String(name || '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!words.length) return '?';

  if (words.length === 1) {
    const w = words[0];
    return (w.length === 1 ? w[0] : w.slice(0, 2)).replace(/^./, (c) => c.toUpperCase());
  }

  return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * A stable hue for the monogram plate, derived from the name.
 *
 * Two empty projects side by side should not be the same rectangle twice. This is the only
 * colour in the lobby not sampled from artwork, so it is kept in the same violet-to-teal arc the
 * ambient backdrop already uses rather than being free-running rainbow.
 */
export function monogramHue(name: string): number {
  let hash = 0;
  const s = String(name || '');
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0;

  // 160°-280°: teal through blue to violet.
  return 160 + (Math.abs(hash) % 121);
}

/**
 * Measure an image URL on a small offscreen canvas.
 *
 * 32x32 is deliberate: the question is "is there anything here", and downsampling to a thumbnail
 * of a thumbnail answers it for a fraction of the pixels. Resolves null on any failure — a
 * measurement that did not happen must never be mistaken for a measurement that came back empty,
 * because `isWeakCapture(null)` is false and the art shows as normal.
 */
export function measureImage(src: string): Promise<ImageStats | null> {
  return new Promise((resolve) => {
    if (!src || typeof document === 'undefined') {
      resolve(null);
      return;
    }

    const img = new Image();
    // The thumbnails are file:// URLs from userData; nothing here is cross-origin, but a canvas
    // that gets tainted would throw on getImageData, so this stays defensive.
    img.crossOrigin = 'anonymous';

    img.onerror = () => resolve(null);
    img.onload = () => {
      try {
        const size = 32;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;

        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          resolve(null);
          return;
        }

        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);

        let sum = 0;
        let sumSq = 0;
        const n = size * size;

        for (let i = 0; i < data.length; i += 4) {
          // Rec. 601 luma. Perceptual weighting matters here: a saturated blue slot cabinet is
          // dark by luminance but is obviously not an empty capture, and flat weighting would
          // push it toward the near-black threshold.
          const l = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
          sum += l;
          sumSq += l * l;
        }

        const mean = sum / n;
        resolve({ luminance: mean, variance: Math.sqrt(Math.max(0, sumSq / n - mean * mean)) });
      } catch {
        resolve(null);
      }
    };

    img.src = src;
  });
}
