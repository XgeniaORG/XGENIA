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

test('isAiWork: opening a game is not the AI working', () => {
  assert.equal(isAiWork('settings.get'), false);
  assert.equal(isAiWork('auth.getJwt'), false);
  assert.equal(isAiWork('project.getId'), false);
  assert.equal(isAiWork('project.takeLobbySeed'), false);
  assert.equal(isAiWork('fs.readJson', ['/Users/me/Games/Candy/.xgenia/chat/index.json']), false);
  assert.equal(isAiWork('fs.readJson', ['/Users/me/Games/Candy/project.json']), true);
  assert.equal(isAiWork('viewer.executeCode', ['return 1'], true), false); // a lesson, marked quiet
  assert.equal(isAiWork('viewer.executeCode', ['return 1']), true);
  assert.equal(isAiWork('project.getComponents'), true);
});
