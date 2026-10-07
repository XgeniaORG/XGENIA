import { test } from 'node:test';
import assert from 'node:assert/strict';

// (2026-10-07, tester report) The Deploy popup's "Backend: <game>" line kept the previous game after
// a switch in the Maths RGS panel, until the project was reopened: the panel and the AI's set_game
// wrote the key without telling anyone. Both now go through rgsClient.setActiveGame.
const store: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => (k in store ? store[k] : null),
  setItem: (k: string, v: string) => { store[k] = String(v); },
  removeItem: (k: string) => { delete store[k]; }
};

test('setActiveGame saves the game beside the other RGS settings and announces it', async () => {
  const { setActiveGame, getActiveGame } = await import('../../src/editor/src/utils/rgs/rgsClient');
  const { EventDispatcher } = await import('../../src/shared/utils/EventDispatcher');
  store.xgenia_rgs_settings = JSON.stringify({ apiKey: 'k', testSettings: { numSpins: 100000 } });
  const heard: any[] = [];
  const group = {};
  EventDispatcher.instance.on('rgs.gameSelected', (g: any) => heard.push(g), group);
  setActiveGame({ id: 'g2', slug: 'parrot', name: 'ParrotPlunder' } as any);
  EventDispatcher.instance.off(group);
  assert.deepEqual(heard.map((g) => g?.name), ['ParrotPlunder']);
  assert.equal(getActiveGame()?.id, 'g2');
  assert.equal(JSON.parse(store.xgenia_rgs_settings).apiKey, 'k');
  assert.equal(JSON.parse(store.xgenia_rgs_settings).testSettings.numSpins, 100000);
});
