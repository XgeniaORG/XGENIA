import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveNodeSpace, placementParamsForNode } from '../../src/editor/src/views/panels/AssetPanel/assetNodeSpace';
import { createAsyncUndo } from '../../src/editor/src/views/panels/AssetPanel/assetUndo';
import { collectGraphRefEntries, findBrokenRefs } from '../../src/editor/src/views/panels/AssetPanel/graphRefs';
import { snapMove, nudgeRects, resizeRect } from '../../src/editor/src/views/panels/AssetPanel/assetBoard';

const screen = { width: 1920, height: 1080 };
const n = (type: string, parameters: Record<string, any> = {}) => ({ type: { name: type }, parameters, getParameter: (k: string) => parameters[k] });

// ─── node space ──────────────────────────────────────────────────────────────

test('no parent: the project screen is the space', () => {
  assert.deepEqual(resolveNodeSpace([], screen), { width: 1920, height: 1080, offsetX: 0, offsetY: 0, source: 'screen' });
});

test("inside a Stage: the stage's design box is the space", () => {
  assert.deepEqual(resolveNodeSpace([n('pixi.Stage', { width: 1920, height: 1080 })], screen), {
    width: 1920, height: 1080, offsetX: 0, offsetY: 0, source: 'stage'
  });
  const def = resolveNodeSpace([n('pixi.Stage')], null);
  assert.equal((def as any).width, 800, 'the node default design box when unset');
});

test('a stage whose shape is not the screen is refused: fractions of one are not fractions of the other', () => {
  const r = resolveNodeSpace([n('pixi.Stage', { width: 800, height: 600 })], screen);
  assert.ok('refused' in r && /800×600/.test(r.refused));
});

test('plain containers add their offset; scaled, rotated or pivoted ones are refused', () => {
  const ok = resolveNodeSpace([n('pixi.Container', { x: 100, y: 50 }), n('pixi.Container', { x: 10 }), n('pixi.Stage', { width: 1920, height: 1080 })], screen);
  assert.deepEqual(ok, { width: 1920, height: 1080, offsetX: 110, offsetY: 50, source: 'stage' });
  for (const p of [{ scaleX: 2 }, { rotation: 0.3 }, { pivotX: 5 }, { x: '50%' }]) {
    const r = resolveNodeSpace([n('pixi.Container', p), n('pixi.Stage', { width: 1920, height: 1080 })], screen);
    assert.ok('refused' in r, JSON.stringify(p));
  }
});

test('an unknown ancestor between the node and its stage is refused, never guessed', () => {
  const r = resolveNodeSpace([n('Group'), n('pixi.Stage', { width: 1920, height: 1080 })], screen);
  assert.ok('refused' in r);
});

test('node params: sprite keeps its pivot, offsets are subtracted; unsupported types say so', () => {
  const placement = { source: 'split' as const, rect: { x: 0.25, y: 0.5, width: 0.5, height: 0.25 } };
  const space = { width: 1920, height: 1080, offsetX: 100, offsetY: 40, source: 'stage' as const };
  assert.deepEqual(placementParamsForNode('pixi.Sprite', placement, space, undefined), {
    params: { x: 860, y: 635, width: 960, height: 270, anchorX: 0.5, anchorY: 0.5 }
  });
  assert.deepEqual(placementParamsForNode('pixi.NineSlicePlane', placement, space, undefined), {
    params: { x: 380, y: 500, width: 960, height: 270 }
  });
  assert.ok('refused' in placementParamsForNode('Image', placement, space, undefined));
});

// ─── undo runner ─────────────────────────────────────────────────────────────

test('async undo steps run strictly in order, even when triggered back to back', async () => {
  const log: string[] = [];
  const pushed: any[] = [];
  const queue = { push: (g: any) => pushed.push(g) };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const undo = createAsyncUndo(queue, () => {}, (e) => log.push('error ' + e));
  undo.record('Rename', async () => { await wait(20); log.push('redo'); }, async () => { await wait(20); log.push('undo'); });
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].label, 'Rename');
  pushed[0].undo();
  pushed[0].do();
  pushed[0].undo();
  await undo.idle();
  assert.deepEqual(log, ['undo', 'redo', 'undo']);
});

test('a failing undo step is reported and does not wedge the queue', async () => {
  const log: string[] = [];
  const pushed: any[] = [];
  const undo = createAsyncUndo({ push: (g: any) => pushed.push(g) }, () => log.push('changed'), (e) => log.push('error'));
  undo.record('Bad', async () => {}, async () => { throw new Error('gone'); });
  undo.record('Good', async () => {}, async () => { log.push('good undo'); });
  pushed[0].undo();
  pushed[1].undo();
  await undo.idle();
  assert.deepEqual(log, ['error', 'changed', 'good undo', 'changed']);
});

// ─── broken references ───────────────────────────────────────────────────────

const comp = (name: string, nodes: any[]) => ({ name, graph: { forEachNodeRecursive: (cb: any) => nodes.forEach(cb) } });

test('graph ref entries carry node, component and key', () => {
  const node = { label: 'Spin', parameters: { image: 'assets/ui/spin.png', other: 'text' } };
  const e = collectGraphRefEntries([comp('/App', [node])]);
  assert.equal(e.length, 1);
  assert.equal(e[0].key, 'image');
  assert.equal(e[0].nodeModel, node);
});

test('broken: missing files, unknown or dangling uids, and refs into .trash — with a relink suggestion', () => {
  const nodes = [
    { label: 'A', parameters: { image: 'assets/ui/gone.png' } },
    { label: 'B', parameters: { image: 'uid://nope' } },
    { label: 'C', parameters: { image: 'uid://u1' } },
    { label: 'D', parameters: { image: '.trash/assets_ui_spin.2026-09-17T10-00-00-000Z.png' } },
    { label: 'E', parameters: { image: 'assets/old/spin.png' } },
    { label: 'OK', parameters: { image: 'assets/ui/spin.png' } }
  ];
  const broken = findBrokenRefs(collectGraphRefEntries([comp('/App', nodes)]), new Set(['assets/ui/spin.png']), { u1: 'assets/ui/deleted.png' });
  assert.deepEqual(broken.map((b) => [b.node, b.reason]), [
    ['A', 'missing'],
    ['B', 'unknown-uid'],
    ['C', 'missing'],
    ['D', 'in-trash'],
    ['E', 'missing']
  ]);
  assert.equal(broken.find((b) => b.node === 'D')!.suggestion, 'assets/ui/spin.png', 'the live file the trashed copy was a version of');
  assert.equal(broken.find((b) => b.node === 'E')!.suggestion, 'assets/ui/spin.png', 'a unique file with the same name elsewhere');
  assert.equal(broken.find((b) => b.node === 'A')!.suggestion, undefined);
});

// ─── placement board ─────────────────────────────────────────────────────────

test('snap: a moving group snaps its edge or center to another piece or the screen, within the threshold', () => {
  const moving = [{ x: 0.1, y: 0.1, width: 0.1, height: 0.1 }];
  const others = [{ x: 0.302, y: 0.5, width: 0.1, height: 0.1 }];
  // dragged right by 0.1 → right edge at 0.3, other's left edge at 0.302 is 3.84 px away on 1920
  const r = snapMove(moving, others, 0.1, 0, screen, 6);
  assert.ok(Math.abs(r.dx - 0.102) < 1e-9);
  assert.equal(r.dy, 0);
  assert.ok(r.guides.some((g) => g.axis === 'x' && Math.abs(g.at - 0.302) < 1e-9));
  const free = snapMove(moving, others, 0.05, 0, screen, 6);
  assert.ok(Math.abs(free.dx - 0.05) < 1e-9, 'nothing near: no snap');
});

test('snap: moves stay on screen', () => {
  const r = snapMove([{ x: 0.95, y: 0, width: 0.1, height: 0.1 }], [], 0.2, 0, screen, 0);
  assert.ok(r.dx <= 0 + 1e-9, 'cannot push a piece further off the right edge');
});

test('nudge moves by whole screen pixels and resize keeps the ratio with shift', () => {
  const [r] = nudgeRects([{ x: 0.5, y: 0.5, width: 0.1, height: 0.1 }], 10, -1, screen);
  assert.ok(Math.abs(r.x - (0.5 + 10 / 1920)) < 1e-9 && Math.abs(r.y - (0.5 - 1 / 1080)) < 1e-9);
  const k = resizeRect({ x: 0, y: 0, width: 0.2, height: 0.1 }, 0.1, 0.5, true);
  assert.ok(Math.abs(k.width / k.height - 2) < 1e-9);
});

// (2026-09-17) Against the editor's REAL UndoQueue: a group built with do/undo in its constructor
// leaves its internal pointer at 0, so queue.undo() ran NOTHING while the panel toasted "Undo …".
import { UndoActionGroup, UndoQueue } from '../../src/editor/src/models/undo-queue-model';
import { makeUndoGroup } from '../../src/editor/src/views/panels/AssetPanel/assetUndo';

test('with the real UndoQueue, undo and redo actually run the recorded steps', async () => {
  const queue = new UndoQueue();
  const log: string[] = [];
  const undo = createAsyncUndo(queue, () => {}, (e) => log.push('error ' + e), (g) => makeUndoGroup(UndoActionGroup, g));
  undo.record('Rename', async () => void log.push('redo'), async () => void log.push('undo'));
  queue.undo();
  await undo.idle();
  queue.redo();
  await undo.idle();
  queue.undo();
  await undo.idle();
  assert.deepEqual(log, ['undo', 'redo', 'undo']);
});

// ─── review round 3 ──────────────────────────────────────────────────────────

import { diffRowPaths, applyRowPaths } from '../../src/editor/src/views/panels/AssetPanel/assetUndo';

test('broken refs: a file that exists on disk but outside the scan is never flagged or relinked', () => {
  const nodes = [{ label: 'Deep', parameters: { image: 'assets/ui/build/button.png' } }];
  const broken = findBrokenRefs(
    collectGraphRefEntries([comp('/App', nodes)]),
    new Set(['assets/icons/button.png']),
    {},
    (p) => p === 'assets/ui/build/button.png'
  );
  assert.equal(broken.length, 0);
});

test("node space: a Container with an explicit size scales its children, so it is refused; so is the node's own transform", () => {
  const r = resolveNodeSpace([n('pixi.Container', { width: 400 }), n('pixi.Stage', { width: 1920, height: 1080 })], screen);
  assert.ok('refused' in r);
  const placement = { source: 'split' as const, rect: { x: 0.25, y: 0.5, width: 0.5, height: 0.25 } };
  const space = { width: 1920, height: 1080, offsetX: 0, offsetY: 0, source: 'stage' as const };
  for (const own of [{ scaleX: 2 }, { pivotY: 3 }, { rotation: 1 }]) {
    assert.ok('refused' in placementParamsForNode('pixi.Sprite', placement, space, undefined, own), JSON.stringify(own));
  }
  assert.ok('params' in placementParamsForNode('pixi.Sprite', placement, space, undefined, { scaleX: 1, rotation: 0 }));
});

test('undo writes back only what the edit changed, keeping later changes to the same row', () => {
  const before = { tags: ['a'], ai: { prompt: 'p', layout: { v: 1 } }, uid: 'u' };
  const after = { tags: ['a', 'b'], ai: { prompt: 'p', layout: { v: 1 } }, uid: 'u' };
  const paths = diffRowPaths(before, after);
  assert.deepEqual(paths, [['tags']]);
  // Meanwhile the AI re-split the piece.
  const current = { tags: ['a', 'b'], ai: { prompt: 'p', layout: { v: 2 } }, uid: 'u' };
  assert.deepEqual(applyRowPaths(current, before, paths), { tags: ['a'], ai: { prompt: 'p', layout: { v: 2 } }, uid: 'u' });
});

test('row diffs go one level into ai and sprite, and removals are removals', () => {
  const before = { ai: { prompt: 'p' }, placement: { x: 1 } };
  const after = { ai: { prompt: 'p', layout: { v: 1 } } };
  const paths = diffRowPaths(before, after);
  assert.deepEqual(paths.map((p) => p.join('.')).sort(), ['ai.layout', 'placement']);
  const current = { ai: { prompt: 'NEW', layout: { v: 1 } } };
  assert.deepEqual(applyRowPaths(current, before, paths), { ai: { prompt: 'NEW' }, placement: { x: 1 } });
});
