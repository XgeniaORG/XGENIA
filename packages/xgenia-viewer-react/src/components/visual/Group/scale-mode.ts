/**
 * ONE scale-mode vocabulary for every scaler in XGENIA.
 *
 * A Group's Scale Mode (`uiScaleMode`) and a pixi.Stage's Scale Mode (`fitMode`) do the same
 * job on different trees: map a DESIGN BOX (Design Width × Design Height) onto whatever box the
 * layout actually gives the node. Until 2026-11 each had its own list, and the same word meant
 * different things — Group's "Fit" was Unity's Expand, Stage's "Fit" was a letterbox — which is
 * how a user ends up with three scalers on one screen and none of them doing what the label said.
 *
 * This file is the single definition. group.js reads the enum from here; the private pixi.Stage
 * keeps a byte-identical copy (private/xgenia-pro-nodes/src/utils/scale-modes.js) that a private
 * test holds equal to this one. The AI reads the same list in docs/ui-scaling.md.
 *
 * The seven modes, in the words of the engines people already know:
 *
 *   key          label          Unity CanvasScaler           Godot stretch aspect   CSS
 *   none         Off            Constant Pixel Size          disabled               —
 *   fit          Fit            —  (Shrink + exact canvas)   keep                   contain
 *   fill         Fill           Shrink                       —                      cover
 *   expand       Expand         Expand                       expand                 —
 *   matchWidth   Match Width    Match = 0 (width)            keep_width             —
 *   matchHeight  Match Height   Match = 1 (height)           keep_height            —
 *   stretch      Stretch        —                            ignore                 fill
 *
 * Fit, Fill, Expand, Match Width and Match Height are all UNIFORM: one factor, both axes.
 * The difference is only (a) which factor and (b) how big the canvas is in design units:
 *
 *   mode         factor                  canvas (design units)    what you see
 *   fit          min(bw/dw, bh/dh)       dw × dh                  everything, bars on one axis
 *   expand       min(bw/dw, bh/dh)       box / factor             everything, extra room instead of bars
 *   fill         max(bw/dw, bh/dh)       box / factor             box covered, overflow cropped
 *   matchWidth   bw / dw                 box / factor             width exact, height gets room or crops
 *   matchHeight  bh / dh                 box / factor             height exact, width gets room or crops
 *   stretch      (bw/dw, bh/dh)          dw × dh                  box filled exactly, shapes distort
 *
 * "box / factor" is what makes anchors work: a child anchored bottom-right sits on the REAL
 * bottom-right at every aspect ratio, because the canvas it is anchored in covers the box
 * exactly. `fit` is the one deliberate exception, for art that must never gain extra space.
 */

export type ScaleMode = 'none' | 'fit' | 'fill' | 'expand' | 'matchWidth' | 'matchHeight' | 'stretch';

export const SCALE_MODES: readonly ScaleMode[] = ['none', 'fit', 'fill', 'expand', 'matchWidth', 'matchHeight', 'stretch'];

/**
 * Older spellings, still accepted everywhere a mode is set and still readable in saved projects.
 * Group stored `letterbox` and `shrink` before the vocabularies were unified; `contain`/`cover`
 * are the CSS words an AI reaches for when it is thinking of object-fit.
 */
export const SCALE_MODE_ALIASES: Readonly<Record<string, ScaleMode>> = {
  letterbox: 'fit',
  contain: 'fit',
  shrink: 'fill',
  cover: 'fill'
};

/** The dropdown, in the order the panel shows it. Same list on Group and on pixi.Stage. */
export const SCALE_MODE_ENUMS: ReadonlyArray<{ value: ScaleMode; label: string }> = [
  { value: 'none', label: 'Off — 1:1 pixels, no scaling' },
  { value: 'fit', label: 'Fit — show everything, bars if the aspect differs' },
  { value: 'fill', label: 'Fill — cover the box, crop the edges' },
  { value: 'expand', label: 'Expand — show everything, extra room instead of bars' },
  { value: 'matchWidth', label: 'Match Width — scale by width, height follows' },
  { value: 'matchHeight', label: 'Match Height — scale by height, width follows' },
  { value: 'stretch', label: 'Stretch — fill the box exactly, distorts' }
];

/** Canonical key for any spelling; anything unknown (including empty) is `none`. */
export function normalizeScaleMode(value: unknown): ScaleMode {
  if (typeof value !== 'string') return 'none';
  const v = value.trim();
  if ((SCALE_MODES as readonly string[]).includes(v)) return v as ScaleMode;
  const alias = SCALE_MODE_ALIASES[v];
  return alias || 'none';
}

/** True for the modes that keep a bar-free box — everything except Off and Fit. */
export function scaleModeCoversBox(mode: ScaleMode): boolean {
  return mode !== 'none' && mode !== 'fit';
}

export interface ScaleLayout {
  /** Horizontal factor applied to the design box. */
  scaleX: number;
  /** Vertical factor; equal to scaleX for every mode but `stretch`. */
  scaleY: number;
  /** The box children lay out in, in DESIGN units. */
  canvasW: number;
  canvasH: number;
}

/**
 * Map a design box onto a real box. Returns null when the mode is Off or either box is not
 * measurable, so a caller renders exactly what it would without a scaler.
 */
export function computeScaleLayout(
  modeValue: unknown,
  box: { width: number; height: number },
  designWidth: number,
  designHeight: number
): ScaleLayout | null {
  const mode = normalizeScaleMode(modeValue);
  if (mode === 'none') return null;
  if (!(box.width > 0) || !(box.height > 0) || !(designWidth > 0) || !(designHeight > 0)) return null;

  const sx = box.width / designWidth;
  const sy = box.height / designHeight;
  if (!isFinite(sx) || !isFinite(sy)) return null;

  if (mode === 'stretch') {
    return { scaleX: sx, scaleY: sy, canvasW: designWidth, canvasH: designHeight };
  }

  let scale: number;
  switch (mode) {
    case 'fill': scale = Math.max(sx, sy); break;
    case 'matchWidth': scale = sx; break;
    case 'matchHeight': scale = sy; break;
    case 'fit':
    case 'expand':
    default: scale = Math.min(sx, sy); break;
  }
  if (!isFinite(scale) || scale <= 0) return null;

  if (mode === 'fit') return { scaleX: scale, scaleY: scale, canvasW: designWidth, canvasH: designHeight };
  // NOTE: the private engine-layout-semantics drift test greps the built viewer for the exact
  // text `canvasW: box.width / scale`. Keep it verbatim.
  return { scaleX: scale, scaleY: scale, canvasW: box.width / scale, canvasH: box.height / scale };
}
