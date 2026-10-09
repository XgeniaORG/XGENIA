import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDownscale, scaleSlice } from '../../src/editor/src/views/panels/AssetPanel/assetImagePlan';

test('downscale fits the longest side and keeps the aspect ratio', () => {
  assert.deepEqual(planDownscale(3000, 1500, 1024), { width: 1024, height: 512, scale: 1024 / 3000 });
  assert.deepEqual(planDownscale(1500, 3000, 1024), { width: 512, height: 1024, scale: 1024 / 3000 });
});

test('never upscales, and refuses nonsense', () => {
  assert.equal(planDownscale(800, 600, 1024), null);
  assert.equal(planDownscale(1024, 1024, 1024), null);
  assert.equal(planDownscale(0, 600, 512), null);
  assert.equal(planDownscale(800, 600, 0), null);
});

test('a tiny side never collapses to zero', () => {
  assert.deepEqual(planDownscale(4096, 3, 256), { width: 256, height: 1, scale: 256 / 4096 });
});

test('nine-slice borders scale with the pixels', () => {
  assert.deepEqual(scaleSlice({ left: 40, top: 20, right: 40, bottom: 21 }, 0.5), { left: 20, top: 10, right: 20, bottom: 11 });
  assert.equal(scaleSlice(undefined, 0.5), undefined);
});
