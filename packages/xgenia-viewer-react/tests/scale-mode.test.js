// The one scale-mode vocabulary (src/components/visual/Group/scale-mode.ts). Group's uiScaleMode
// and pixi.Stage's fitMode both resolve through it, so these are the semantics a user gets from
// the word in the dropdown, whichever node they picked it on.
const {
  SCALE_MODES,
  SCALE_MODE_ENUMS,
  SCALE_MODE_ALIASES,
  normalizeScaleMode,
  computeScaleLayout,
  scaleModeCoversBox
} = require('../src/components/visual/Group/scale-mode');

const DESIGN = [1920, 1080];
const WIDE = { width: 2560, height: 1080 }; // wider than 16:9
const TALL = { width: 1080, height: 1920 }; // portrait

describe('the dropdown', () => {
  test('lists every mode once, in the order the panel shows, with a plain-word label', () => {
    expect(SCALE_MODE_ENUMS.map((e) => e.value)).toEqual([...SCALE_MODES]);
    expect(new Set(SCALE_MODES).size).toBe(SCALE_MODES.length);
    for (const e of SCALE_MODE_ENUMS) expect(e.label).toMatch(/^[A-Z][A-Za-z ]+ — /);
  });

  test('old spellings read as the new keys, and unknown values are Off', () => {
    expect(normalizeScaleMode('letterbox')).toBe('fit');
    expect(normalizeScaleMode('shrink')).toBe('fill');
    expect(normalizeScaleMode('contain')).toBe('fit');
    expect(normalizeScaleMode('cover')).toBe('fill');
    expect(normalizeScaleMode('expand')).toBe('expand');
    expect(normalizeScaleMode(undefined)).toBe('none');
    expect(normalizeScaleMode('')).toBe('none');
    expect(normalizeScaleMode('bogus')).toBe('none');
    for (const alias of Object.keys(SCALE_MODE_ALIASES)) expect(SCALE_MODES).not.toContain(alias);
  });
});

describe('the maths', () => {
  test('Off and an unmeasured box render as if there were no scaler', () => {
    expect(computeScaleLayout('none', WIDE, ...DESIGN)).toBeNull();
    expect(computeScaleLayout('fit', { width: 0, height: 0 }, ...DESIGN)).toBeNull();
    expect(computeScaleLayout('fit', WIDE, 0, 1080)).toBeNull();
  });

  test('Fit shows everything on a fixed canvas, so a wide window gets bars', () => {
    const l = computeScaleLayout('fit', WIDE, ...DESIGN);
    expect(l.scaleX).toBe(1); // 1080/1080 is the limiting axis
    expect(l.scaleY).toBe(1);
    expect([l.canvasW, l.canvasH]).toEqual(DESIGN); // canvas stays the design size → bars
  });

  test('Expand shows everything and gives the unmatched axis extra design room instead of bars', () => {
    const l = computeScaleLayout('expand', WIDE, ...DESIGN);
    expect(l.scaleX).toBe(1);
    expect([l.canvasW, l.canvasH]).toEqual([2560, 1080]); // box / scale covers the box exactly
    const t = computeScaleLayout('expand', TALL, ...DESIGN);
    expect(t.scaleX).toBeCloseTo(1080 / 1920);
    expect(t.canvasW).toBeCloseTo(1920);
    expect(t.canvasH).toBeCloseTo(1920 / (1080 / 1920));
  });

  test('Fill covers the box and crops the overflow', () => {
    const l = computeScaleLayout('fill', TALL, ...DESIGN);
    expect(l.scaleX).toBeCloseTo(1920 / 1080); // the LARGER factor
    expect(l.canvasW).toBeCloseTo(1080 / (1920 / 1080)); // narrower than the design → cropped
    expect(l.canvasH).toBeCloseTo(1080);
  });

  test('Match Width / Match Height take exactly one axis', () => {
    const w = computeScaleLayout('matchWidth', WIDE, ...DESIGN);
    expect(w.scaleX).toBeCloseTo(2560 / 1920);
    expect(w.canvasW).toBeCloseTo(1920);
    const h = computeScaleLayout('matchHeight', TALL, ...DESIGN);
    expect(h.scaleX).toBeCloseTo(1920 / 1080);
    expect(h.canvasH).toBeCloseTo(1080);
  });

  test('Stretch is the only mode with two factors, and keeps the design canvas', () => {
    const l = computeScaleLayout('stretch', WIDE, ...DESIGN);
    expect(l.scaleX).toBeCloseTo(2560 / 1920);
    expect(l.scaleY).toBe(1);
    expect([l.canvasW, l.canvasH]).toEqual(DESIGN);
    for (const mode of SCALE_MODES.filter((m) => m !== 'none' && m !== 'stretch')) {
      const u = computeScaleLayout(mode, WIDE, ...DESIGN);
      expect(u.scaleX).toBe(u.scaleY);
    }
  });

  test('the old spellings give the old behaviour', () => {
    expect(computeScaleLayout('letterbox', WIDE, ...DESIGN)).toEqual(computeScaleLayout('fit', WIDE, ...DESIGN));
    expect(computeScaleLayout('shrink', TALL, ...DESIGN)).toEqual(computeScaleLayout('fill', TALL, ...DESIGN));
  });

  test('every mode but Off and Fit leaves no bars', () => {
    expect(SCALE_MODES.filter(scaleModeCoversBox)).toEqual(['fill', 'expand', 'matchWidth', 'matchHeight', 'stretch']);
  });
});
