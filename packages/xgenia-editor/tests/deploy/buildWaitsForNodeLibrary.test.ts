import { test } from 'node:test';
import assert from 'node:assert/strict';

import { browserLibraryLoaded, waitForBrowserNodeLibrary } from '../../src/editor/src/utils/compilation/nodeLibraryReady';

// 2026-11-02: a publish run seconds after the project opened, before the preview viewer had sent its
// node library, exported every component with `roots: []` and shipped a blank page.

test('the browser library counts as loaded once the core visual type is known', () => {
  assert.equal(browserLibraryLoaded((n) => n === 'Group'), true);
  // Only the cloud runtime's types: what the editor held with the preview disconnected.
  assert.equal(browserLibraryLoaded((n) => n === 'JavaScriptFunction'), false);
});

test('a build waits for the preview to send the library, then goes ahead', async () => {
  let loaded = false;
  let slept = 0;
  await waitForBrowserNodeLibrary((n) => loaded && n === 'Group', {
    timeoutMs: 10_000,
    sleep: async () => {
      slept++;
      if (slept === 3) loaded = true;
    }
  });
  assert.equal(slept, 3);
});

test('a build with no library fails in plain words instead of publishing a blank page', async () => {
  await assert.rejects(
    waitForBrowserNodeLibrary(() => false, { timeoutMs: 0, sleep: async () => {} }),
    /preview is not connected[\s\S]*blank page/
  );
});
