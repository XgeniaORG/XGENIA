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
