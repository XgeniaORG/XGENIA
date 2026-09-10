import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTopbarInput, suggestCommands } from '../../src/editor/src/views/EditorTopbar/topbar/topbarCommands';
import { screenSizes } from '../../src/editor/src/views/EditorTopbar/ScreenSizes';

const routes = [
  { path: '/#/', title: 'Lobby' },
  { path: '/#/game', title: 'Base game' },
  { path: '/#/paytable', title: 'Paytable' }
];

test('empty text is none', () => {
  assert.deepEqual(parseTopbarInput('', { routes }), { kind: 'none' });
  assert.deepEqual(parseTopbarInput('   ', { routes }), { kind: 'none' });
});

test('exact route path wins', () => {
  assert.deepEqual(parseTopbarInput('/#/game', { routes }), { kind: 'route', path: '/#/game', title: 'Base game' });
});

test('route prefix on path without hash prefix', () => {
  assert.deepEqual(parseTopbarInput('/pay', { routes }), { kind: 'route', path: '/#/paytable', title: 'Paytable' });
});

test('route match on title, case-insensitive', () => {
  assert.deepEqual(parseTopbarInput('base', { routes }), { kind: 'route', path: '/#/game', title: 'Base game' });
});

test('ambiguous prefix resolves to first in sort order', () => {
  const r = [{ path: '/#/b', title: 'b' }, { path: '/#/a', title: 'a' }];
  assert.deepEqual(parseTopbarInput('/', { routes: r }), { kind: 'route', path: '/#/a', title: 'a' });
});

test('device presets', () => {
  assert.equal((parseTopbarInput('phone', { routes }) as any).group, 'Mobile');
  assert.equal((parseTopbarInput('Tablet', { routes }) as any).group, 'Tablet');
  assert.equal((parseTopbarInput('desktop', { routes }) as any).group, 'Desktop');
});

test('fit', () => {
  assert.equal((parseTopbarInput('fit', { routes }) as any).id, 'fit');
});

test('explicit size WxH', () => {
  assert.deepEqual(parseTopbarInput('1280x720', { routes }), { kind: 'command', id: 'size', width: 1280, height: 720, label: '1280 × 720' });
  assert.equal((parseTopbarInput('1280 X 720', { routes }) as any).id, 'size');
});

test('size rejects out-of-range', () => {
  assert.deepEqual(parseTopbarInput('10x10', { routes }), { kind: 'none' });
});

test('zoom accepts percent and factor', () => {
  assert.equal((parseTopbarInput('zoom 50', { routes }) as any).factor, 0.5);
  assert.equal((parseTopbarInput('zoom 0.75', { routes }) as any).factor, 0.75);
  assert.equal((parseTopbarInput('zoom 200', { routes }) as any).kind, 'none');
});

test('split directions', () => {
  assert.equal((parseTopbarInput('split v', { routes }) as any).direction, 'vertical');
  assert.equal((parseTopbarInput('split horizontal', { routes }) as any).direction, 'horizontal');
  assert.equal((parseTopbarInput('split', { routes }) as any).kind, 'none');
});

test('plain verbs', () => {
  for (const v of ['detach', 'devtools', 'import', 'publish', 'refresh']) {
    assert.equal((parseTopbarInput(v, { routes }) as any).id, v);
  }
});

test('command beats route when both match', () => {
  const r = [{ path: '/#/fit', title: 'fit' }];
  assert.equal(parseTopbarInput('fit', { routes: r }).kind, 'command');
});

test('suggestions: empty text gives the three defaults', () => {
  const s = suggestCommands('', { routes });
  assert.deepEqual(s.map((m: any) => m.id ?? m.kind), ['preset', 'fit', 'detach']);
});

test('suggestions: prefix filters by label, max limit', () => {
  const s = suggestCommands('de', { routes }, 5);
  const ids = s.map((m: any) => m.id);
  assert.ok(ids.includes('detach'));
  assert.ok(ids.includes('devtools'));
  assert.ok(ids.includes('preset')); // "Desktop preview"
  assert.ok(s.length <= 5);
});

// --- regression tests added after the adversarial review ---
test('suggestCommands honours limit for empty text too', () => {
  assert.equal(suggestCommands('', { routes }, 1).length, 1);
  assert.equal(suggestCommands('', { routes }, 8).length, 8);
  assert.equal(suggestCommands('', { routes }).length, 3);
});

test('a non-positive or non-finite limit returns nothing, never a wrapped slice', () => {
  for (const bad of [0, -1, -5, NaN]) {
    assert.deepEqual(suggestCommands('e', { routes }, bad as number), [], `limit ${bad} leaked rows`);
  }
});

test('returned matches are frozen so a consumer cannot corrupt the parser', () => {
  const m = parseTopbarInput('devtools', { routes }) as any;
  assert.throws(() => { 'use strict'; m.label = 'MUTATED'; });
  assert.equal((parseTopbarInput('devtools', { routes }) as any).label, 'Open dev tools');
  const s = suggestCommands('', { routes })[0] as any;
  assert.ok(Object.isFrozen(s));
});

// --- regression: the bar this replaced was a free-text URL field ---
test('a path-shaped input navigates even when no page matches it', () => {
  assert.deepEqual(parseTopbarInput('/#/not-indexed-yet', { routes }), {
    kind: 'route',
    path: '/#/not-indexed-yet',
    title: '/#/not-indexed-yet'
  });
  assert.equal(parseTopbarInput('/deep/link/42', { routes }).kind, 'route');
  assert.equal(parseTopbarInput('#/hash-only', { routes }).kind, 'route');
});

test('non-path gibberish still matches nothing', () => {
  assert.deepEqual(parseTopbarInput('qqzzx', { routes }), { kind: 'none' });
});

test('a known route still wins over the free-text fallback', () => {
  assert.equal((parseTopbarInput('/#/game', { routes }) as any).title, 'Base game');
});

// Machine targets. The industry words are deliberately absent from the preset LABELS,
// which makes the parser the only way anyone types them — so it is the parser that has
// to know them.
test('industry jargon resolves to a machine family', () => {
  const group = (t: string) => (parseTopbarInput(t, { routes }) as any).group;
  assert.equal(group('slot'), 'Slot');
  assert.equal(group('egm'), 'Slot');
  assert.equal(group('etg'), 'Table');
  assert.equal(group('roulette'), 'Table');
  assert.equal(group('ssbt'), 'Betting');
  assert.equal(group('sportsbook'), 'Betting');
  assert.equal(group('vlt'), 'Bingo');
  assert.equal(group('arcade'), 'Arcade');
});

test('a preset match is labelled in plain words, never in jargon', () => {
  const label = (t: string) => (parseTopbarInput(t, { routes }) as any).label;
  assert.equal(label('etg'), 'Roulette terminal preview');
  assert.equal(label('egm'), 'Slot cabinet preview');
  assert.equal(label('ssbt'), 'Betting terminal preview');
});

test('every group the parser can name has at least one preset to land on', () => {
  // A word pointing at a group with no presets is a dead command: EditorTopbar resolves
  // a preset match by finding the first entry of that group and silently does nothing.
  const groups = new Set(
    screenSizes.filter((s) => s.width).map((s) => s.group)
  );
  for (const word of ['slot', 'etg', 'ssbt', 'bingo', 'arcade', 'phone', 'tablet', 'desktop']) {
    const match = parseTopbarInput(word, { routes }) as any;
    assert.equal(match.id, 'preset', `${word} did not parse as a preset`);
    assert.ok(groups.has(match.group), `${word} points at ${match.group}, which has no presets`);
  }
});

test('a portrait 4K cabinet size is accepted as a typed custom size', () => {
  // The height cap was 2160 — landscape-shaped — until cabinets arrived.
  assert.deepEqual(parseTopbarInput('2160x3840', { routes }), {
    kind: 'command',
    id: 'size',
    width: 2160,
    height: 3840,
    label: '2160 × 3840'
  });
});
