import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leftoverMathsInstances, stakeAggregatorParameters, stakeMathsEndpoints } from '../../src/editor/src/utils/stake/stakeConnector';

// (2026-11-09) A Stake build swaps each Math Component for an Aggregator exactly as Publish does, but with
// transport "stake": the node plays the component from the Stake book (runtime stake-book-session.js)
// instead of POSTing to an RGS. The frontend graph built for XRGS ships unchanged.

const cfg = { exportBet: 100, betField: 'betAmount', winField: 'winAmount', modeField: 'mode', modes: { bonus_buy: 'bonus' } };

test('every Math Component of the project gets a Stake endpoint with its connector config', () => {
  const project = { components: [{ name: '/App' }, { name: '/#__maths__/SlotMaths' }, { name: '/#__maths__/PickMaths' }] };
  const eps = stakeMathsEndpoints(project, (name) => (name.endsWith('SlotMaths') ? cfg : null));
  assert.deepEqual(Object.keys(eps), ['/#__maths__/SlotMaths'], 'a component with no config is left (and the build must refuse it)');
  assert.equal(eps['/#__maths__/SlotMaths'].url, 'stake:book');
  assert.deepEqual(eps['/#__maths__/SlotMaths'].stake, cfg);
});

test('a Stake endpoint makes a stake-transport Aggregator with the same ports', () => {
  const params = stakeAggregatorParameters({
    url: 'stake:book',
    dataInputs: ['betAmount', 'mode'],
    triggers: ['Spin'],
    outputs: ['winAmount', 'stopPositions'],
    signalOutputs: ['Done'],
    targetComponent: '/#__maths__/SlotMaths',
    stake: cfg
  });
  assert.equal(params.transport, 'stake');
  assert.deepEqual(JSON.parse(String(params.stakeConfig)), cfg);
  assert.equal(params.triggers, 'Spin');
  assert.equal(params.outputs, 'winAmount, stopPositions, Done');
  assert.equal(params.moneyScale, undefined, 'no cents conversion on Stake: the connector scales money itself');
});

test('a Math Component instance left in a build is found, however deep', () => {
  const project = {
    components: [
      { name: '/App', graph: { roots: [{ typename: 'Group', children: [{ typename: '/#__maths__/SlotMaths', children: [] }] }, { typename: 'Aggregator' }] } },
      { name: '/#__maths__/SlotMaths', graph: { roots: [{ typename: '/#__maths__/Helper' }] } }
    ]
  };
  assert.deepEqual(leftoverMathsInstances(project), ['/#__maths__/SlotMaths'], 'instances inside maths components themselves do not count');
});

import { stakeConnectorConfigFor, stakeModeNameFor } from '../../src/editor/src/utils/stake/stakeConnector';
import { stakeModeInput } from '../../src/editor/src/utils/stake/stakeModes';

test('the Book Connector is configured from the component\'s ports, the export bet and the Bet Mode', () => {
  const modes = [{ id: 'bonus_buy', kind: 'buy' as const, cost: 100, label: 'Bonus buy' }, { id: 'ante', kind: 'special' as const, cost: 1.25, label: 'Ante' }];
  const cfg = stakeConnectorConfigFor({ betInputPort: 'betAmount', winOutputPort: 'winAmount', exportBet: 100, modes, modeInput: 'mode' });
  assert.deepEqual(cfg, {
    exportBet: 100, betField: 'betAmount', winField: 'winAmount', gameUnitsPerCurrencyUnit: 1,
    modeField: 'mode', modes: { base: 'base', bonus_buy: 'buy_bonus_buy', ante: 'special_ante' }
  });
  assert.equal(stakeConnectorConfigFor({ betInputPort: 'b', winOutputPort: 'w', exportBet: 20, modes, modeInput: null }).modeField, undefined, 'no mode input: base only');
  assert.throws(() => stakeConnectorConfigFor({ betInputPort: null, winOutputPort: 'w', exportBet: 100, modes: [], modeInput: null }), /no bet input/);
});

test('Stake mode names match the ones XRGS writes (stakeModeName)', () => {
  assert.equal(stakeModeNameFor({ id: 'bonus_buy', kind: 'buy' }), 'buy_bonus_buy');
  assert.equal(stakeModeNameFor({ id: 'Super Buy!', kind: 'buy' }), 'buy_super_buy');
});

test('the mode input is the Component Inputs port wired into Bet Mode.mode', () => {
  const p = { components: [{ name: '/#__maths__/M', graph: { roots: [{ id: 'in', type: 'Component Inputs' }, { id: 'bm', type: 'Bet Mode' }], connections: [{ fromId: 'in', fromProperty: 'betMode', toId: 'bm', toProperty: 'mode' }] } }] };
  assert.equal(stakeModeInput(p), 'betMode');
  assert.equal(stakeModeInput({ components: [] }), null);
});

import { stakePickPorts } from '../../src/editor/src/utils/stake/stakeModes';

test('a wired Pick Bonus gives the connector its pick and revealed ports', () => {
  const p = { components: [{ name: '/#__maths__/M', graph: {
    roots: [{ id: 'in', type: 'Component Inputs' }, { id: 'out', type: 'Component Outputs' }, { id: 'pb', type: 'Pick Bonus' }],
    connections: [
      { fromId: 'in', fromProperty: 'tile', toId: 'pb', toProperty: 'pickIndex' },
      { fromId: 'pb', fromProperty: 'revealed', toId: 'out', toProperty: 'pickReveals' }
    ]
  } }] };
  const picks = stakePickPorts(p);
  assert.deepEqual(picks, { pickField: 'tile', revealedField: 'pickReveals' });
  const cfg = stakeConnectorConfigFor({ betInputPort: 'b', winOutputPort: 'w', exportBet: 100, modes: [], modeInput: null, picks });
  assert.equal(cfg.pickField, 'tile');
  assert.equal(cfg.revealedField, 'pickReveals');
  assert.equal(stakePickPorts({ components: [] }), null);
});
