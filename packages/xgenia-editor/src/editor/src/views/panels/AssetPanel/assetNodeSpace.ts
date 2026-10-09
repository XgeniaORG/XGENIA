// The coordinate space a node's x/y/width/height live in, for writing a placement into it. Pure.
//
// A placement is fractions of the target screen. Children of a pixi.Stage are authored in the
// stage's DESIGN box (its width/height, 800×600 by default); a pixi.Container adds its x/y. Anything
// that scales, rotates or pivots, or any ancestor this does not understand, is REFUSED with the
// reason — a wrong rectangle is worse than none (see keyart-nested-double-transform).

import { isUsableScreen, nineSliceDropParams, spriteDropParams, type AssetSpriteSettings, type ResolvedPlacement, type ScreenSize } from './assetPlacement';

export interface NodeLike {
  type?: { name?: string } | string;
  parameters?: Record<string, unknown>;
}

export interface NodeSpace {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  source: 'screen' | 'stage';
}

const STAGE_DEFAULT = { width: 800, height: 600 };
const typeName = (n: NodeLike) => (typeof n.type === 'string' ? n.type : n.type?.name) || '';
const param = (n: NodeLike, k: string) => n.parameters?.[k];

/** A number, or undefined when unset. Anything else (a '50%', an expression) is not computable. */
function num(v: unknown): number | undefined | null {
  if (v === undefined || v === null || v === '') return undefined;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

const NEUTRAL: Array<[string, number, string]> = [
  ['scaleX', 1, 'scaled'],
  ['scaleY', 1, 'scaled'],
  ['rotation', 0, 'rotated'],
  ['pivotX', 0, 'pivoted'],
  ['pivotY', 0, 'pivoted']
];

/** Why a transform makes x/y/width/height not mean what they say, or null when it is neutral. */
function transformRefusal(parameters: Record<string, unknown> | undefined): string | null {
  for (const [k, neutral, word] of NEUTRAL) {
    const v = num(parameters?.[k]);
    if (v === null || (v !== undefined && v !== neutral)) return word;
  }
  return null;
}

/**
 * @param ancestors nearest parent first, up to the component root. [] = the node sits at the root.
 */
export function resolveNodeSpace(ancestors: NodeLike[], screen: ScreenSize | null): NodeSpace | { refused: string } {
  let offsetX = 0;
  let offsetY = 0;
  for (const a of ancestors) {
    const t = typeName(a);
    if (t === 'pixi.Stage') {
      const w = num(param(a, 'width'));
      const h = num(param(a, 'height'));
      if (w === null || h === null) return { refused: 'the Stage design size is not a plain number' };
      const width = w ?? STAGE_DEFAULT.width;
      const height = h ?? STAGE_DEFAULT.height;
      if (isUsableScreen(screen) && Math.abs(width / height - screen.width / screen.height) > 0.02) {
        return {
          refused: `the Stage is authored at ${width}×${height} but the screen is ${screen.width}×${screen.height}, so a fraction of one is not a fraction of the other`
        };
      }
      return { width, height, offsetX, offsetY, source: 'stage' };
    }
    if (t === 'pixi.Container') {
      const x = num(param(a, 'x'));
      const y = num(param(a, 'y'));
      if (x === null || y === null) return { refused: 'a parent Container has a non-numeric position' };
      const t2 = transformRefusal(a.parameters);
      if (t2) return { refused: `a parent Container is ${t2}` };
      // An explicit Container size is applied by Pixi as a SCALE of its children.
      if (num(param(a, 'width')) !== undefined || num(param(a, 'height')) !== undefined) {
        return { refused: 'a parent Container has an explicit size, which scales its children' };
      }
      offsetX += x ?? 0;
      offsetY += y ?? 0;
      continue;
    }
    return { refused: `it sits inside a ${t || 'node'} whose coordinate space is not known` };
  }
  if (!isUsableScreen(screen)) return { refused: 'no target screen is declared' };
  return { width: screen.width, height: screen.height, offsetX, offsetY, source: 'screen' };
}

/** Parameters that put a node of `type` at `placement` within `space`. */
export function placementParamsForNode(
  type: string,
  placement: ResolvedPlacement,
  space: NodeSpace,
  sprite: AssetSpriteSettings | undefined,
  /** The target node's own parameters: its scale, rotation and pivot change what width and x mean. */
  own?: Record<string, unknown>
): { params: Record<string, number> } | { refused: string } {
  const ownTransform = transformRefusal(own);
  if (ownTransform) return { refused: `the node itself is ${ownTransform}` };
  const size = { width: space.width, height: space.height };
  let params: Record<string, number>;
  if (type === 'pixi.Sprite') params = spriteDropParams(placement, size, sprite);
  else if (type === 'pixi.NineSlicePlane') params = nineSliceDropParams(placement, size, sprite);
  else return { refused: `${type || 'this node'} has no x/y/width/height to place` };
  if (typeof params.x === 'number') params.x -= space.offsetX;
  if (typeof params.y === 'number') params.y -= space.offsetY;
  return { params };
}

/** Ancestors of a graph node, nearest first. */
export function ancestorsOf(node: any): NodeLike[] {
  const out: NodeLike[] = [];
  for (let p = node?.parent; p; p = p.parent) out.push(p);
  return out;
}
