import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  arrangeGroupedRail, dedupeRailIcons, isSimpleRailItem, railGroupFor, railLabelFor, railTopBudget, resolveShowAllTools,
  ADD_LABEL, MORE_LABEL, RAIL_ENTRIES, RAIL_SEPARATOR, RAIL_SLOT, SHOW_ALL_TOOLS_MIN_PROJECTS
} from '../../src/editor/src/views/Rail/railGroups';
import { railGuideId } from '../../src/editor/src/utils/guideIds';

type Item = { id: string; name: string; order?: number; placement?: 'top' | 'bottom' };

// The registrations as router.setup.ts makes them (ids, names, order, placement), plus the
// Character Studio web plugin. The `order` values are deliberately the old ones: the rail's
// groups and ranks, not registration order, decide where things go.
const PANELS: Item[] = [
  { id: 'components', name: 'Components', order: 20 },
  { id: 'hierarchy', name: 'Hierarchy', order: 21 },
  { id: 'history', name: 'History', order: 5, placement: 'bottom' },
  { id: 'search', name: 'Search', order: 30 },
  { id: 'versioncontrol', name: 'Version control', order: 10, placement: 'bottom' },
  { id: 'ChatPanel', name: 'Chat', order: 10 },
  { id: 'maths-panel', name: 'Maths RGS', order: 60 },
  { id: 'image-editor', name: 'AI Image Editor', order: 70 },
  { id: 'project-styles', name: 'Project Styles', order: 50 },
  { id: 'cloudservice', name: 'Cloud Services', order: 20, placement: 'bottom' },
  { id: 'cloud-functions', name: 'Cloud Functions', order: 65 },
  { id: 'settings', name: 'Settings', order: 30, placement: 'bottom' },
  { id: 'node-references', name: 'Node References', order: 80 },
  { id: 'assets', name: 'Assets', order: 40 },
  { id: 'web-plugin:character-studio', name: 'Character Studio', order: 72 }
];

const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
const labels = (xs: Item[]) => xs.map((x) => railLabelFor(x));
const groupLabels = (r: ReturnType<typeof arrangeGroupedRail<Item>>) => r.groups.map((g) => [g.id, labels(g.items)]);

test('every panel gets its short label', () => {
  const expected: Record<string, string> = {
    ChatPanel: 'AI',
    'chat-panel': 'AI',
    assets: 'Assets',
    'image-editor': 'Images',
    'web-plugin:character-studio': 'Characters',
    'project-styles': 'Styles',
    components: 'Parts',
    hierarchy: 'Layers',
    search: 'Search',
    'maths-panel': 'Maths',
    history: 'History',
    'cloud-functions': 'Server',
    'node-references': 'Where used',
    versioncontrol: 'Versions',
    cloudservice: 'Cloud',
    settings: 'Settings'
  };
  for (const [id, label] of Object.entries(expected)) assert.equal(railLabelFor({ id, name: 'Long name' }), label, id);
  assert.equal(Object.keys(RAIL_ENTRIES).length, Object.keys(expected).length);
  assert.equal(ADD_LABEL, 'Add');
  assert.equal(MORE_LABEL, 'More');
});

test('an unknown panel is labelled with its name; its own shortLabel wins over everything', () => {
  assert.equal(railLabelFor({ id: 'web-plugin:mystery', name: 'Mystery Tool' }), 'Mystery Tool');
  assert.equal(railLabelFor({ id: 'web-plugin:mystery', name: 'Mystery Tool', shortLabel: 'Mystery' }), 'Mystery');
  assert.equal(railLabelFor({ id: 'components', name: 'Components', shortLabel: 'Bits' }), 'Bits');
  assert.equal(railGroupFor('web-plugin:mystery'), 'other');
});

test('labels are short and no two rail items share one', () => {
  const shown = Object.entries(RAIL_ENTRIES).filter(([id]) => id !== 'chat-panel').map(([, e]) => e.label);
  for (const l of shown) assert.ok(l.length <= 10, `${l} is too long for the rail`);
  assert.equal(new Set([...shown, ADD_LABEL, MORE_LABEL]).size, shown.length + 2);
});

test('full rail: five groups in order, bottom cluster History, Versions, Cloud, Settings', () => {
  const r = arrangeGroupedRail(PANELS, [], { showAll: true });
  assert.deepEqual(groupLabels(r), [
    ['make', ['AI']],
    ['look', ['Assets', 'Images', 'Characters', 'Styles']],
    ['structure', ['Parts', 'Layers', 'Search']],
    ['game', ['Maths']],
    ['advanced', ['Server', 'Where used']]
  ]);
  assert.deepEqual(labels(r.bottom), ['History', 'Versions', 'Cloud', 'Settings']);
  assert.deepEqual(r.overflow, []);
  assert.equal(r.hasMore, false);
});

test('an unknown panel goes in a last "other" group, by order then name', () => {
  const extra: Item[] = [
    { id: 'web-plugin:zeta', name: 'Zeta', order: 72 },
    { id: 'web-plugin:alpha', name: 'Alpha', order: 72 },
    { id: 'web-plugin:first', name: 'First', order: 71 }
  ];
  const r = arrangeGroupedRail([...PANELS, ...extra], [], { showAll: true });
  assert.deepEqual(r.groups.at(-1), { id: 'other', items: [extra[2], extra[1], extra[0]] });
});

test('"make" stays even with no chat registered (it holds Add); other empty groups are dropped', () => {
  const r = arrangeGroupedRail(PANELS.filter((p) => p.id !== 'ChatPanel' && p.id !== 'maths-panel'), [], { showAll: true });
  assert.deepEqual(r.groups.map((g) => g.id), ['make', 'look', 'structure', 'advanced']);
  assert.deepEqual(r.groups[0].items, []);
});

test('simple rail: AI, Add, Assets, Images, Characters, Maths, History, Settings; the rest under More', () => {
  const r = arrangeGroupedRail(PANELS, [], { showAll: false });
  assert.deepEqual(groupLabels(r), [
    ['make', ['AI']],
    ['look', ['Assets', 'Images', 'Characters']],
    ['game', ['Maths']]
  ]);
  assert.deepEqual(labels(r.bottom), ['History', 'Settings']);
  // More lists them in rail order: top tools first, then bottom ones.
  assert.deepEqual(labels(r.overflow), ['Styles', 'Parts', 'Layers', 'Search', 'Server', 'Where used', 'Versions', 'Cloud']);
  assert.equal(r.hasMore, true);
  for (const id of ['ChatPanel', 'assets', 'image-editor', 'web-plugin:character-studio', 'maths-panel', 'history', 'settings']) {
    assert.ok(isSimpleRailItem(id), id);
  }
});

test('simple rail never hides the open panel, top or bottom', () => {
  const layers = arrangeGroupedRail(PANELS, [], { showAll: false, openId: 'hierarchy' });
  assert.deepEqual(groupLabels(layers), [
    ['make', ['AI']],
    ['look', ['Assets', 'Images', 'Characters']],
    ['structure', ['Layers']],
    ['game', ['Maths']]
  ]);
  assert.ok(!ids(layers.overflow).includes('hierarchy'));

  const versions = arrangeGroupedRail(PANELS, [], { showAll: false, openId: 'versioncontrol' });
  assert.deepEqual(labels(versions.bottom), ['History', 'Versions', 'Settings']);
  assert.ok(!ids(versions.overflow).includes('versioncontrol'));
});

test('an unknown panel is not on the simple rail unless it is open', () => {
  const plugin: Item = { id: 'web-plugin:mystery', name: 'Mystery', order: 72 };
  assert.ok(ids(arrangeGroupedRail([...PANELS, plugin], [], { showAll: false }).overflow).includes(plugin.id));
  const open = arrangeGroupedRail([...PANELS, plugin], [], { showAll: false, openId: plugin.id });
  assert.deepEqual(open.groups.at(-1), { id: 'other', items: [plugin] });
});

test('user order moves items inside their group, never across groups', () => {
  const r = arrangeGroupedRail(PANELS, ['search', 'components', 'maths-panel', 'ChatPanel', 'ghost'], { showAll: true });
  assert.deepEqual(groupLabels(r), [
    ['make', ['AI']],
    ['look', ['Assets', 'Images', 'Characters', 'Styles']],
    ['structure', ['Search', 'Parts', 'Layers']],
    ['game', ['Maths']],
    ['advanced', ['Server', 'Where used']]
  ]);
});

test('resolveShowAllTools: a stored choice wins; otherwise fewer than 3 projects means the simple rail', () => {
  assert.equal(SHOW_ALL_TOOLS_MIN_PROJECTS, 3);
  assert.equal(resolveShowAllTools(undefined, 0), false);
  assert.equal(resolveShowAllTools(undefined, 2), false);
  assert.equal(resolveShowAllTools(undefined, 3), true);
  assert.equal(resolveShowAllTools(undefined, 40), true);
  assert.equal(resolveShowAllTools(true, 0), true);
  assert.equal(resolveShowAllTools(false, 40), false);
  assert.equal(resolveShowAllTools('yes', 0), false, 'a non-boolean is not a stored choice');
  assert.equal(resolveShowAllTools(null, 5), true);
});

/** The px height the top cluster draws at (Add, separators, More and its separator included). */
function topHeight(r: ReturnType<typeof arrangeGroupedRail<Item>>): number {
  const slots = r.groups.reduce((n, g) => n + g.items.length, 0) + 1 + (r.hasMore ? 1 : 0);
  const separators = r.groups.length - 1 + (r.hasMore ? 1 : 0);
  return slots * RAIL_SLOT - 2 + separators * RAIL_SEPARATOR;
}

test('a tall rail folds nothing; no height measurement folds nothing', () => {
  assert.equal(arrangeGroupedRail(PANELS, [], { showAll: true, railHeight: 1400 }).hasMore, false);
  assert.equal(arrangeGroupedRail(PANELS, [], { showAll: true, railHeight: 0 }).hasMore, false);
});

test('a short rail folds the tail into More, and what is left fits with More drawn', () => {
  for (const h of [880, 760, 640, 520, 400]) {
    const r = arrangeGroupedRail(PANELS, [], { showAll: true, railHeight: h });
    assert.equal(r.hasMore, true, `${h}px should overflow`);
    assert.ok(topHeight(r) <= railTopBudget(h, r.bottom.length), `${h}px: ${topHeight(r)} > ${railTopBudget(h, r.bottom.length)}`);
    // Folded in rail order: the visible list plus the fold is the full order.
    const visible = r.groups.flatMap((g) => g.items);
    assert.deepEqual(labels([...visible, ...r.overflow]), [
      'AI', 'Assets', 'Images', 'Characters', 'Styles', 'Parts', 'Layers', 'Search', 'Maths', 'Server', 'Where used'
    ]);
    assert.equal(r.groups[0].id, 'make');
    assert.ok(r.groups.every((g) => g.items.length > 0 || g.id === 'make'), 'no empty group left behind');
  }
});

test('the simple rail fits a short window without folding anything more', () => {
  const r = arrangeGroupedRail(PANELS, [], { showAll: false, railHeight: 640 });
  assert.deepEqual(labels(r.groups.flatMap((g) => g.items)), ['AI', 'Assets', 'Images', 'Characters', 'Maths']);
  assert.ok(topHeight(r) <= railTopBudget(640, r.bottom.length));
});

test('dedupeRailIcons: a plugin asking for a built-in icon gets the fallback; nothing else changes', () => {
  const GRID = 'grid', PERSON = 'person', PLUG = 'plug', IMG = 'img';
  const isPlugin = (id: string) => id.startsWith('web-plugin:');
  const out = dedupeRailIcons(
    [
      { id: 'web-plugin:character-studio', icon: GRID },
      { id: 'components', icon: GRID },
      { id: 'image-editor', icon: IMG },
      { id: 'web-plugin:faces', icon: PERSON },
      { id: 'web-plugin:faces-2', icon: PERSON },
      { id: 'settings' }
    ],
    isPlugin,
    PLUG
  );
  assert.equal(out.get('components'), GRID);
  assert.equal(out.get('web-plugin:character-studio'), PLUG);
  assert.equal(out.get('image-editor'), IMG);
  assert.equal(out.get('web-plugin:faces'), PERSON);
  assert.equal(out.get('web-plugin:faces-2'), PLUG);
  assert.equal(out.get('settings'), undefined);
});

test('data-guide ids are unchanged for every rail item', () => {
  const expected: Record<string, string> = {
    ChatPanel: 'rail.chat',
    'chat-panel': 'rail.chat',
    components: 'rail.components',
    hierarchy: 'rail.hierarchy',
    search: 'rail.search',
    assets: 'rail.assets',
    'project-styles': 'rail.styles',
    'maths-panel': 'rail.maths',
    'cloud-functions': 'rail.cloudFunctions',
    'image-editor': 'rail.imageEditor',
    history: 'rail.history',
    versioncontrol: 'rail.versionControl',
    cloudservice: 'rail.cloudServices',
    settings: 'rail.settings',
    'node-references': 'rail.nodeReferences',
    'rail-overflow': 'rail.more',
    'web-plugin:character-studio': 'rail.webPlugin:characterStudio'
  };
  for (const [id, guide] of Object.entries(expected)) assert.equal(railGuideId(id), guide, id);
});
