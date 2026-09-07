import { test } from 'node:test';
import assert from 'node:assert/strict';

/** Minimal localStorage so the persistence path is actually exercised under node. */
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

const storage = new MemoryStorage();
(globalThis as any).window = { localStorage: storage };

import {
  isGroupCollapsed,
  loadCollapsedGroups,
  saveCollapsedGroups,
  toggleGroup
} from '../../src/editor/src/views/panels/propertyeditor/inspector/model/groupCollapse';

test('toggle returns a new set and does not mutate the old one', () => {
  const before = new Set(['Style']);
  const after = toggleGroup(before, 'Layout');
  assert.deepEqual(Array.from(before).sort(), ['Style']);
  assert.deepEqual(Array.from(after).sort(), ['Layout', 'Style']);
  assert.deepEqual(Array.from(toggleGroup(after, 'Style')).sort(), ['Layout']);
});

test('round trips through storage', () => {
  saveCollapsedGroups(new Set(['Layout', 'Style']));
  assert.deepEqual(Array.from(loadCollapsedGroups()).sort(), ['Layout', 'Style']);
});

test('a corrupt stored value falls back to nothing collapsed', () => {
  // A half-written or hand-edited value must not leave the panel with every group shut.
  for (const junk of ['not json', '{"a":1}', '"Layout"', 'null', '42']) {
    storage.setItem('xgenia.inspector.collapsedGroups', junk);
    assert.deepEqual(Array.from(loadCollapsedGroups()), []);
  }
  // Non-string entries inside a valid array are dropped, the rest survives.
  storage.setItem('xgenia.inspector.collapsedGroups', '["Layout",3,null,"Style"]');
  assert.deepEqual(Array.from(loadCollapsedGroups()).sort(), ['Layout', 'Style']);
});

test('nothing is collapsed on a first-ever run', () => {
  storage.removeItem('xgenia.inspector.collapsedGroups');
  assert.deepEqual(Array.from(loadCollapsedGroups()), []);
});

test('a search or the changed filter force-opens collapsed groups', () => {
  const collapsed = new Set(['Style']);
  assert.equal(isGroupCollapsed(collapsed, 'Style', { isSearching: false, isFiltering: false }), true);
  // Reporting "1 result" above a shut header is the bug this prevents.
  assert.equal(isGroupCollapsed(collapsed, 'Style', { isSearching: true, isFiltering: false }), false);
  assert.equal(isGroupCollapsed(collapsed, 'Style', { isSearching: false, isFiltering: true }), false);
  // Forcing open does not rewrite what the user chose.
  assert.deepEqual(Array.from(collapsed), ['Style']);
  assert.equal(isGroupCollapsed(collapsed, 'Style', { isSearching: false, isFiltering: false }), true);
});
