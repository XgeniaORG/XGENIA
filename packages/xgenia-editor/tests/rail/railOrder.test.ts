import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrangeRail, railCapacity, RAIL_SLOT } from '../../src/editor/src/views/Rail/railOrder';

const items = [
  { id: 'settings', name: 'Settings', order: 30, placement: 'bottom' as const },
  { id: 'components', name: 'Components', order: 20 },
  { id: 'chat-panel', name: 'Chat', order: 10 },
  { id: 'versioncontrol', name: 'Version control', order: 10, placement: 'bottom' as const },
  { id: 'search', name: 'Search', order: 30 },
  { id: 'assets', name: 'Assets', order: 40 },
  { id: 'zeta', name: 'Zeta', order: 40 },
  { id: 'alpha', name: 'Alpha', order: 40 }
];
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

test('placement splits clusters; order then name sorts within them', () => {
  const a = arrangeRail(items, [], 99);
  assert.deepEqual(ids(a.top), ['chat-panel', 'components', 'search', 'alpha', 'assets', 'zeta']);
  assert.deepEqual(ids(a.bottom), ['versioncontrol', 'settings']);
  assert.deepEqual(a.overflow, []);
});

test('user order wins for the ids it names; the rest follow by order', () => {
  const a = arrangeRail(items, ['search', 'assets'], 99);
  assert.deepEqual(ids(a.top), ['search', 'assets', 'chat-panel', 'components', 'alpha', 'zeta']);
});

test('user order ignores unknown ids and bottom ids', () => {
  const a = arrangeRail(items, ['ghost', 'settings', 'components'], 99);
  assert.deepEqual(ids(a.top), ['components', 'chat-panel', 'search', 'alpha', 'assets', 'zeta']);
  assert.deepEqual(ids(a.bottom), ['versioncontrol', 'settings']);
});

test('capacity moves the tail of the top cluster into overflow', () => {
  const a = arrangeRail(items, [], 3);
  assert.deepEqual(ids(a.top), ['chat-panel', 'components', 'search']);
  assert.deepEqual(ids(a.overflow), ['alpha', 'assets', 'zeta']);
  assert.deepEqual(ids(a.bottom), ['versioncontrol', 'settings']);
});

test('capacity 0 sends every top item to overflow', () => {
  const a = arrangeRail(items, [], 0);
  assert.deepEqual(a.top, []);
  assert.equal(a.overflow.length, 6);
});

test('missing order sorts after numbered items', () => {
  const a = arrangeRail([{ id: 'b', name: 'B' }, { id: 'a', name: 'A', order: 5 }], [], 9);
  assert.deepEqual(ids(a.top), ['a', 'b']);
});

test('railCapacity counts 38px slots between the identity block and the bottom cluster', () => {
  // identity block = 8 + 28 + 22 = 58; bottom = n*38 + 21 (border 1 + padding 10 + margin 10)
  assert.equal(RAIL_SLOT, 38);
  assert.equal(railCapacity(1125, 3), Math.floor((1125 - 58 - (3 * 38 + 21) + 10) / 38));
  assert.equal(railCapacity(300, 3), 3);
  assert.equal(railCapacity(100, 3), 0);
});
