import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropUnusedMathsComponents } from '../../src/editor/src/utils/publish/mathsStaysOnRgs';

// (2026-10-05, Spin Cycle) spin-cycle-demo.vercel.app served /xgenia_bundles/b1-….json: the whole maths
// component — weights, reel-strip seeds, paytable formula, the evaluator's script — after the publish had
// already swapped its instance for an Aggregator that calls the RGS.
function project(components: any[]) {
  const p: any = { components: [...components] };
  p.removeComponent = (c: any) => { p.components = p.components.filter((x: any) => x !== c); };
  return p;
}
const comp = (name: string, roots: any[]) => ({ name, graph: { roots } });

test('a Math Component the swap left unused is not in the build', () => {
  const p = project([
    comp('/App', [{ typename: 'Aggregator', children: [] }, { typename: 'Group', children: [{ typename: 'Text' }] }]),
    comp('/#__maths__/SpinCycleMaths', [{ typename: 'JavaScriptFunction' }, { typename: '/#__maths__/Helper' }]),
    comp('/#__maths__/Helper', [{ typename: 'Expression' }]),
  ]);
  assert.deepEqual(dropUnusedMathsComponents(p).sort(), ['/#__maths__/Helper', '/#__maths__/SpinCycleMaths']);
  assert.deepEqual(p.components.map((c: any) => c.name), ['/App']);
});

test('COUNTER: a Math Component the UI still uses (not deployed — it runs in the browser) stays', () => {
  const p = project([
    comp('/App', [{ typename: '/#__maths__/Local', children: [] }]),
    comp('/#__maths__/Local', [{ typename: 'Expression' }]),
    comp('/Components/Button', [{ typename: 'Group' }]),
  ]);
  assert.deepEqual(dropUnusedMathsComponents(p), []);
  assert.equal(p.components.length, 3);
});

test('COUNTER: nothing but maths components is ever removed', () => {
  const p = project([comp('/App', []), comp('/Components/Unused', [])]);
  assert.deepEqual(dropUnusedMathsComponents(p), []);
  assert.equal(p.components.length, 2);
});
