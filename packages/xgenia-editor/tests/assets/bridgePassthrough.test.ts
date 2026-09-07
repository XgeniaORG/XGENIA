import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const bridge = readFileSync(
  join(__dirname, '../../src/editor/src/views/panels/ChatPanelBridge/EditorBridge.ts'),
  'utf8'
);

const handler = () => {
  const start = bridge.indexOf("h('assetMeta.set'");
  assert.ok(start > 0, 'assetMeta.set handler not found');
  return bridge.slice(start, bridge.indexOf("h('assetMeta.migrate'"));
};

test('assetMeta.set merges the whole entry, not only .ai', () => {
  const body = handler();
  assert.ok(
    body.includes('mergeAssetMeta'),
    'handler must merge the full entry; recordAssetProvenance stores only entry.ai'
  );
  assert.ok(
    !/await recordAssetProvenance\(/.test(body),
    'handler must no longer route through the ai-only writer'
  );
});

test('assetMeta.set still emits project-assets-changed so the panel refreshes', () => {
  assert.ok(handler().includes("emit('project-assets-changed'"));
});
