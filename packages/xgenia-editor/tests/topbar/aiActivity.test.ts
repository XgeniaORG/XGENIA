import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AiActivity, isAiWork } from '../../src/editor/src/models/aiactivity';

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

test('AiActivity.turn: the panel\'s word keeps the pill on through a thinking pause, and ends it', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  AiActivity.turn(true);
  assert.equal(AiActivity.getSnapshot().active, true);
  t.mock.timers.tick(10_000); // longer than the 4s command idle window
  assert.equal(AiActivity.getSnapshot().active, true);
  AiActivity.turn(false);
  assert.equal(AiActivity.getSnapshot().active, false);
  AiActivity.turn(true);
  t.mock.timers.tick(31_000); // the panel went away: no beat for 1.5 beats
  assert.equal(AiActivity.getSnapshot().active, false);
  t.mock.timers.reset();
});
