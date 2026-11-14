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

// Publish sends each Math Component's own options and Bet Mode input; the RGS sets the mode on every round.
import { publishBetOptions, componentModeInput } from '../../src/editor/src/utils/stake/stakeModes';

test('publish: a wired Bet Mode sends its buy and ante as priced options, and the input the server writes the mode into', () => {
  const comp = maths({ bonusBuyMultiplier: 80 }).components[0];
  const out = publishBetOptions(comp, { stakeAmount: 100, mode: 'base' });
  assert.deepEqual(out.betOptions, {
    feature_buys: [{ id: 'bonus_buy', label: 'Bonus buy', cost_multiplier: 80 }],
    special_bets: [{ id: 'ante', label: 'Ante bet', cost_multiplier: 1.25 }]
  });
  assert.equal(out.modeInputPort, 'mode');
  assert.equal(out.modeBaseValue, 'base');
  assert.equal(componentModeInput(comp), 'mode');
});

test('publish: a component with no wired Bet Mode sells nothing (null clears stored options) and names no mode input', () => {
  const out = publishBetOptions(maths({}, false).components[0], { stakeAmount: 100 });
  assert.equal(out.betOptions, null);
  assert.equal(out.modeInputPort, null);
});

test('publish: a mode input missing from the request is not sent (the RGS refuses real money for it instead)', () => {
  const out = publishBetOptions(maths({}).components[0], { stakeAmount: 100 });
  assert.ok(out.betOptions);
  assert.equal(out.modeInputPort, null);
});
