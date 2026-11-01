import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultPreviewSize } from '../../src/editor/src/views/documents/EditorDocument/defaultPreviewSize';

test('a never-dragged split opens game-first on the simple layout, half and half otherwise', () => {
  assert.equal(defaultPreviewSize(1000, true, false), 850); // simple: graph is a 150px strip
  assert.equal(defaultPreviewSize(1000, true, true), 500);
  assert.equal(defaultPreviewSize(400, true, false), 343); // never smaller than the old default
  assert.equal(defaultPreviewSize(undefined, true, false), undefined); // not measured yet
  assert.equal(defaultPreviewSize(1000, false, false), undefined); // side-by-side keeps its own default
});
