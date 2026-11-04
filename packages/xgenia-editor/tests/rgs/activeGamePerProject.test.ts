import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeGameFor, isMeasurementTwin } from '../../src/editor/src/utils/rgs/activeGame';

test('the selected RGS game belongs to one project, never the next one opened', () => {
  const settings = {
    activeGame: { id: 'old-global', name: 'crash-space-97' }, // the old editor-wide value: ignored
    activeGameByProject: { 'crash-project': { id: 'g1', name: 'crash-space-97' } }
  };
  assert.deepEqual(activeGameFor(settings, 'crash-project'), { id: 'g1', name: 'crash-space-97' });
  assert.equal(activeGameFor(settings, 'plinko-project'), null);
  assert.equal(activeGameFor(settings, null), null);
  assert.equal(activeGameFor({}, 'crash-project'), null);
});

// (2026-11-04) Publish read "Publishing Gremlin Party RTP tests": the AI's draft copy for measuring a published game's
// maths had become the project's game. It is never one: the project then has no game chosen and is asked again.
test('an RTP measurement copy is never a project\'s game', () => {
  const settings = { activeGameByProject: { 'starter-v8': { id: 't1', name: 'Gremlin Party RTP tests' } } };
  assert.equal(activeGameFor(settings, 'starter-v8'), null);
  assert.equal(isMeasurementTwin({ name: 'Gremlin Party' }), false);
  assert.equal(isMeasurementTwin({ name: 'Gremlin Party RTP tests' }), true);
});
