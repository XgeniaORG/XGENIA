import { test } from 'node:test';
import assert from 'node:assert/strict';

// The editor models read browser globals at import time.
const g = globalThis as any;
g.window ??= g;
g.document ??= { addEventListener() {}, removeEventListener() {}, createElement: () => ({ style: {}, getContext: () => null }), body: {}, documentElement: { style: {} } };
g.navigator ??= { userAgent: 'node', platform: 'node' };
g.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
const load = Promise.all([import('../../src/editor/src/models/componentmodel'), import('../../src/editor/src/utils/exporter/bundler')]);

// (2026-10-10, GremlinGold) Publish builds a COPY of the open project. Node types resolve through the
// node library, which holds the OPEN project's components, so every component instance in the copy had
// the original's ComponentModel as its type. The bundler followed n.type into the original's graphs and
// listed a Math Component the publish had already swapped out and dropped from the copy; exportComponent
// then got undefined: "Cannot read properties of undefined (reading 'name')" at "Building UI bundle...".

/** A component whose graph holds instances of `uses` (each given as the ComponentModel its node type resolves to). */
function comp(ComponentModel: any, name: string, uses: any[] = []) {
  const c: any = Object.create(ComponentModel.prototype);
  c.name = name;
  c.graph = { forEachNode: (fn: (n: any) => void) => uses.forEach((t) => fn({ type: t, typename: t.name, parameters: {} })) };
  return c;
}

test('a copy is bundled from its own components, not the open project the node types point at', async () => {
  const [{ ComponentModel }, { _collectDependencyGraph, _flattenDependencyGraph }] = await load;
  const make = (name: string, uses: any[] = []) => comp(ComponentModel, name, uses);
  // The open project: Logic still holds the Math Component instance.
  const openMaths = make('/#__maths__/Maths');
  const openLogic = make('/Components/Logic', [openMaths]);
  const openApp = make('/App', [openLogic]);
  // The publish copy: the instance became an Aggregator and the Math Component was dropped. Its /App
  // instance node still resolves to the OPEN project's Logic (the node library's).
  const copyLogic = make('/Components/Logic', []);
  const copyApp = make('/App', [openLogic]);
  const all = [copyApp, copyLogic];

  const names = _flattenDependencyGraph(_collectDependencyGraph(copyApp, all)).map((c: any) => c.name);
  assert.deepEqual(names, ['/App', '/Components/Logic']);
  assert.ok(!names.includes('/#__maths__/Maths'), 'the dropped Math Component must not be listed');
  void openApp;
});

test('COUNTER: an instance of a component the project has is still followed', async () => {
  const [{ ComponentModel }, { _collectDependencyGraph, _flattenDependencyGraph }] = await load;
  const make = (name: string, uses: any[] = []) => comp(ComponentModel, name, uses);
  const child = make('/Components/Child');
  const app = make('/App', [child]);
  const names = _flattenDependencyGraph(_collectDependencyGraph(app, [app, child])).map((c: any) => c.name);
  assert.deepEqual(names, ['/App', '/Components/Child']);
});
