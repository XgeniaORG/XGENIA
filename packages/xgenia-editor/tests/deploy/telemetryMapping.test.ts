import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyUiNode,
  describeRef,
  duplicateElementFields,
  emptyMapping,
  isCompleteMapping,
  normalizeStoredMapping,
  rankCandidates,
  toServerTelemetry,
  type CompleteTelemetryMapping,
  type UiNodeCandidate
} from '../../src/editor/src/utils/rgs/telemetryMapping';

function candidate(
  nodeId: string,
  label: string,
  typename: string,
  componentName = '/App',
  typeLabel = typename
): UiNodeCandidate {
  return { nodeId, label, typename, typeLabel, componentName, pickedFrom: 'graph', kind: classifyUiNode(typename) };
}

const betInput = candidate('n-bet', 'Bet Amount', 'net.xgenia.controls.textinput', '/App', 'Text Input');
const winText = candidate('n-win', 'Win', 'Text');
const spinButton = candidate('n-spin', 'Spin', 'net.xgenia.controls.button', '/App', 'Button');
const group = candidate('n-group', 'Reels', 'Group');
const image = candidate('n-img', 'Logo', 'Image', '/Components/Header');

test('controls classify by the viewer type names, everything else visual is other', () => {
  assert.equal(classifyUiNode('net.xgenia.controls.textinput'), 'input');
  assert.equal(classifyUiNode('net.xgenia.controls.range'), 'input');
  assert.equal(classifyUiNode('net.xgenia.controls.options'), 'input');
  assert.equal(classifyUiNode('net.xgenia.controls.button'), 'button');
  assert.equal(classifyUiNode('Text'), 'text');
  assert.equal(classifyUiNode('Group'), 'other');
  assert.equal(classifyUiNode(''), 'other');
});

test('each field offers the kinds that usually answer it first', () => {
  const all = [image, group, spinButton, winText, betInput];
  assert.deepEqual(
    rankCandidates(all, 'betInput').map((c) => c.nodeId),
    // within a kind: by component, then label — /App before /Components/Header
    ['n-bet', 'n-win', 'n-group', 'n-img', 'n-spin']
  );
  assert.deepEqual(
    rankCandidates(all, 'winOutput').map((c) => c.nodeId),
    ['n-win', 'n-bet', 'n-group', 'n-img', 'n-spin']
  );
  assert.equal(rankCandidates(all, 'betButton')[0].nodeId, 'n-spin');
});

test('ranking is stable: ties keep graph order', () => {
  const a = candidate('a', 'Same', 'Text');
  const b = candidate('b', 'Same', 'Text');
  assert.deepEqual(rankCandidates([a, b], 'winOutput').map((c) => c.nodeId), ['a', 'b']);
  assert.deepEqual(rankCandidates([b, a], 'winOutput').map((c) => c.nodeId), ['b', 'a']);
});

test('a mapping is complete only with all three fields', () => {
  const m = emptyMapping();
  assert.equal(isCompleteMapping(m), false);
  m.betInput = betInput;
  m.winOutput = winText;
  assert.equal(isCompleteMapping(m), false);
  m.betButton = spinButton;
  assert.equal(isCompleteMapping(m), true);
  assert.equal(isCompleteMapping(null), false);
});

test('fields that name the same element are reported together', () => {
  const m = { ...emptyMapping(), betInput: betInput, winOutput: { ...betInput }, betButton: spinButton };
  assert.deepEqual(duplicateElementFields(m), [['betInput', 'winOutput']]);
  assert.deepEqual(duplicateElementFields({ ...m, winOutput: winText }), []);
});

test('the stored mapping round-trips and garbage reads as nothing', () => {
  const m: CompleteTelemetryMapping = { version: 1, betInput, winOutput: winText, betButton: spinButton };
  const back = normalizeStoredMapping(JSON.parse(JSON.stringify(m)));
  assert.ok(back);
  assert.equal(back!.betInput!.nodeId, 'n-bet');
  assert.equal(back!.betButton!.typename, 'net.xgenia.controls.button');
  // Kinds are not stored; only the reference is.
  assert.equal((back!.betInput as any).kind, undefined);

  assert.equal(normalizeStoredMapping(null), null);
  assert.equal(normalizeStoredMapping('rgsTelemetry'), null);
  assert.equal(normalizeStoredMapping({ betInput: { label: 'no id' } }), null);
  // A partial answer survives as a partial mapping.
  const partial = normalizeStoredMapping({ betButton: { nodeId: 'x', pickedFrom: 'ui' } });
  assert.equal(partial!.betButton!.nodeId, 'x');
  assert.equal(partial!.betButton!.pickedFrom, 'ui');
  assert.equal(partial!.betInput, null);
});

test('the platform payload is snake_case and carries every reference field', () => {
  const m: CompleteTelemetryMapping = {
    version: 1,
    betInput: { ...betInput, pickedFrom: 'ui' },
    winOutput: winText,
    betButton: spinButton
  };
  assert.deepEqual(toServerTelemetry(m), {
    version: 1,
    bet_input: {
      node_id: 'n-bet',
      label: 'Bet Amount',
      node_type: 'net.xgenia.controls.textinput',
      node_type_label: 'Text Input',
      component: '/App',
      picked_from: 'ui'
    },
    win_output: {
      node_id: 'n-win',
      label: 'Win',
      node_type: 'Text',
      node_type_label: 'Text',
      component: '/App',
      picked_from: 'graph'
    },
    bet_button: {
      node_id: 'n-spin',
      label: 'Spin',
      node_type: 'net.xgenia.controls.button',
      node_type_label: 'Button',
      component: '/App',
      picked_from: 'graph'
    }
  });
});

test('describeRef does not repeat a label that is just the type name', () => {
  assert.equal(describeRef(betInput), 'Bet Amount · Text Input · /App');
  assert.equal(describeRef(candidate('t', 'Text', 'Text', '/App')), 'Text · /App');
});
