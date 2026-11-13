// findPreviewFrame must pick the editor's preview, not another frame on the same origin.
// (2026-11-12) The Tools modal's iframe is served from localhost:8574 too; matching on origin alone
// took the LAST such frame, so with the modal open, script meant for the game ran in the modal.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findPreviewFrame, PREVIEW_FRAME_NAME } = require('../../src/main/src/preview-frame');

const ORIGIN = 'http://localhost:8574';
const frame = (url, name = '', detached = false) => ({ url, name, detached });
const sender = (frames) => {
  const root = { url: 'http://localhost:8080/index.html', name: '' };
  return { mainFrame: Object.assign(root, { framesInSubtree: [root, ...frames] }) };
};

test('the named preview wins over a newer same-origin frame (the Tools modal)', () => {
  const preview = frame(`${ORIGIN}/?t=1`, PREVIEW_FRAME_NAME);
  const tools = frame(`${ORIGIN}/tools/index.html`, 'tools');
  assert.equal(findPreviewFrame(sender([preview, tools]), ORIGIN), preview);
  assert.equal(findPreviewFrame(sender([tools, preview]), ORIGIN), preview);
});

test('during a reload the newest named preview is used, and a detached one never', () => {
  const old = frame(`${ORIGIN}/?t=1`, PREVIEW_FRAME_NAME);
  const fresh = frame(`${ORIGIN}/?t=2`, PREVIEW_FRAME_NAME);
  const gone = frame(`${ORIGIN}/?t=3`, PREVIEW_FRAME_NAME, true);
  assert.equal(findPreviewFrame(sender([old, fresh, gone]), ORIGIN), fresh);
});

test('a renderer that names no frame gets the old behaviour: the newest frame on the origin', () => {
  const a = frame(`${ORIGIN}/a`);
  const b = frame(`${ORIGIN}/b`);
  assert.equal(findPreviewFrame(sender([a, b]), ORIGIN), b);
});

test('other origins and no sender find nothing', () => {
  assert.equal(findPreviewFrame(sender([frame('https://chat.example.com/', PREVIEW_FRAME_NAME)]), ORIGIN), null);
  assert.equal(findPreviewFrame(null, ORIGIN), null);
});
