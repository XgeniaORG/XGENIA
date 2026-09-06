import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampPanelWidth, snapPanelWidth, panelWidthKey, readPanelWidth, writePanelWidth,
  PANEL_WIDTH_MIN, PANEL_WIDTH_MAX
} from '../../src/editor/src/views/LeftPanelCard/panelWidth';

function memStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => (m.has(k) ? m.get(k)! : null), setItem: (k: string, v: string) => void m.set(k, v) };
}

test('clamp', () => {
  assert.equal(clampPanelWidth(10), PANEL_WIDTH_MIN);
  assert.equal(clampPanelWidth(9999), PANEL_WIDTH_MAX);
  assert.equal(clampPanelWidth(400.6), 401);
  assert.equal(clampPanelWidth(NaN), 380);
});

test('snap inside tolerance pulls to the stop, outside leaves it', () => {
  assert.equal(snapPanelWidth(388), 380);
  assert.equal(snapPanelWidth(372), 380);
  assert.equal(snapPanelWidth(393), 393);
  assert.equal(snapPanelWidth(455), 450);
  assert.equal(snapPanelWidth(500), 500);
});

test('storage round-trip per panel id', () => {
  const s = memStorage();
  assert.equal(panelWidthKey('chat-panel'), 'xgenia.leftPanel.width:chat-panel');
  assert.equal(readPanelWidth(s, 'chat-panel', 450), 450);
  writePanelWidth(s, 'chat-panel', 512);
  assert.equal(readPanelWidth(s, 'chat-panel', 450), 512);
  assert.equal(readPanelWidth(s, 'components', 380), 380);
});

test('garbage in storage falls back, null storage works in memory', () => {
  const s = memStorage();
  s.setItem(panelWidthKey('x'), 'banana');
  assert.equal(readPanelWidth(s, 'x', 380), 380);
  s.setItem(panelWidthKey('y'), '5000');
  assert.equal(readPanelWidth(s, 'y', 380), PANEL_WIDTH_MAX);
  assert.equal(readPanelWidth(null, 'z', 300), 300);
  assert.doesNotThrow(() => writePanelWidth(null, 'z', 300));
});
