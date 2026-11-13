import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchStarters, starterSeed, starterUrl, STARTERS_BASE, type StarterEntry } from '../../src/editor/src/views/lobby/starters';

const STARTERS: StarterEntry[] = [
  { type: 'crash', name: 'Crash starter', file: 'crash-v1.zip', keywords: ['crash', 'cash out', 'cashout', 'rocket'] },
  { type: 'plinko', name: 'Plinko starter', file: 'plinko-v1.zip', keywords: ['plinko', 'pegs', 'ball drop'] },
  { type: 'slot', name: 'Slot starter', file: 'slot-v1.zip', keywords: ['slot', 'reels', 'spin', 'free spins'] }
];

test('the seed and URL the lobby uses', () => {
  assert.equal(starterSeed('slot', '  pirate slot  '), 'Make this slot game mine: pirate slot');
  assert.equal(starterUrl(STARTERS[0]), STARTERS_BASE + 'crash-v1.zip');
});

test('the manifest is read defensively: bad entries dropped, failures give an empty list', async () => {
  const ok = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
  const list = await fetchStarters(ok({ starters: [...STARTERS, { type: 'x', file: '../evil.zip', keywords: [] }, { type: 'y' }] }));
  assert.deepEqual(list.map((s) => s.type), ['crash', 'plinko', 'slot']);
  assert.deepEqual(await fetchStarters((async () => new Response('nope', { status: 500 })) as unknown as typeof fetch), []);
  assert.deepEqual(await fetchStarters((async () => { throw new Error('offline'); }) as unknown as typeof fetch), []);
});

import { starterTemplates, starterTypeOfUrl } from '../../src/editor/src/views/lobby/starters';

test('starters become New game tiles with their picture, and a tile URL names its kind', () => {
  const tiles = starterTemplates([{ ...STARTERS[0], thumbnail: '../x.jpg' }, { ...STARTERS[2], thumbnail: 'slot-v1.jpg', tagline: '5 reels, ready to play' }]);
  assert.deepEqual(tiles[0], { iconURL: STARTERS_BASE + 'slot-v1.jpg', title: 'Slot', desc: '5 reels, ready to play', category: 'Starters', projectURL: STARTERS_BASE + 'slot-v1.zip' });
  assert.equal(tiles[1].iconURL, ''); // a picture path that leaves the folder is not used
  assert.equal(starterTypeOfUrl(STARTERS_BASE + 'crash-v2.zip'), 'crash');
  assert.equal(starterTypeOfUrl('https://elsewhere/crash-v2.zip'), null);
  assert.equal(starterTypeOfUrl(undefined), null);
});
