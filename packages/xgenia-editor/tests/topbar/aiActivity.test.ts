import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAiWork } from '../../src/editor/src/models/aiactivity';

test('isAiWork: the AI\'s commands light the pill, the coach\'s do not', () => {
  assert.equal(isAiWork('graph.createNode'), true);
  assert.equal(isAiWork('viewer.executeCode'), true);
  assert.equal(isAiWork('coach.show'), false);
  assert.equal(isAiWork('coach.targets'), false);
  assert.equal(isAiWork(undefined), true);
});
