import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyUiNode,
  emptyMapping,
  resolveTelemetryRequest,
  type DeployTelemetryMapping,
  type TelemetryElementRef,
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
const spinButton = candidate('n-spin', 'Spin', 'net.xgenia.controls.button', '/Components/Controls', 'Button');
const autoButton = candidate('n-auto', 'Auto Spin', 'net.xgenia.controls.button', '/Components/Controls', 'Button');
const candidates = [betInput, winText, spinButton, autoButton];

/** What the form records — no ranking `kind`, exactly the six reference fields. */
const REF_KEYS = ['componentName', 'label', 'nodeId', 'pickedFrom', 'typeLabel', 'typename'];

test('each field resolves by node id', () => {
  const r = resolveTelemetryRequest(
    { betInput: 'n-bet', winOutput: 'n-win', betButton: 'n-spin' },
    { candidates, stored: null }
  );
  assert.equal(r.error, undefined);
  assert.equal(r.mapping!.version, 1);
  assert.equal(r.mapping!.betInput.nodeId, 'n-bet');
  assert.equal(r.mapping!.winOutput.nodeId, 'n-win');
  assert.equal(r.mapping!.betButton.nodeId, 'n-spin');
  assert.deepEqual(Object.keys(r.mapping!.betButton).sort(), REF_KEYS);
  assert.equal(r.mapping!.betButton.pickedFrom, 'graph');
  assert.equal(r.mapping!.betButton.componentName, '/Components/Controls');
});

test('each field resolves by label, exactly or ignoring case and spaces', () => {
  const r = resolveTelemetryRequest(
    { betInput: 'Bet Amount', winOutput: '  win ', betButton: 'SPIN' },
    { candidates, stored: null }
  );
  assert.equal(r.error, undefined);
  assert.deepEqual(
    [r.mapping!.betInput.nodeId, r.mapping!.winOutput.nodeId, r.mapping!.betButton.nodeId],
    ['n-bet', 'n-win', 'n-spin']
  );
});

test('an id that is not a visual node still resolves through the project, as in the form', () => {
  const hidden: TelemetryElementRef = {
    nodeId: 'n-hidden',
    label: 'Stake',
    typename: 'Number',
    typeLabel: 'Number',
    componentName: '/App',
    pickedFrom: 'ui'
  };
  const r = resolveTelemetryRequest(
    { betInput: 'n-hidden', winOutput: 'n-win', betButton: 'n-spin' },
    { candidates, stored: null, refForNodeId: (id) => (id === 'n-hidden' ? hidden : null) }
  );
  assert.equal(r.mapping!.betInput.nodeId, 'n-hidden');
  // Named by the caller, so recorded as a graph pick whatever the lookup said.
  assert.equal(r.mapping!.betInput.pickedFrom, 'graph');
});

test('omitted fields fall back to the saved mapping, keeping how it was picked', () => {
  const stored: DeployTelemetryMapping = {
    ...emptyMapping(),
    betInput: { ...betInput, pickedFrom: 'ui' },
    winOutput: winText,
    betButton: spinButton
  };
  const all = resolveTelemetryRequest(undefined, { candidates, stored });
  assert.equal(all.error, undefined);
  assert.equal(all.mapping!.betInput.nodeId, 'n-bet');
  assert.equal(all.mapping!.betInput.pickedFrom, 'ui');
  assert.equal((all.mapping!.betInput as any).kind, undefined);

  // A named field overrides the saved one; the others still come from it.
  const mixed = resolveTelemetryRequest({ betButton: 'Auto Spin', winOutput: '' }, { candidates, stored });
  assert.equal(mixed.mapping!.betButton.nodeId, 'n-auto');
  assert.equal(mixed.mapping!.winOutput.nodeId, 'n-win');
});

test('an unresolvable name is refused with the field, the reason and the candidates', () => {
  const r = resolveTelemetryRequest({ betInput: 'n-bet', winOutput: 'n-win', betButton: 'Spinn' }, { candidates, stored: null });
  assert.equal(r.mapping, undefined);
  assert.equal(r.unresolved!.length, 1);
  assert.equal(r.unresolved![0].field, 'betButton');
  assert.equal(r.unresolved![0].asked, 'Spinn');
  assert.match(r.unresolved![0].reason, /no node has the id or label "Spinn"/);
  // The text names the field and offers buttons first, with their component and id.
  assert.match(r.error!, /betButton: no node has the id or label "Spinn"/);
  assert.match(r.error!, /Candidates: "Auto Spin" \(Button, \/Components\/Controls, id n-auto\); "Spin" \(Button/);
  // Every UI node is listed as data, without the ranking-only fields lost.
  assert.deepEqual(r.candidates!.map((c) => c.nodeId).sort(), ['n-auto', 'n-bet', 'n-spin', 'n-win']);
  assert.deepEqual(Object.keys(r.candidates![0]).sort(), ['componentName', 'kind', 'label', 'nodeId', 'typeLabel']);
});

test('a field with no name and no saved choice is refused, not guessed', () => {
  const r = resolveTelemetryRequest({ betInput: 'n-bet', winOutput: 'n-win' }, { candidates, stored: null });
  assert.equal(r.mapping, undefined);
  assert.deepEqual(r.unresolved!.map((p) => [p.field, p.asked]), [['betButton', null]]);
  assert.match(r.error!, /betButton: not given, and the project has no saved choice/);
});

test('a label shared by several nodes is ambiguous and lists just those nodes', () => {
  const twin = candidate('n-spin-2', 'Spin', 'net.xgenia.controls.button', '/Components/Mobile', 'Button');
  const r = resolveTelemetryRequest(
    { betInput: 'n-bet', winOutput: 'n-win', betButton: 'Spin' },
    { candidates: [...candidates, twin], stored: null }
  );
  assert.equal(r.mapping, undefined);
  assert.match(r.unresolved![0].reason, /2 UI nodes are labelled "Spin"/);
  assert.deepEqual(r.unresolved![0].matches!.map((c) => c.nodeId), ['n-spin', 'n-spin-2']);
  // An id still picks one of them.
  const byId = resolveTelemetryRequest(
    { betInput: 'n-bet', winOutput: 'n-win', betButton: 'n-spin-2' },
    { candidates: [...candidates, twin], stored: null }
  );
  assert.equal(byId.mapping!.betButton.componentName, '/Components/Mobile');
});

test('two fields naming one element resolve, with the same warning the form gives', () => {
  const r = resolveTelemetryRequest({ betInput: 'n-bet', winOutput: 'n-bet', betButton: 'n-spin' }, { candidates, stored: null });
  assert.ok(r.mapping);
  assert.equal(r.warnings!.length, 1);
  assert.match(r.warnings![0], /^betInput and winOutput name the same element \(Bet Amount/);
});

test('a project with no UI says so', () => {
  const r = resolveTelemetryRequest({ betInput: 'x', winOutput: 'y', betButton: 'z' }, { candidates: [], stored: null });
  assert.equal(r.unresolved!.length, 3);
  assert.match(r.error!, /The project has no visual UI nodes to choose from\./);
  assert.deepEqual(r.candidates, []);
});
