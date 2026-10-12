import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lineageRectInRoot,
  resolvePlacement,
  toScreenPx,
  fromScreenPx,
  spriteDropParams,
  nineSliceDropParams,
  normalizePivot,
  normalizeSlice,
  isUnitRect,
  pieceRectInSource
} from '../../src/editor/src/views/panels/AssetPanel/assetPlacement';
import { describeAiSource } from '../../src/editor/src/views/panels/AssetPanel/assetAiInfo';
import { pickProjectScreen } from '../../src/editor/src/views/panels/AssetPanel/projectScreenPick';

const layout = (over: Partial<any> = {}): any => ({
  sourcePath: 'assets/keyart/key-art.png',
  rootPath: 'assets/keyart/key-art.png',
  box: { x: 0.044, y: 0.811, width: 0.042, height: 0.073 },
  boxInRoot: { x: 0.044, y: 0.811, width: 0.042, height: 0.073 },
  canvasInRoot: { x: 0.044, y: 0.811, width: 0.042, height: 0.073 },
  zIndex: 1,
  layerName: 'Minus Bet UI Button',
  depth: 1,
  ...over
});

test('a split record is fractions of the root: boxInRoot IS the placement', () => {
  assert.deepEqual(lineageRectInRoot(layout()), { x: 0.044, y: 0.811, width: 0.042, height: 0.073 });
});

test('a null canvasInRoot does not stop the piece knowing where it sits', () => {
  assert.deepEqual(lineageRectInRoot(layout({ canvasInRoot: null })), layout().boxInRoot);
});

test('a cropped layer is NOT drawn relative to its own canvas (it would fill the frame)', () => {
  // canvasInRoot === boxInRoot for a layer cropped to its art. Dividing by it gives 0,0,1,1.
  const r = lineageRectInRoot(layout())!;
  assert.notDeepEqual(r, { x: 0, y: 0, width: 1, height: 1 });
});

test('legacy pixel records resolve against their root canvas', () => {
  const r = lineageRectInRoot(
    layout({
      boxInRoot: { x: 100, y: 50, width: 200, height: 100 },
      canvasInRoot: { x: 0, y: 0, width: 1000, height: 500 }
    })
  );
  assert.deepEqual(r, { x: 0.1, y: 0.1, width: 0.2, height: 0.2 });
});

test('an unusable box is no placement, never a guessed rectangle', () => {
  assert.equal(lineageRectInRoot(layout({ boxInRoot: { x: 0, y: 0, width: 0, height: 0.2 } })), null);
  assert.equal(lineageRectInRoot(layout({ boxInRoot: null })), null);
  assert.equal(lineageRectInRoot(undefined), null);
});

test('authored placement beats split geometry', () => {
  const p = resolvePlacement({
    placement: { x: 0.5, y: 0.5, width: 0.1, height: 0.1 },
    lineage: layout()
  })!;
  assert.equal(p.source, 'authored');
  assert.deepEqual(p.rect, { x: 0.5, y: 0.5, width: 0.1, height: 0.1 });
});

test('split placement carries its layer name, z and root', () => {
  const p = resolvePlacement({ lineage: layout() })!;
  assert.equal(p.source, 'split');
  assert.equal(p.layerName, 'Minus Bet UI Button');
  assert.equal(p.zIndex, 1);
  assert.equal(p.rootPath, 'assets/keyart/key-art.png');
});

test('an invalid authored placement falls through to the split record', () => {
  const p = resolvePlacement({ placement: { x: 0, y: 0, width: -1, height: 1 } as any, lineage: layout() })!;
  assert.equal(p.source, 'split');
});

test('no geometry at all resolves to null', () => {
  assert.equal(resolvePlacement({}), null);
});

test('screen px round-trip', () => {
  const screen = { width: 1920, height: 1080 };
  const px = toScreenPx({ x: 0.25, y: 0.5, width: 0.5, height: 0.25 }, screen);
  assert.deepEqual(px, { x: 480, y: 540, width: 960, height: 270 });
  assert.deepEqual(fromScreenPx(px, screen), { x: 0.25, y: 0.5, width: 0.5, height: 0.25 });
});

test('sprite drop: anchor at the pivot, position at the pivot point on screen', () => {
  const placement = resolvePlacement({ placement: { x: 0.25, y: 0.5, width: 0.5, height: 0.25 } });
  const params = spriteDropParams(placement, { width: 1920, height: 1080 }, undefined);
  assert.deepEqual(params, { x: 960, y: 675, width: 960, height: 270, anchorX: 0.5, anchorY: 0.5 });

  const topLeft = spriteDropParams(placement, { width: 1920, height: 1080 }, { pivot: { x: 0, y: 0 } });
  assert.deepEqual(topLeft, { x: 480, y: 540, width: 960, height: 270, anchorX: 0, anchorY: 0 });
});

test('sprite drop without a screen or placement only carries the pivot', () => {
  const placement = resolvePlacement({ placement: { x: 0.25, y: 0.5, width: 0.5, height: 0.25 } });
  assert.deepEqual(spriteDropParams(placement, null, undefined), {});
  assert.deepEqual(spriteDropParams(null, { width: 1920, height: 1080 }, { pivot: { x: 0.5, y: 1 } }), {
    anchorX: 0.5,
    anchorY: 1
  });
});

test('nine-slice drop: top-left position and the four borders', () => {
  const placement = resolvePlacement({ placement: { x: 0.25, y: 0.5, width: 0.5, height: 0.25 } });
  const params = nineSliceDropParams(placement, { width: 1920, height: 1080 }, {
    slice: { left: 12, top: 8, right: 12, bottom: 8 }
  });
  assert.deepEqual(params, {
    x: 480,
    y: 540,
    width: 960,
    height: 270,
    leftWidth: 12,
    topHeight: 8,
    rightWidth: 12,
    bottomHeight: 8
  });
});

test('pivot and slice are normalized, never trusted raw', () => {
  assert.deepEqual(normalizePivot({ x: 2, y: -1 }), { x: 1, y: 0 });
  assert.equal(normalizePivot({ x: NaN, y: 0 } as any), undefined);
  assert.deepEqual(normalizeSlice({ left: 3.6, top: -2, right: 0, bottom: 0 }), { left: 4, top: 0, right: 0, bottom: 0 });
  assert.equal(normalizeSlice({ left: 0, top: 0, right: 0, bottom: 0 }), undefined);
});

test('isUnitRect rejects out-of-range and zero-area boxes', () => {
  assert.ok(isUnitRect({ x: 0, y: 0, width: 1, height: 1 }));
  assert.ok(!isUnitRect({ x: 0.9, y: 0, width: 0.5, height: 1 }));
  assert.ok(!isUnitRect({ x: 0, y: 0, width: 0, height: 1 }));
});

test('screen: the bible beats the pinned device; nothing declared is null, never a default', () => {
  assert.deepEqual(pickProjectScreen({ screen: { width: 1080, height: 1920 } }, { width: 390, height: 844 }), {
    width: 1080,
    height: 1920,
    source: 'bible'
  });
  assert.deepEqual(pickProjectScreen({}, { width: 390, height: 844 }), { width: 390, height: 844, source: 'pinned' });
  assert.equal(pickProjectScreen(null, { width: null, height: null, deviceName: null }), null);
});

test('a piece is drawn over its own source: root pieces as-is, deeper pieces against the source canvas', () => {
  const root = layout({ canvasInRoot: null });
  assert.deepEqual(pieceRectInSource(root, undefined), root.boxInRoot);

  const strip = layout({ boxInRoot: { x: 0, y: 0.8, width: 1, height: 0.2 }, canvasInRoot: { x: 0, y: 0.8, width: 1, height: 0.2 } });
  const button = layout({ depth: 2, sourcePath: 'assets/ui/strip.png', boxInRoot: { x: 0.5, y: 0.85, width: 0.1, height: 0.1 } });
  assert.deepEqual(pieceRectInSource(button, strip), { x: 0.5, y: 0.25, width: 0.1, height: 0.5 });

  assert.equal(pieceRectInSource(button, layout({ canvasInRoot: null })), null, 'unknown source canvas: no box, not a wrong one');
});

test('a legacy pixel record whose canvas is not the root is refused, not stretched to the screen', () => {
  const box = { x: 300, y: 200, width: 100, height: 50 };
  assert.equal(lineageRectInRoot(layout({ boxInRoot: box, canvasInRoot: box })), null);
});

test('AI source phrases', () => {
  assert.equal(describeAiSource({ source: 'layer-split' }), 'cut by a layer split');
  assert.equal(describeAiSource({ source: 'fal_img2img', prompt: 'x' }), 'AI edit');
  assert.equal(describeAiSource({ model: 'fal-ai/gpt-image-2/edit', prompt: 'x' }), 'AI edit');
  assert.equal(describeAiSource({ source: 'fal_generated', prompt: 'x' }), 'AI generated');
  assert.equal(describeAiSource(undefined), '');
});
