import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  conflictRows,
  canTakeTheirs,
  settleAndReload,
  canCommitWith,
  isImagePath
} from '../../src/editor/src/views/panels/VersionControlPanel/components/conflictListModel';
import {
  registerConflictPreview,
  conflictPreviewFor
} from '../../src/editor/src/utils/extensions/conflictPreviews';

const a = { path: 'a/pic.png', label: 'pic.png' };
const b = { path: 'b/data.json', item: 'part-1', label: 'Part 1', preview: 'thing' };

test('lists conflicts with keep mine / keep theirs and calls settleConflict', async () => {
  const rows = conflictRows([a, b]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].actions.map((x) => x.label), ['Keep mine', 'Keep theirs']);
  assert.equal(rows[0].isImage, true);
  assert.equal(rows[1].isImage, false);
  assert.equal(rows[1].previewKind, 'thing');

  const calls: unknown[][] = [];
  let remaining = [a, b];
  const deps = {
    settle: async (dir: string, item: unknown, side: string) => {
      calls.push([dir, item, side]);
      remaining = remaining.filter((x) => x !== item);
    },
    read: async () => remaining
  };
  const after = await settleAndReload('/repo', b, 'theirs', deps);
  assert.deepEqual(calls, [['/repo', b, 'theirs']]);
  assert.deepEqual(after, [a]);
  assert.deepEqual(await settleAndReload('/repo', a, 'ours', deps), []);
  assert.equal(calls[1][2], 'ours');
});

test('commit is disabled while conflicts remain', () => {
  const base = { localChangesCount: 2, hasConflictsInProject: false, isBusy: false };
  assert.equal(canCommitWith({ ...base, listedConflicts: 0 }), true);
  assert.equal(canCommitWith({ ...base, listedConflicts: 1 }), false);
  assert.equal(canCommitWith({ ...base, hasConflictsInProject: true, listedConflicts: 0 }), false);
  assert.equal(canCommitWith({ ...base, isBusy: true, listedConflicts: 0 }), false);
});

test('a registered preview is found by kind; image paths are recognised', () => {
  const C = () => null;
  assert.equal(conflictPreviewFor('thing'), undefined);
  registerConflictPreview('thing', C as never);
  assert.equal(conflictPreviewFor('thing'), C);
  assert.equal(conflictPreviewFor(undefined), undefined);
  assert.equal(isImagePath('X/Y.PNG'), true);
  assert.equal(isImagePath('x.json'), false);
});

test('a push with listed conflicts is refused; sync stops after the pull', async () => {
  const { conflictBlock, syncUnlessBlocked } = await import(
    '../../src/editor/src/views/panels/VersionControlPanel/components/conflictListModel'
  );
  assert.match((await conflictBlock('/r', async () => [a])) ?? '', /conflicts/);
  assert.equal(await conflictBlock('/r', async () => []), null);

  const log: string[] = [];
  const mk = (items: unknown[]) => ({
    pull: async () => (log.push('pull'), true),
    push: async () => (log.push('push'), true),
    blocked: () => conflictBlock('/r', async () => items as never),
    onBlocked: (m: string) => log.push('blocked:' + m)
  });
  await syncUnlessBlocked(mk([a]));
  assert.deepEqual(log, ['pull', 'blocked:Resolve the conflicts first.']);
  log.length = 0;
  await syncUnlessBlocked(mk([]));
  assert.deepEqual(log, ['pull', 'push']);
});

test('an item whose other side could not be recorded only offers keep mine', () => {
  const unavailable = { path: 'c/x.json', item: 'p', label: 'P', theirsDeleted: false };
  assert.equal(canTakeTheirs(unavailable), false);
  assert.deepEqual(conflictRows([unavailable])[0].actions.map((x) => x.label), ['Keep mine']);
  assert.equal(canTakeTheirs({ path: 'c/x.json', label: 'P', theirsDeleted: true }), true);
  assert.equal(canTakeTheirs({ path: 'c/x.json', label: 'P' }), true);
});
