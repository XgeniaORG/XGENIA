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

test('folder beats lineage', () => {
  const r = inferRole(at('assets/ui/plate.png', {
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
