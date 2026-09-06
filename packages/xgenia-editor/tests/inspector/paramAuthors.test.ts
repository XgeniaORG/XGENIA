import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_SWEEP_WINDOW_MS,
  ParamAuthors,
  isFreshWrite
} from '../../src/editor/src/views/panels/propertyeditor/inspector/paramAuthors';

beforeEach(() => ParamAuthors.clear());

test('records and reads back authorship', () => {
  ParamAuthors.record('node-1', 'width', 'ai');
  ParamAuthors.record('node-1', 'height', 'user');
  assert.equal(ParamAuthors.getAuthor('node-1', 'width'), 'ai');
  assert.equal(ParamAuthors.getAuthor('node-1', 'height'), 'user');
  assert.equal(ParamAuthors.getAuthor('node-1', 'opacity'), undefined);
  assert.equal(ParamAuthors.getAuthor('node-2', 'width'), undefined);
});

test('the last writer wins, so a user edit clears the AI mark', () => {
  ParamAuthors.record('node-1', 'width', 'ai');
  assert.deepEqual(ParamAuthors.getAiChangedNames('node-1'), ['width']);
  ParamAuthors.record('node-1', 'width', 'user');
  assert.deepEqual(ParamAuthors.getAiChangedNames('node-1'), []);
});

test('subscribers see a version bump per write', () => {
  const seen: number[] = [];
  const unsubscribe = ParamAuthors.subscribe((snapshot) => seen.push(snapshot.version));
  ParamAuthors.record('node-1', 'a', 'ai');
  ParamAuthors.record('node-1', 'b', 'ai');
  unsubscribe();
  ParamAuthors.record('node-1', 'c', 'ai');
  assert.equal(seen.length, 2);
  assert.equal(seen[0] < seen[1], true);
});

test('a throwing subscriber neither aborts the others nor escapes into the write path', () => {
  // `record` is called from Ports.setParameter and from the AI bridge. A listener
  // that throws must not turn a successful parameter write into a failed one.
  const reached: string[] = [];
  ParamAuthors.subscribe(() => {
    throw new Error('subscriber blew up');
  });
  ParamAuthors.subscribe(() => reached.push('second'));
  assert.doesNotThrow(() => ParamAuthors.record('node-1', 'width', 'ai'));
  assert.deepEqual(reached, ['second']);
});

test('empty ids and names are ignored rather than stored', () => {
  ParamAuthors.record('', 'width', 'ai');
  ParamAuthors.record('node-1', '', 'ai');
  assert.deepEqual(ParamAuthors.getAiChangedNames('node-1'), []);
  assert.deepEqual(ParamAuthors.getAiChangedNames(''), []);
});

test('the tracked-node count is capped, dropping least-recently-touched nodes', () => {
  for (let i = 0; i < 260; i++) ParamAuthors.record(`node-${i}`, 'width', 'ai');
  // The first nodes are gone; the most recent ones are kept.
  assert.equal(ParamAuthors.getAuthor('node-0', 'width'), undefined);
  assert.equal(ParamAuthors.getAuthor('node-259', 'width'), 'ai');
});

test('touching a node again keeps it alive under the cap', () => {
  ParamAuthors.record('keep-me', 'width', 'ai');
  for (let i = 0; i < 150; i++) ParamAuthors.record(`filler-${i}`, 'width', 'ai');
  ParamAuthors.record('keep-me', 'height', 'ai');
  for (let i = 150; i < 300; i++) ParamAuthors.record(`filler-${i}`, 'width', 'ai');
  assert.equal(ParamAuthors.getAuthor('keep-me', 'height'), 'ai');
});

test('freshness drives the sweep, and a backwards clock does not revive old writes', () => {
  const now = 1_000_000;
  assert.equal(isFreshWrite({ author: 'ai', at: now }, now), true);
  assert.equal(isFreshWrite({ author: 'ai', at: now - AI_SWEEP_WINDOW_MS + 1 }, now), true);
  assert.equal(isFreshWrite({ author: 'ai', at: now - AI_SWEEP_WINDOW_MS }, now), false);
  assert.equal(isFreshWrite({ author: 'ai', at: now + 60_000 }, now), false);
  assert.equal(isFreshWrite(undefined, now), false);
});

test('forgetting a node clears its rows', () => {
  ParamAuthors.record('node-1', 'width', 'ai');
  ParamAuthors.forgetNode('node-1');
  assert.deepEqual(ParamAuthors.getAiChangedNames('node-1'), []);
});
