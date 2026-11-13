import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureEncoding } from '../../src/editor/src/views/VisualCanvas/captureEncoding';

test('a motion frame may ask for JPEG at a quality', () => {
  assert.deepEqual(captureEncoding({ format: 'jpeg', quality: 70 }), { mime: 'image/jpeg', quality: 0.7 });
});

test('quality is clamped to a usable range, and defaults when missing', () => {
  assert.deepEqual(captureEncoding({ format: 'jpeg', quality: 5 }), { mime: 'image/jpeg', quality: 0.3 });
  assert.deepEqual(captureEncoding({ format: 'jpeg' }), { mime: 'image/jpeg', quality: 0.7 });
});

test('every existing caller (no options, or png) keeps the PNG it always got', () => {
  assert.deepEqual(captureEncoding(undefined), {});
  assert.deepEqual(captureEncoding({}), {});
  assert.deepEqual(captureEncoding({ format: 'png' }), {});
  assert.deepEqual(captureEncoding('jpeg'), {});
});
