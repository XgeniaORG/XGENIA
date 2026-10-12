import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inferRole, isBuiltInRole, roleLabel, BUILT_IN_ROLES } from '../../src/editor/src/views/panels/AssetPanel/assetRoles';

const at = (path: string, extra: Record<string, unknown> = {}) =>
  ({ path, kind: 'image' as const, ...extra });

test('folder name decides the role, case-insensitively', () => {
  assert.equal(inferRole(at('assets/keyart/hero.png')).role, 'keyart');
  assert.equal(inferRole(at('assets/KeyArt/hero.png')).role, 'keyart');
  assert.equal(inferRole(at('assets/backgrounds/night.png')).role, 'background');
  assert.equal(inferRole(at('assets/bg/night.png')).role, 'background');
  assert.equal(inferRole(at('assets/ui/panel.png')).role, 'ui');
  assert.equal(inferRole(at('assets/hud/bar.png')).role, 'ui');
  assert.equal(inferRole(at('assets/icons/star.png')).role, 'icon');
  assert.equal(inferRole(at('assets/logo/title.png')).role, 'logo');
});

test('game-object folders all map to the generic sprite role', () => {
  for (const folder of ['symbols', 'sprites', 'characters', 'props', 'pieces', 'cards', 'tokens']) {
    assert.equal(inferRole(at(`assets/${folder}/thing.png`)).role, 'sprite', folder);
  }
});

test('a deeper folder wins over a shallower one', () => {
  assert.equal(inferRole(at('assets/ui/icons/close.png')).role, 'icon');
});

test('lineage: a piece covering most of its root canvas is a background', () => {
  const r = inferRole(at('assets/cut/plate.png', {
    lineage: {
      depth: 1,
      layerName: null,
      boxInRoot: { x: 0, y: 0, width: 1000, height: 1000 },
      canvasInRoot: { x: 0, y: 0, width: 1000, height: 1000 }
    }
  }));
  assert.equal(r.role, 'background');
});

test('lineage: a small piece is a sprite', () => {
  const r = inferRole(at('assets/cut/gem.png', {
    lineage: {
      depth: 1,
      layerName: null,
      boxInRoot: { x: 10, y: 10, width: 100, height: 100 },
      canvasInRoot: { x: 0, y: 0, width: 1000, height: 1000 }
    }
  }));
  assert.equal(r.role, 'sprite');
});

test('lineage: the layer name can name the role', () => {
  const r = inferRole(at('assets/cut/x.png', {
    lineage: {
      depth: 1,
      layerName: 'Spin button',
      boxInRoot: { x: 0, y: 0, width: 50, height: 50 },
      canvasInRoot: { x: 0, y: 0, width: 1000, height: 1000 }
    }
  }));
  assert.equal(r.role, 'ui');
});

test('a zero-area canvas never divides by zero and falls through to sprite', () => {
  const r = inferRole(at('assets/cut/x.png', {
    lineage: {
      depth: 1,
      layerName: null,
      boxInRoot: { x: 0, y: 0, width: 0, height: 0 },
      canvasInRoot: { x: 0, y: 0, width: 0, height: 0 }
    }
  }));
  assert.equal(r.role, 'sprite');
});

test('a chosen folder beats lineage', () => {
  const r = inferRole(at('assets/hud/plate.png', {
    lineage: {
      depth: 1,
      layerName: null,
      boxInRoot: { x: 0, y: 0, width: 1000, height: 1000 },
      canvasInRoot: { x: 0, y: 0, width: 1000, height: 1000 }
    }
  }));
  assert.equal(r.role, 'ui');
});

test('extension decides when nothing else does', () => {
  assert.equal(inferRole({ path: 'assets/blip.wav', kind: 'audio' }).role, 'sfx');
  assert.equal(inferRole({ path: 'assets/theme.mp3', kind: 'audio' }).role, 'sfx');
  assert.equal(inferRole({ path: 'assets/clip.mp4', kind: 'video' }).role, 'video');
  assert.equal(inferRole({ path: 'assets/Inter.ttf', kind: 'font' }).role, 'font');
});

test('music folder beats the sfx default for audio', () => {
  assert.equal(inferRole({ path: 'assets/music/theme.wav', kind: 'audio' }).role, 'music');
  assert.equal(inferRole({ path: 'assets/sfx/theme.mp3', kind: 'audio' }).role, 'sfx');
});

test('an unrecognised image is other, never a guess', () => {
  assert.equal(inferRole(at('assets/misc/whatever.png')).role, 'other');
});

test('inferRole always reports that it inferred', () => {
  assert.equal(inferRole(at('assets/keyart/a.png')).inferred, true);
});

test('role vocabulary is closed and game-agnostic', () => {
  assert.deepEqual([...BUILT_IN_ROLES], [
    'keyart', 'background', 'sprite', 'ui', 'icon', 'logo', 'sfx', 'music', 'video', 'font', 'other'
  ]);
  assert.ok(!(BUILT_IN_ROLES as readonly string[]).includes('symbol'), 'symbol is slot-specific');
  assert.ok(isBuiltInRole('sprite'));
  assert.ok(!isBuiltInRole('reels'));
});

test('roleLabel renders custom roles readably', () => {
  assert.equal(roleLabel('keyart'), 'Key art');
  assert.equal(roleLabel('sfx'), 'SFX');
  assert.equal(roleLabel('my-custom-role'), 'My custom role');
});

// (2026-09-17) The AI writes `canvasInRoot: null` whenever a layer's canvas could not be measured.
// inferRole read `.width` off it, threw, and took the whole index scan down with it.
test('lineage: a null canvasInRoot does not throw and still yields a role', () => {
  const r = inferRole({
    path: 'assets/pieces-out/thing.png',
    kind: 'image',
    lineage: {
      depth: 1,
      layerName: 'Glowing gem',
      boxInRoot: { x: 0.1, y: 0.1, width: 0.1, height: 0.1 },
      canvasInRoot: null as any
    }
  });
  assert.equal(r.role, 'sprite');
});

// A layer cropped to its own art records canvasInRoot === boxInRoot. Coverage against that canvas
// is always 100%, which labelled every small cropped button a background.
test('lineage: a small cropped piece is a sprite, not a background', () => {
  const box = { x: 0.044, y: 0.811, width: 0.042, height: 0.073 };
  const r = inferRole({
    path: 'assets/cut/minus.png',
    kind: 'image',
    lineage: { depth: 1, layerName: null, boxInRoot: box, canvasInRoot: box }
  });
  assert.equal(r.role, 'sprite');
});

// (2026-09-17) The AI's split tool drops every piece into assets/ui by default, so in a real project
// (run 11) 19 of 20 assets read "UI": the background plate, every reel symbol. That folder is the
// splitter's choice, not a person's, so the piece's own split evidence decides there.
const piece = (layerName: string | null, box = { x: 0.3, y: 0.3, width: 0.1, height: 0.1 }) => ({
  depth: 1,
  layerName,
  boxInRoot: box,
  canvasInRoot: box
});

test("split default folder: the layer name decides", () => {
  assert.equal(inferRole(at('assets/ui/bg.png', { lineage: piece('Background jungle', { x: 0, y: 0, width: 1, height: 0.88 }) })).role, 'background');
  assert.equal(inferRole(at('assets/ui/k.png', { lineage: piece('Reel symbol blue K') })).role, 'sprite');
  assert.equal(inferRole(at('assets/ui/spin.png', { lineage: piece('Spin button') })).role, 'ui');
  assert.equal(inferRole(at('assets/ui/logo.png', { lineage: piece('Game logo title') })).role, 'logo');
});

test('split default folder: a big unnamed plate is a background, an unnamed small piece stays ui', () => {
  assert.equal(inferRole(at('assets/ui/plate.png', { lineage: piece(null, { x: 0, y: 0, width: 1, height: 0.9 }) })).role, 'background');
  assert.equal(inferRole(at('assets/ui/bit.png', { lineage: piece(null) })).role, 'ui');
});

test('split default folder only: a hand-made asset in assets/ui is still ui', () => {
  assert.equal(inferRole(at('assets/ui/panel.png')).role, 'ui');
});

test('layer names: containers and icons beat the sprite nouns inside them; "scene" is not a background word', () => {
  const role = (name: string) => inferRole(at('assets/ui/x.png', { lineage: piece(name) })).role;
  assert.equal(role('Coin counter plate'), 'ui');
  assert.equal(role('Chip bet button'), 'ui');
  assert.equal(role('Card frame'), 'ui');
  assert.equal(role('Gem icon'), 'icon');
  assert.equal(role('Win HUD panel'), 'ui');
  assert.equal(role('Title bar'), 'ui');
  assert.equal(role('Reel symbol blue K'), 'sprite');
  assert.equal(role('Game logo title'), 'logo');
  assert.equal(role('Background jungle'), 'background');
});
