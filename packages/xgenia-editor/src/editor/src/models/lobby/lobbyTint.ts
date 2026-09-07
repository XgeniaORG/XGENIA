/**
 * lobbyTint.ts — the lobby takes its colour from whatever you opened last.
 *
 * The editor's ambient backdrop is three fixed radial gradients: a violet, a green and an amber
 * (see `styles/custom-properties/glass.css`). That is right for the editor, where the content is
 * a node graph. In the lobby the content is artwork, and a fixed violet wash behind a wall of
 * warm 777 cabinets looks like two designs stacked.
 *
 * So the ground is sampled from the hero's cover art. Someone whose last game was a Miami dusk
 * slot gets a violet room; someone whose last game was a fire-and-gold cabinet gets a warm one.
 * Same layout, same tokens, different light.
 *
 * The arithmetic is here and pure; the pixel sampling is the DOM half at the bottom. The clamp
 * is the important part: artwork is saturated, and an unclamped sample turns the page into a
 * lightbox that nothing else can be read against.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** How far a sampled colour may push the page. Above this the glass stops reading as glass. */
export const TINT_MAX_ALPHA = 0.22;

/** Fallback when there is no art to sample: the editor's own violet/green pair. */
export const DEFAULT_TINT: [Rgb, Rgb] = [
  { r: 120, g: 80, b: 200 },
  { r: 52, g: 211, b: 153 }
];

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Push a colour toward the saturation and lightness the backdrop can carry.
 *
 * Two failure modes to fix. A washed-out sample (a grey screenshot) produces a tint that reads
 * as dirt on the screen rather than as light, so saturation has a floor. A blown-out one (neon
 * on black) produces a glow bright enough to fight the cards, so lightness has a ceiling.
 */
export function conditionTint(rgb: Rgb): Rgb {
  const r = clamp(rgb.r, 0, 255) / 255;
  const g = clamp(rgb.g, 0, 255) / 255;
  const b = clamp(rgb.b, 0, 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;

  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  let s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));

  // Floor the saturation so a grey sample still reads as a deliberate colour, and ceiling the
  // lightness so a neon sample does not turn the page into a lamp.
  s = clamp(Math.max(s, 0.45), 0, 0.85);
  const targetL = clamp(l, 0.32, 0.6);

  return hslToRgb(h, s, targetL);
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  let rgb: [number, number, number];
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];

  return {
    r: Math.round((rgb[0] + m) * 255),
    g: Math.round((rgb[1] + m) * 255),
    b: Math.round((rgb[2] + m) * 255)
  };
}

/** `rgba(...)` at an alpha that can never exceed the clamp. */
export function tintColor(rgb: Rgb, alpha: number): string {
  const a = clamp(alpha, 0, TINT_MAX_ALPHA);
  return `rgba(${clamp(Math.round(rgb.r), 0, 255)}, ${clamp(Math.round(rgb.g), 0, 255)}, ${clamp(
    Math.round(rgb.b),
    0,
    255
  )}, ${Number(a.toFixed(3))})`;
}

/**
 * The backdrop, in the same three-gradient shape as `--ambient-backdrop`.
 *
 * Keeping the geometry identical to the editor's is what makes the two screens feel like one
 * room lit differently, rather than two different rooms.
 */
export function backdropFor(pair: [Rgb, Rgb] = DEFAULT_TINT): string {
  const [a, b] = [conditionTint(pair[0]), conditionTint(pair[1])];

  return [
    `radial-gradient(55% 40% at 22% 12%, ${tintColor(a, TINT_MAX_ALPHA)} 0%, ${tintColor(a, 0)} 70%)`,
    `radial-gradient(45% 35% at 80% 8%, ${tintColor(b, TINT_MAX_ALPHA * 0.5)} 0%, ${tintColor(b, 0)} 70%)`,
    `radial-gradient(60% 45% at 60% 100%, ${tintColor(a, TINT_MAX_ALPHA * 0.35)} 0%, ${tintColor(a, 0)} 70%)`
  ].join(', ');
}

/**
 * The two colours that best describe an image.
 *
 * Not a mean — averaging a picture gives mud, reliably. Pixels are bucketed into a coarse hue
 * histogram weighted by saturation, so a small area of vivid neon beats a large area of dark
 * background, which is what the eye does too. The second colour is picked at least 40° of hue
 * away from the first so the pair is a scheme rather than one colour twice.
 */
export function dominantPair(pixels: Uint8ClampedArray): [Rgb, Rgb] {
  const BUCKETS = 24;
  const weight = new Array<number>(BUCKETS).fill(0);
  const sums: Rgb[] = Array.from({ length: BUCKETS }, () => ({ r: 0, g: 0, b: 0 }));

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i] / 255;
    const g = pixels[i + 1] / 255;
    const b = pixels[i + 2] / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;

    // Near-greys carry no hue to bucket, and near-blacks are the background of most game art.
    if (d < 0.08 || max < 0.12) continue;

    let h = 0;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;

    const bucket = Math.min(BUCKETS - 1, Math.floor((h / 360) * BUCKETS));
    // Weight by saturation times value: vivid and bright beats dim and muddy.
    const w = d * max;

    weight[bucket] += w;
    sums[bucket].r += pixels[i] * w;
    sums[bucket].g += pixels[i + 1] * w;
    sums[bucket].b += pixels[i + 2] * w;
  }

  const ranked = weight
    .map((w, i) => ({ i, w }))
    .filter((x) => x.w > 0)
    .sort((a, b) => b.w - a.w);

  if (!ranked.length) return DEFAULT_TINT;

  const mean = (i: number): Rgb => ({
    r: sums[i].r / weight[i],
    g: sums[i].g / weight[i],
    b: sums[i].b / weight[i]
  });

  const first = ranked[0].i;
  const minDistance = Math.round((40 / 360) * BUCKETS);

  const second = ranked.find((x) => {
    const gap = Math.abs(x.i - first);
    return Math.min(gap, BUCKETS - gap) >= minDistance;
  });

  return [mean(first), second ? mean(second.i) : DEFAULT_TINT[1]];
}

/**
 * Sample an image URL down to its two dominant colours.
 *
 * Resolves the default pair on any failure. A tint is atmosphere; it must never be the reason a
 * projects list does not render.
 */
export function sampleTint(src: string): Promise<[Rgb, Rgb]> {
  return new Promise((resolve) => {
    if (!src || typeof document === 'undefined') {
      resolve(DEFAULT_TINT);
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onerror = () => resolve(DEFAULT_TINT);
    img.onload = () => {
      try {
        const size = 48;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;

        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          resolve(DEFAULT_TINT);
          return;
        }

        ctx.drawImage(img, 0, 0, size, size);
        resolve(dominantPair(ctx.getImageData(0, 0, size, size).data));
      } catch {
        resolve(DEFAULT_TINT);
      }
    };

    img.src = src;
  });
}
