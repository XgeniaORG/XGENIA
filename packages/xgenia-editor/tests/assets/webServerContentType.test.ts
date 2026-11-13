import { test } from 'node:test';
import assert from 'node:assert/strict';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { contentTypeForUrl } = require('../../src/main/src/content-type');

// (2026-09-17, user report) Clicking a previous version opened
// http://localhost:8574/.trash/…png?v=1789648682552 and showed no image: the extension was read
// off the WHOLE url, `?v=…` included, so it matched nothing and the PNG went out as text/html.
// Thumbnails hid it — an <img> sniffs the bytes — but a browser tab renders what it is told.
test('a cache-busting query or hash never changes the type', () => {
  assert.equal(contentTypeForUrl('/.trash/a.2026-09-17T11-49-21-427Z.png?v=1789648682552'), 'image/png');
  assert.equal(contentTypeForUrl('/assets/ui/b.webm#t=2'), 'video/webm');
  assert.equal(contentTypeForUrl('/assets/ui/c.png'), 'image/png');
});

test('extensions match regardless of case, and percent-encoded names still resolve', () => {
  assert.equal(contentTypeForUrl('/assets/UI/Hero.PNG'), 'image/png');
  assert.equal(contentTypeForUrl('/assets/ui/spin%20button.png?v=2'), 'image/png');
});

test('unknown and extensionless paths keep the historical html default', () => {
  assert.equal(contentTypeForUrl('/'), 'text/html');
  assert.equal(contentTypeForUrl('/viewer?x=1.png'), 'text/html');
});
