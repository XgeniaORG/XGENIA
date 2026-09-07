import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublishStore } from '../../src/editor/src/models/publishStore';

function mem() { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, map: m }; }
let t = 1_000_000;
const now = () => t;

test('initial snapshot', () => {
  const s = createPublishStore({ storage: mem(), now });
  assert.deepEqual(s.getSnapshot(), { phase: 'idle', publishCount: 0, dirty: false, changedAt: t });
});

test('begin → progress → succeed', () => {
  const s = createPublishStore({ storage: mem(), now });
  const seen: string[] = [];
  s.subscribe((x) => seen.push(x.phase));
  s.markDirty();
  s.begin(); assert.equal(s.getSnapshot().phase, 'publishing');
  s.progress('Deploying to Vercel...'); assert.equal(s.getSnapshot().label, 'Deploying to Vercel...');
  t += 5000;
  s.succeed('https://x.vercel.app');
  const snap = s.getSnapshot();
  assert.equal(snap.phase, 'live'); assert.equal(snap.url, 'https://x.vercel.app');
  assert.equal(snap.publishedAt, t); assert.equal(snap.publishCount, 1); assert.equal(snap.dirty, false);
  assert.deepEqual(seen, ['idle', 'publishing', 'publishing', 'live']);
});

test('fail keeps url from last success and sets error', () => {
  const s = createPublishStore({ storage: mem(), now });
  s.begin(); s.succeed('https://a'); s.begin(); s.fail('boom');
  const snap = s.getSnapshot();
  assert.equal(snap.phase, 'failed'); assert.equal(snap.error, 'boom'); assert.equal(snap.url, 'https://a'); assert.equal(snap.publishCount, 1);
});

test('markDirty after a publish sets dirty; ignored while publishing', () => {
  const s = createPublishStore({ storage: mem(), now });
  s.begin(); s.succeed('https://a');
  s.markDirty(); assert.equal(s.getSnapshot().dirty, true);
  s.begin(); s.markDirty();
  assert.equal(s.getSnapshot().dirty, false, 'no dot while the publish is in flight');
  s.succeed('https://b');
  assert.equal(s.getSnapshot().dirty, true, 'a mid-publish edit is not in the bundle that went live');
});

test('progress outside publishing is ignored', () => {
  const s = createPublishStore({ storage: mem(), now });
  s.progress('x'); assert.equal(s.getSnapshot().label, undefined);
});

test('persistence round-trip per project key', () => {
  const storage = mem();
  const a = createPublishStore({ storage, now });
  a.load('proj-1'); a.begin(); a.succeed('https://one'); a.markDirty();
  const b = createPublishStore({ storage, now });
  b.load('proj-1');
  const snap = b.getSnapshot();
  assert.equal(snap.url, 'https://one'); assert.equal(snap.publishCount, 1); assert.equal(snap.dirty, true); assert.equal(snap.phase, 'idle');
  b.load('proj-2'); assert.equal(b.getSnapshot().url, undefined);
});

test('works with no storage', () => {
  const s = createPublishStore({ storage: null, now });
  s.load('k'); s.begin(); s.succeed('https://a'); assert.equal(s.getSnapshot().url, 'https://a');
});

test('corrupt storage is ignored', () => {
  const storage = mem(); storage.setItem('xgenia-publish-state:k', '{not json');
  const s = createPublishStore({ storage, now }); s.load('k');
  assert.equal(s.getSnapshot().phase, 'idle');
});

// --- regression tests added after the adversarial review ---
test('a throwing subscriber cannot starve others or escape into the deploy pipeline', () => {
  const s = createPublishStore({ storage: mem(), now });
  let bCalls = 0;
  s.subscribe(() => { throw new Error('listener blew up'); });
  s.subscribe(() => { bCalls++; });
  assert.doesNotThrow(() => { s.begin(); s.succeed('https://a'); });
  assert.ok(bCalls >= 2, `second subscriber starved: ${bCalls} calls`);
  assert.equal(s.getSnapshot().phase, 'live');
});

test('getSnapshot returns a copy; consumer mutation cannot corrupt the store', () => {
  const storage = mem();
  const s = createPublishStore({ storage, now });
  s.load('k'); s.begin(); s.succeed('https://a');
  const a = s.getSnapshot();
  a.publishCount = 999; a.dirty = true; a.url = 'https://evil';
  const b = s.getSnapshot();
  assert.equal(b.publishCount, 1);
  assert.equal(b.dirty, false);
  assert.equal(b.url, 'https://a');
  assert.ok(!(storage.getItem('xgenia-publish-state:k') || '').includes('999'));
});

test('corrupt storage values are REJECTED, not adopted', () => {
  const storage = mem();
  storage.setItem('xgenia-publish-state:k', JSON.stringify({ url: 12345, publishCount: '7', publishedAt: 'yesterday', dirty: 'yes' }));
  const s = createPublishStore({ storage, now });
  s.load('k');
  const snap = s.getSnapshot();
  assert.equal(snap.url, undefined, 'non-string url adopted');
  assert.equal(snap.publishCount, 0, 'string publishCount adopted');
  assert.equal(snap.publishedAt, undefined, 'non-numeric publishedAt adopted -> renders as NaN');
  assert.equal(snap.dirty, false, 'truthy-string dirty adopted');
});

test('a stored array or scalar does not become the snapshot', () => {
  for (const bad of ['[1,2,3]', '"a string"', '42', 'null']) {
    const storage = mem();
    storage.setItem('xgenia-publish-state:k', bad);
    const s = createPublishStore({ storage, now });
    s.load('k');
    assert.equal(s.getSnapshot().publishCount, 0, `adopted ${bad}`);
  }
});

test('load resets a pending mid-publish dirty flag', () => {
  const s = createPublishStore({ storage: mem(), now });
  s.begin(); s.markDirty();
  s.load('other-project');
  s.begin(); s.succeed('https://x');
  assert.equal(s.getSnapshot().dirty, false, 'mid-publish flag leaked across projects');
});

// --- regression: a failed publish must not look like a clean one ---
test('failure restores the pending-changes flag that begin() cleared', () => {
  const s = createPublishStore({ storage: mem(), now });
  s.begin(); s.succeed('https://v1');
  s.markDirty();
  assert.equal(s.getSnapshot().dirty, true);
  s.begin();
  assert.equal(s.getSnapshot().dirty, false, 'optimistically cleared while running');
  s.fail('vercel refused');
  assert.equal(s.getSnapshot().dirty, true, 'nothing was deployed, so the changes are still pending');
});

test('failure keeps dirty true for an edit made during the attempt', () => {
  const s = createPublishStore({ storage: mem(), now });
  s.begin(); s.succeed('https://v1');
  s.begin();
  s.markDirty();
  s.fail('network down');
  assert.equal(s.getSnapshot().dirty, true);
});

test('a failed publish persists as dirty across a reload', () => {
  const storage = mem();
  const a = createPublishStore({ storage, now });
  a.load('proj'); a.begin(); a.succeed('https://v1'); a.markDirty(); a.begin(); a.fail('boom');
  const b = createPublishStore({ storage, now });
  b.load('proj');
  assert.equal(b.getSnapshot().dirty, true, 'reload showed a clean Live chip for an undeployed change');
  assert.equal(b.getSnapshot().url, 'https://v1');
});

test('a clean project that fails to publish does not become dirty', () => {
  const s = createPublishStore({ storage: mem(), now });
  s.begin(); s.succeed('https://v1');
  s.begin(); s.fail('boom');
  assert.equal(s.getSnapshot().dirty, false);
});
