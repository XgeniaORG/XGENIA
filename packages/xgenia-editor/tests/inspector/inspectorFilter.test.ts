import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  countRows,
  filterGroups,
  isEmptyResult,
  normalizeQuery,
  rowMatchesQuery
} from '../../src/editor/src/views/panels/propertyeditor/inspector/model/inspectorFilter';

type Row = { name: string; label: string; isDefault: boolean };

const groups = [
  {
    name: 'Layout',
    rows: [
      { name: 'width', label: 'Width', isDefault: false },
      { name: 'height', label: 'Height', isDefault: true },
      { name: 'fitPadding', label: 'Fit Padding', isDefault: false }
    ] as Row[]
  },
  {
    name: 'Style',
    rows: [
      { name: 'backgroundColor', label: 'Background Color', isDefault: true },
      { name: 'opacity', label: 'Opacity', isDefault: true }
    ] as Row[]
  }
];

test('an all-whitespace query is no query', () => {
  assert.equal(normalizeQuery('   '), '');
  assert.equal(normalizeQuery(undefined), '');
  assert.equal(normalizeQuery(null), '');
  assert.equal(filterGroups(groups, { mode: 'all', query: '   ' }).length, 2);
});

test('search matches the raw port name as well as the label', () => {
  // The two differ constantly ("Fit Padding" vs fitPadding) and someone reading a
  // port name off the graph or an AI transcript must be able to type it.
  const row: Row = { name: 'fitPadding', label: 'Fit Padding', isDefault: false };
  assert.equal(rowMatchesQuery(row, 'fitpad'), true);
  assert.equal(rowMatchesQuery(row, 'fit pad'), true);
  assert.equal(rowMatchesQuery(row, 'margin'), false);
});

test('search drops groups it empties', () => {
  const result = filterGroups(groups, { mode: 'all', query: 'opac' });
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'Style');
  assert.deepEqual(result[0].rows.map((r) => r.name), ['opacity']);
});

test('changed mode keeps only explicitly set parameters', () => {
  const result = filterGroups(groups, { mode: 'changed', query: '' });
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].rows.map((r) => r.name), ['width', 'fitPadding']);
});

test('counts describe the search result, not the whole node', () => {
  // A Changed count computed over every port would promise rows the active search
  // has already hidden.
  assert.deepEqual(countRows(groups, ''), { all: 5, changed: 2 });
  assert.deepEqual(countRows(groups, 'height'), { all: 1, changed: 0 });
  assert.deepEqual(countRows(groups, 'width'), { all: 1, changed: 1 });
});

test('search and changed mode compose', () => {
  const result = filterGroups(groups, { mode: 'changed', query: 'h' });
  // 'width', 'height' and 'Background Color' contain an h; only 'width' is changed.
  assert.deepEqual(result.flatMap((g) => g.rows.map((r) => r.name)), ['width']);
});

test('empty result is reported so the caller can pick an empty state', () => {
  assert.equal(isEmptyResult(filterGroups(groups, { mode: 'all', query: 'zzz' })), true);
  assert.equal(isEmptyResult(filterGroups(groups, { mode: 'all', query: '' })), false);
});

test('the input groups are never mutated', () => {
  const before = JSON.stringify(groups);
  filterGroups(groups, { mode: 'changed', query: 'w' });
  countRows(groups, 'w');
  assert.equal(JSON.stringify(groups), before);
});

// --- added after seeing the panel against a real Page node ---
import { groupMatchesQuery } from '../../src/editor/src/views/panels/propertyeditor/inspector/model/inspectorFilter';

test('a group name is a search term, and brings its whole group back', () => {
  // Some rows have no name of their own — the margin/padding widget fills its entire
  // group with one unnamed view — so the group name is the only way to reach them.
  const withUnnamed = [
    { name: 'Margin and padding', rows: [{ name: '', label: '', isDefault: true }] },
    { name: 'Layout', rows: [{ name: 'width', label: 'Width', isDefault: false }] }
  ];
  assert.equal(groupMatchesQuery(withUnnamed[0], 'margin'), true);
  assert.equal(groupMatchesQuery(withUnnamed[1], 'margin'), false);

  const result = filterGroups(withUnnamed, { mode: 'all', query: 'margin' });
  assert.equal(result.length, 1);
  assert.equal(result[0].rows.length, 1);
});

test('counts agree with the rows a group-name match produces', () => {
  const g = [
    { name: 'Sitemap', rows: [
      { name: 'included', label: 'Included', isDefault: true },
      { name: 'priority', label: 'Priority', isDefault: false }
    ] },
    { name: 'Layout', rows: [{ name: 'width', label: 'Width', isDefault: false }] }
  ];
  assert.deepEqual(countRows(g, 'sitemap'), { all: 2, changed: 1 });
  assert.deepEqual(
    filterGroups(g, { mode: 'all', query: 'sitemap' }).flatMap((x) => x.rows.map((r) => r.name)),
    ['included', 'priority']
  );
});

// --- composite rows: one row can own many parameters ---
import { changedPortNames, ownedPortNames } from '../../src/editor/src/views/panels/propertyeditor/inspector/model/portRowMeta';

const model = (params: Record<string, unknown>) => ({ parameters: params } as never);

test('ownedPortNames reaches every container the legacy layer uses', () => {
  // childViews: what addChildTypeView fills (a Dimension row and its unit/Fixed ports).
  assert.deepEqual(
    ownedPortNames({ name: 'width', childViews: [{ name: 'widthUnit' }, { name: 'widthFixed' }] }),
    ['width', 'widthUnit', 'widthFixed']
  );
  // views: what TabGroup.addView fills.
  assert.deepEqual(ownedPortNames({ views: [{ name: 'a' }, { name: 'b' }] }), ['a', 'b']);
  // ports: the component map MarginPaddingType builds, keyed by side.
  assert.deepEqual(
    ownedPortNames({ ports: { 'margin-top': { name: 'marginTop' }, 'margin-left': { name: 'marginLeft' } } }),
    ['marginTop', 'marginLeft']
  );
  // popoutGroup: ports that have no view at all until the popup opens.
  assert.deepEqual(
    ownedPortNames({ popoutGroup: 'og' }, [
      { name: 'ogTitle', popout: { group: 'og' } },
      { name: 'ogImage', popout: { group: 'og' } },
      { name: 'twCard', popout: { group: 'tw' } },
      { name: 'title' }
    ]),
    ['ogTitle', 'ogImage']
  );
});

test('ownedPortNames is duplicate-free and safe on empty views', () => {
  assert.deepEqual(ownedPortNames({ name: 'a', childViews: [{ name: 'a' }, { name: 'b' }] }), ['a', 'b']);
  assert.deepEqual(ownedPortNames(null), []);
  assert.deepEqual(ownedPortNames({}), []);
  assert.deepEqual(ownedPortNames({ ports: { x: null, y: undefined } }), []);
});

test('changedPortNames sees parameters nested inside a composite row', () => {
  // The bug this pins: Reset all reported success and left marginTop set, because it
  // read row.name and the margin/padding row has none.
  const groups = [
    {
      name: 'Margin and padding',
      rows: [
        {
          key: 'g0', name: '', label: '', group: 'Margin and padding',
          portNames: ['marginTop', 'marginLeft'], isDefault: false, isConnected: false,
          isGroupLike: true, view: null
        }
      ]
    }
  ];
  assert.deepEqual(changedPortNames(groups, model({ marginTop: { value: 12, unit: 'px' } })), ['marginTop']);
  assert.deepEqual(changedPortNames(groups, model({})), []);
});
