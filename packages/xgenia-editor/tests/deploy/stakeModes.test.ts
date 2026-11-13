import { test } from 'node:test';
import assert from 'node:assert/strict';
import { declaredStakeModes } from '../../src/editor/src/utils/stake/stakeModes';

const maths = (bm: any, wired = true) => ({
  components: [{
    name: '/#__maths__/SlotMaths',
    graph: {
      roots: [{ id: 'in', type: 'Component Inputs' }, { id: 'bm', type: 'Bet Mode', parameters: bm }],
      connections: wired ? [{ fromId: 'in', fromProperty: 'mode', toId: 'bm', toProperty: 'mode' }] : []
    }
  }]
});

test('a wired Bet Mode declares its buy and ante at their prices (node defaults when unset)', () => {
  assert.deepEqual(declaredStakeModes(maths({})), [
    { id: 'bonus_buy', kind: 'buy', cost: 100, label: 'Bonus buy' },
    { id: 'ante', kind: 'special', cost: 1.25, label: 'Ante bet' }
  ]);
  assert.equal(declaredStakeModes(maths({ bonusBuyMultiplier: 75 }))[0].cost, 75);
});

test('custom multipliers become modes: buys from 10× up, boosters below', () => {
  const modes = declaredStakeModes(maths({ customMultipliers: '{"super_buy": 250, "enhanced_25": 1.5, "bad name!": 3}' }));
  assert.deepEqual(modes.find((m) => m.id === 'super_buy'), { id: 'super_buy', kind: 'buy', cost: 250, label: 'super buy' });
  assert.equal(modes.find((m) => m.id === 'enhanced_25')?.kind, 'special');
  assert.ok(!modes.some((m) => m.id === 'bad name!'));
});

test('a Bet Mode the game cannot reach (mode not wired from the inputs) declares nothing', () => {
  assert.deepEqual(declaredStakeModes(maths({}, false)), []);
  assert.deepEqual(declaredStakeModes({ components: [{ name: '/App', graph: { roots: [{ id: 'bm', type: 'Bet Mode' }] } }] }), []);
});
