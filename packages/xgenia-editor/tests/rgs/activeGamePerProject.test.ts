import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeGameFor } from '../../src/editor/src/utils/rgs/activeGame';

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
