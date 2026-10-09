// Where an asset belongs on the target screen, and how it becomes node parameters.
//
// Two sources, one answer. A split records each piece as FRACTIONS of the art it was cut from
// (`ai.layout`, promoted to `lineage`); key art is generated in the screen's shape, so a fraction
// of the root is a fraction of the screen. A person can also AUTHOR a placement, which wins. Every
// consumer — the inspector, the drop onto the canvas, recovery from a previous version — reads
// through resolvePlacement so they can never disagree about where a piece goes.
//
// Pure: no ProjectModel, no filesystem, so every rule is testable.

import type { AssetLineage } from './assetMeta';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A placement authored in the inspector: 0..1 fractions of the target screen. */
export type AssetPlacement = Rect;

/** Unity-style sprite import settings. The pivot is 0..1 of the image; slice borders are source px. */
export interface AssetSpriteSettings {
  pivot?: { x: number; y: number };
  slice?: { left: number; top: number; right: number; bottom: number };
}

export interface ScreenSize {
  width: number;
  height: number;
}

export interface ResolvedPlacement {
  source: 'authored' | 'split';
  /** 0..1 fractions of the screen / root art. */
  rect: Rect;
  rootPath?: string;
  layerName?: string | null;
  zIndex?: number | null;
}

// Split boxes come back in thousandths and are rounded; a piece touching the right edge can land a
// hair past 1.0. Rejecting that would throw away a real placement over rounding.
const EPS = 0.002;

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

function isRect(r: any): r is Rect {
  return !!r && finite(r.x) && finite(r.y) && finite(r.width) && finite(r.height);
}

/** A real 0..1 box with area. */
export function isUnitRect(r: any): r is Rect {
  return (
    isRect(r) &&
    r.width > 0 &&
    r.height > 0 &&
    r.x >= -EPS &&
    r.y >= -EPS &&
    r.x + r.width <= 1 + EPS &&
    r.y + r.height <= 1 + EPS
  );
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;

/**
 * The piece's rectangle as fractions of its ROOT art.
 *
 * `boxInRoot` is already that. It must NOT be divided by `canvasInRoot`: for a layer cropped to
 * its own art the canvas IS the box, and the division draws the piece filling the whole frame.
 * `canvasInRoot` may also be null (the canvas could not be measured) — that only limits children
 * cut from this piece, never this piece's own position.
 *
 * Records written before the fractions rule carried pixels; those resolve against their canvas
 * when it is a root-sized rectangle, and are refused otherwise.
 */
export function lineageRectInRoot(lineage: AssetLineage | null | undefined): Rect | null {
  if (!isRect(lineage?.boxInRoot)) return null;
  const box = lineage!.boxInRoot as Rect;
  if (box.width <= 0 || box.height <= 0) return null;
  // Not a type guard here on purpose: narrowing `box` through it leaves `never` below.
  if (isUnitRect(box as unknown)) return { x: box.x, y: box.y, width: box.width, height: box.height };

  if (!isRect(lineage?.canvasInRoot)) return null;
  const canvas = lineage!.canvasInRoot as Rect;
  // Only a root-sized canvas (anchored at the origin) is a frame the box can be read against.
  if (canvas.width <= 0 || canvas.height <= 0 || canvas.x !== 0 || canvas.y !== 0) return null;
  const r = {
    x: round4((box.x - canvas.x) / canvas.width),
    y: round4((box.y - canvas.y) / canvas.height),
    width: round4(box.width / canvas.width),
    height: round4(box.height / canvas.height)
  };
  return isUnitRect(r) ? r : null;
}

/** Authored placement, else split geometry, else null. */
export function resolvePlacement(entry: {
  placement?: AssetPlacement | null;
  lineage?: AssetLineage | null;
}): ResolvedPlacement | null {
  if (isUnitRect(entry.placement)) {
    const p = entry.placement;
    return { source: 'authored', rect: { x: p.x, y: p.y, width: p.width, height: p.height } };
  }
  const rect = lineageRectInRoot(entry.lineage);
  if (!rect) return null;
  return {
    source: 'split',
    rect,
    rootPath: entry.lineage?.rootPath,
    layerName: entry.lineage?.layerName ?? null,
    zIndex: entry.lineage?.zIndex ?? null
  };
}

export function isUsableScreen(s: any): s is ScreenSize {
  return !!s && finite(s.width) && finite(s.height) && s.width > 0 && s.height > 0;
}

export function toScreenPx(rect: Rect, screen: ScreenSize): Rect {
  return {
    x: Math.round(rect.x * screen.width),
    y: Math.round(rect.y * screen.height),
    width: Math.round(rect.width * screen.width),
    height: Math.round(rect.height * screen.height)
  };
}

export function fromScreenPx(px: Rect, screen: ScreenSize): Rect {
  return {
    x: round4(px.x / screen.width),
    y: round4(px.y / screen.height),
    width: round4(px.width / screen.width),
    height: round4(px.height / screen.height)
  };
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function normalizePivot(p: any): { x: number; y: number } | undefined {
  if (!p || !finite(p.x) || !finite(p.y)) return undefined;
  return { x: round4(clamp01(p.x)), y: round4(clamp01(p.y)) };
}

/** Whole non-negative pixels; all-zero means "no slicing" and is dropped. */
export function normalizeSlice(s: any): AssetSpriteSettings['slice'] | undefined {
  if (!s) return undefined;
  const px = (n: unknown) => (finite(n) ? Math.max(0, Math.round(n)) : 0);
  const out = { left: px(s.left), top: px(s.top), right: px(s.right), bottom: px(s.bottom) };
  return out.left + out.top + out.right + out.bottom > 0 ? out : undefined;
}

/**
 * Parameters for a `pixi.Sprite` spawned from this asset. The sprite's x/y is its ANCHOR point,
 * so the pivot decides both. With no usable placement or screen, only the pivot is carried —
 * a wrong rectangle is worse than none.
 */
export function spriteDropParams(
  placement: ResolvedPlacement | null,
  screen: ScreenSize | null,
  sprite: AssetSpriteSettings | undefined
): Record<string, number> {
  const pivot = normalizePivot(sprite?.pivot);
  const out: Record<string, number> = {};
  if (placement && isUsableScreen(screen)) {
    const a = pivot ?? { x: 0.5, y: 0.5 };
    const px = toScreenPx(placement.rect, screen);
    out.x = Math.round((placement.rect.x + placement.rect.width * a.x) * screen.width);
    out.y = Math.round((placement.rect.y + placement.rect.height * a.y) * screen.height);
    out.width = px.width;
    out.height = px.height;
    out.anchorX = a.x;
    out.anchorY = a.y;
  } else if (pivot) {
    out.anchorX = pivot.x;
    out.anchorY = pivot.y;
  }
  return out;
}

/** Parameters for a `pixi.NineSlicePlane`: top-left position (it has no anchor) and borders. */
export function nineSliceDropParams(
  placement: ResolvedPlacement | null,
  screen: ScreenSize | null,
  sprite: AssetSpriteSettings | undefined
): Record<string, number> {
  const out: Record<string, number> = {};
  if (placement && isUsableScreen(screen)) Object.assign(out, toScreenPx(placement.rect, screen));
  const slice = normalizeSlice(sprite?.slice);
  if (slice) {
    out.leftWidth = slice.left;
    out.topHeight = slice.top;
    out.rightWidth = slice.right;
    out.bottomHeight = slice.bottom;
  }
  return out;
}

/**
 * A piece's rectangle as fractions of the FILE it was cut from, for drawing it over that file.
 * A source with no lineage is the root. A source that is itself a cut piece is drawn in its own
 * canvas's coordinates; when that canvas was never measured there is no honest box to draw.
 */
export function pieceRectInSource(piece: AssetLineage, source: AssetLineage | null | undefined): Rect | null {
  const inRoot = lineageRectInRoot(piece);
  if (!inRoot) return null;
  if (!source) return inRoot;
  const c: any = source.canvasInRoot;
  if (!isUnitRect(c)) return null;
  const r = {
    x: round4((inRoot.x - c.x) / c.width),
    y: round4((inRoot.y - c.y) / c.height),
    width: round4(inRoot.width / c.width),
    height: round4(inRoot.height / c.height)
  };
  return isUnitRect(r) ? r : null;
}
