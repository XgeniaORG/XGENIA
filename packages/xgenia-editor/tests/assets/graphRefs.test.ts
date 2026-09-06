import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectGraphRefs } from '../../src/editor/src/views/panels/AssetPanel/graphRefs';

const comp = (nodes: Array<Record<string, unknown>>) => ({
  name: 'Main',
  graph: {
    forEachNodeRecursive(fn: (n: unknown) => void) {
      nodes.forEach(fn);
    }
  }
});

test('collects raw asset paths from string parameters', () => {
  const refs = collectGraphRefs([comp([{ parameters: { image: 'assets/symbols/cherry.png' } }])]);
  assert.ok(refs.paths.has('assets/symbols/cherry.png'));
  assert.equal(refs.uids.size, 0);
});

test('collects uids from uid:// parameters and does not treat them as paths', () => {
  const refs = collectGraphRefs([comp([{ parameters: { image: 'uid://abc123' } }])]);
  assert.ok(refs.uids.has('abc123'));
  assert.equal(refs.paths.size, 0);
});

test('ignores values that are neither asset paths nor uids', () => {
  const refs = collectGraphRefs([
    comp([{ parameters: { label: 'hello world', url: 'https://example.com/x.png', n: 4 } }])
  ]);
  assert.equal(refs.paths.size, 0);
  assert.equal(refs.uids.size, 0);
});

test('a node whose parameters getter throws does not abort the walk', () => {
  const bad = {
    get parameters(): Record<string, unknown> {
      throw new Error('unresolved type');
    }
  };
  const refs = collectGraphRefs([comp([bad, { parameters: { image: 'assets/a.png' } }])]);
  assert.ok(refs.paths.has('assets/a.png'));
});

test('a component with no graph is skipped', () => {
  const refs = collectGraphRefs([{ name: 'Empty' }, comp([{ parameters: { image: 'assets/a.png' } }])]);
  assert.ok(refs.paths.has('assets/a.png'));
});

test('a non-array argument yields empty sets rather than throwing', () => {
  const refs = collectGraphRefs(undefined as unknown as unknown[]);
  assert.equal(refs.paths.size, 0);
  assert.equal(refs.uids.size, 0);
});
