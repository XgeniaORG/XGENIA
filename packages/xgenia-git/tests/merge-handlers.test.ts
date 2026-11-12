import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// The git client reads debug flags from localStorage, which only exists in the editor.
process.env.LOCAL_GIT_DIRECTORY ??= path.resolve(__dirname, '..', '..', '..', 'node_modules', 'dugite', 'git');
(globalThis as any).localStorage ??= { getItem: () => null };

import { ComputedAction } from '../src/core/models/computed-action';
import { mergeTree } from '../src/core/merge';
import { parseMergeTreeResult } from '../src/core/merge-tree-parser';
import { MergeStrategy } from '../src/merge-strategy';
import { readConflicts, registerMergeHandler, settleConflict } from '../src/merge-handlers';

const run = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdio: 'pipe' }).toString().trim();

const PNG_A = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00, 0x01]);
const PNG_B = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xfe, 0x80, 0x02]);
const PNG_C = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xfd, 0x81, 0x03]);

/** A repo where `main` and `other` both changed the given files from a common base. */
function makeRepo(files: Record<string, [Buffer | string, Buffer | string, Buffer | string]>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xgit-'));
  run(dir, 'init', '-q', '-b', 'main');
  const write = (i: 0 | 1 | 2) => {
    for (const [name, v] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      fs.writeFileSync(path.join(dir, name), v[i]);
    }
    run(dir, 'add', '-A');
  };
  write(0);
  run(dir, 'commit', '-qm', 'base');
  run(dir, 'checkout', '-qb', 'other');
  write(2);
  run(dir, 'commit', '-q', '--allow-empty', '-m', 'theirs');
  run(dir, 'checkout', '-q', 'main');
  write(1);
  run(dir, 'commit', '-q', '--allow-empty', '-m', 'ours');
  return dir;
}

/** Start the merge like the editor does, then let MergeStrategy settle the conflicts. */
async function mergeIn(dir: string, mergeProject = (_a: any, o: any, t: any) => ({ ...o, ...t })) {
  try {
    run(dir, 'merge', '--no-commit', '--no-ff', 'other');
  } catch {
    // conflicts are expected
  }
  const branch = (name: string) => ({ tip: { sha: run(dir, 'rev-parse', name) } }) as any;
  const tree = await mergeTree(dir, branch('main'), branch('other'));
  assert.equal(tree.kind, ComputedAction.Conflicts);
  await new MergeStrategy(dir, mergeProject).solveConflicts(tree as any);
}

test('a registered handler merges its files', async () => {
  registerMergeHandler({
    id: 'test-lines',
    match: (p) => p.endsWith('.lines'),
    merge: async (_b, o, t) => ({
      merged: Buffer.from([...new Set([...o!.toString().split('\n'), ...t!.toString().split('\n')])].join('\n')),
      conflicts: [{ path: 'x.lines', item: 'k', label: 'k differs' }]
    })
  });
  const dir = makeRepo({ 'x.lines': ['a', 'a\nours', 'a\ntheirs'] });
  await mergeIn(dir);
  assert.equal(fs.readFileSync(path.join(dir, 'x.lines'), 'utf8'), 'a\nours\ntheirs');
  assert.deepEqual((await readConflicts(dir)).map((c) => c.item), ['k']);
});

test('a handler gets the repository folder and keeps the other side it records', async () => {
  let seenDir = '';
  registerMergeHandler({
    id: 'test-sides',
    match: (p) => p.endsWith('.sides'),
    merge: async (_b, o, _t, p, ctx) => {
      seenDir = ctx.repoDir;
      return {
        merged: o,
        conflicts: [
          { path: p, item: 'own', label: 'own blob', theirsBlob: 'a'.repeat(40) },
          { path: p, item: 'gone', label: 'own delete', theirsDeleted: true },
          { path: p, item: 'none', label: 'filled in' }
        ]
      };
    }
  });
  const dir = makeRepo({ 'y.sides': ['a', 'a\nours', 'a\ntheirs'] });
  await mergeIn(dir);
  assert.equal(fs.realpathSync(seenDir), fs.realpathSync(dir));
  const items = await readConflicts(dir);
  const by = (k: string) => items.find((x) => x.item === k)!;
  assert.equal(by('own').theirsBlob, 'a'.repeat(40));
  assert.equal(by('own').theirsDeleted, undefined);
  assert.equal(by('gone').theirsDeleted, true);
  assert.equal(by('gone').theirsBlob, undefined);
  assert.equal(by('none').theirsBlob, run(dir, 'rev-parse', 'other:y.sides'));
});

test('a handler gets both sides\' commits when the strategy knows them', async () => {
  let seen: any;
  registerMergeHandler({
    id: 'test-rev',
    match: (p) => p.endsWith('.rev'),
    merge: async (_b, o, _t, _p, ctx) => {
      seen = ctx;
      return { merged: o, conflicts: [] };
    }
  });
  const dir = makeRepo({ 'z.rev': ['a', 'a\nours', 'a\ntheirs'] });
  try {
    run(dir, 'merge', '--no-commit', '--no-ff', 'other');
  } catch {
    // conflicts are expected
  }
  const branch = (name: string) => ({ tip: { sha: run(dir, 'rev-parse', name) } }) as any;
  const tree = await mergeTree(dir, branch('main'), branch('other'));
  const revs = { oursRev: run(dir, 'rev-parse', 'main'), theirsRev: run(dir, 'rev-parse', 'other') };
  await new MergeStrategy(dir, (_a, o) => o, 'our', revs).solveConflicts(tree as any);
  assert.equal(seen.oursRev, revs.oursRev);
  assert.equal(seen.theirsRev, revs.theirsRev);
  assert.equal(fs.realpathSync(seen.repoDir), fs.realpathSync(dir));
});

test('stash pop: handlers get the stash commit as ours and HEAD as theirs', async () => {
  const { solveStashConflicts } = await import('../src/merge-branch');
  let seen: any;
  registerMergeHandler({
    id: 'test-stash',
    match: (p) => p.endsWith('.stash'),
    merge: async (_b, o, _t, _p, ctx) => {
      seen = ctx;
      return { merged: o, conflicts: [] };
    }
  });
  const dir = makeRepo({ 's.stash': ['a\n', 'a\n', 'a\n'] });
  fs.writeFileSync(path.join(dir, 's.stash'), 'a\nlocal change\n');
  run(dir, 'stash', 'push', '-q');
  const stashSha = run(dir, 'rev-parse', 'stash@{0}');
  fs.writeFileSync(path.join(dir, 's.stash'), 'a\nupstream\n');
  run(dir, 'commit', '-qam', 'upstream');
  try {
    run(dir, 'stash', 'pop', '-q');
  } catch {
    // conflicts are expected
  }
  const head = run(dir, 'rev-parse', 'HEAD');
  await solveStashConflicts(dir, (_a: any, o: any) => o, stashSha, head);
  assert.ok(seen, 'the handler ran');
  assert.equal(seen.oursRev, stashSha);
  assert.equal(seen.theirsRev, head);
  assert.equal(fs.readFileSync(path.join(dir, 's.stash'), 'utf8'), 'a\nlocal change\n', 'the stash side is ours');
});

test('settle theirs refuses an item whose other side could not be recorded, before writing', async () => {
  const dir = makeRepo({ 'art/face.json': ['{"v":0}', '{"v":1}', '{"v":2}'], 'art/face.png': [PNG_A, PNG_B, PNG_C] });
  await mergeIn(dir);
  const items = await readConflicts(dir);
  const json = items.find((x) => x.path === 'art/face.json')!;
  const before = fs.readFileSync(path.join(dir, 'art/face.json'), 'utf8');
  const noTheirs = { path: json.path, item: json.item, label: json.label, theirsDeleted: false };
  await assert.rejects(settleConflict(dir, noTheirs, 'theirs'), /unavailable/);
  const alsoMissing = { ...json, alsoRestore: [{ path: 'art/face.png', theirsDeleted: false }] };
  await assert.rejects(settleConflict(dir, alsoMissing, 'theirs'), /unavailable/);
  assert.equal(fs.readFileSync(path.join(dir, 'art/face.json'), 'utf8'), before);
  await settleConflict(dir, noTheirs, 'ours');
  assert.equal(fs.readFileSync(path.join(dir, 'art/face.json'), 'utf8'), before);
});

test('a branch merge from the panel lists conflicts and keeps ours on disk', async () => {
  const { mergeBranchIntoCurrent } = await import('../src/merge-branch');
  const dir = makeRepo({ 'art/face.png': [PNG_A, PNG_B, PNG_C], 'notes.txt': ['a\n', 'a\n', 'a\nmore\n'] });
  run(dir, 'config', 'user.name', 't');
  run(dir, 'config', 'user.email', 't@t');
  await mergeBranchIntoCurrent(dir, 'other', (_a: any, o: any) => o, 'Merge other');
  assert.ok(fs.readFileSync(face(dir)).equals(PNG_B), 'ours kept on disk');
  assert.equal(fs.readFileSync(path.join(dir, 'notes.txt'), 'utf8'), 'a\nmore\n', 'clean changes merged');
  const items = await readConflicts(dir);
  assert.deepEqual(items.map((x) => x.path), ['art/face.png']);
  assert.equal(items[0].theirsBlob, run(dir, 'rev-parse', 'other:art/face.png'));
  assert.equal(run(dir, 'rev-parse', 'HEAD^2'), run(dir, 'rev-parse', 'other'), 'a merge commit');
});

test('a branch merge fast-forwards and keeps git\'s own message', async () => {
  const { mergeBranchIntoCurrent } = await import('../src/merge-branch');
  // fast-forward: main has nothing of its own
  let dir = makeRepo({ 'a.txt': ['a\n', 'a\n', 'a\nmore\n'] });
  run(dir, 'reset', '-q', '--hard', 'main~1');
  await mergeBranchIntoCurrent(dir, 'other', (_a: any, o: any) => o);
  assert.equal(run(dir, 'rev-parse', 'HEAD'), run(dir, 'rev-parse', 'other'), 'fast-forwarded, no merge commit');
  // a real merge with no message typed uses git's default message
  dir = makeRepo({ 'a.txt': ['a\nb\nc\n', 'A\nb\nc\n', 'a\nb\nC\n'] });
  run(dir, 'config', 'user.name', 't');
  run(dir, 'config', 'user.email', 't@t');
  await mergeBranchIntoCurrent(dir, 'other', (_a: any, o: any) => o);
  assert.equal(run(dir, 'log', '-1', '--format=%s'), "Merge branch 'other'");
  // a conflicted merge with no message typed also gets git's default message
  dir = makeRepo({ 'art/face.png': [PNG_A, PNG_B, PNG_C] });
  run(dir, 'config', 'user.name', 't');
  run(dir, 'config', 'user.email', 't@t');
  await mergeBranchIntoCurrent(dir, 'other', (_a: any, o: any) => o);
  assert.equal(run(dir, 'log', '-1', '--format=%s'), "Merge branch 'other'");
  assert.equal(run(dir, 'rev-parse', 'HEAD^2'), run(dir, 'rev-parse', 'other'));
});

test('a branch merge git refuses throws and makes no commit', async () => {
  const { mergeBranchIntoCurrent } = await import('../src/merge-branch');
  // local changes in the way
  let dir = makeRepo({ 't.txt': ['a\nb\nc\n', 'A\nb\nc\n', 'a\nb\nC\n'] });
  run(dir, 'config', 'user.name', 't');
  run(dir, 'config', 'user.email', 't@t');
  let head = run(dir, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(dir, 't.txt'), 'A\nb\nc\nlocal edit\n');
  await assert.rejects(mergeBranchIntoCurrent(dir, 'other', (_a: any, o: any) => o, 'Merge other'), /local changes/);
  assert.equal(run(dir, 'rev-parse', 'HEAD'), head, 'no commit made');
  assert.equal(fs.readFileSync(path.join(dir, 't.txt'), 'utf8'), 'A\nb\nc\nlocal edit\n', 'local change untouched');
  assert.deepEqual(await readConflicts(dir), []);
  // an untracked file in the way of a clean merge
  dir = makeRepo({ 'a.txt': ['a\n', 'a\nours\n', 'a\n'] });
  run(dir, 'config', 'user.name', 't');
  run(dir, 'config', 'user.email', 't@t');
  run(dir, 'checkout', '-q', 'other');
  fs.writeFileSync(path.join(dir, 'new.txt'), 'theirs');
  run(dir, 'add', '-A');
  run(dir, 'commit', '-qm', 'add new');
  run(dir, 'checkout', '-q', 'main');
  fs.writeFileSync(path.join(dir, 'new.txt'), 'mine, untracked');
  head = run(dir, 'rev-parse', 'HEAD');
  await assert.rejects(mergeBranchIntoCurrent(dir, 'other', (_a: any, o: any) => o), /untracked/);
  assert.equal(run(dir, 'rev-parse', 'HEAD'), head, 'no commit made');
  assert.equal(fs.readFileSync(path.join(dir, 'new.txt'), 'utf8'), 'mine, untracked');
});

test('a file changed on one side and deleted on the other is listed through the real merge path', async () => {
  const { mergeBranchIntoCurrent } = await import('../src/merge-branch');
  // ours changed it, theirs deleted it: ours kept, listed, theirs = deleted
  let dir = makeRepo({ 'doc.txt': ['a\n', 'a\nmine\n', 'a\n'], 'keep.txt': ['k\n', 'k\n', 'k\n'] });
  run(dir, 'config', 'user.name', 't');
  run(dir, 'config', 'user.email', 't@t');
  run(dir, 'checkout', '-q', 'other');
  run(dir, 'rm', '-q', 'doc.txt');
  run(dir, 'commit', '-qm', 'delete');
  run(dir, 'checkout', '-q', 'main');
  await mergeBranchIntoCurrent(dir, 'other', (_a: any, o: any) => o);
  assert.equal(fs.readFileSync(path.join(dir, 'doc.txt'), 'utf8'), 'a\nmine\n');
  let items = await readConflicts(dir);
  assert.deepEqual(items.map((x) => [x.path, x.theirsDeleted]), [['doc.txt', true]]);
  assert.throws(() => run(dir, 'rev-parse', '-q', '--verify', 'MERGE_HEAD'), 'the merge is committed, not left half done');
  assert.equal(run(dir, 'status', '--porcelain'), '');
  // ours deleted it, theirs changed it: the deletion is kept, listed with their blob
  dir = makeRepo({ 'doc.txt': ['a\n', 'a\n', 'a\ntheirs\n'] });
  run(dir, 'config', 'user.name', 't');
  run(dir, 'config', 'user.email', 't@t');
  run(dir, 'rm', '-q', 'doc.txt');
  run(dir, 'commit', '-qm', 'delete');
  let seen: any = null;
  registerMergeHandler({
    id: 'test-md',
    match: (p) => p.endsWith('.md-doc'),
    merge: async (b, o, t) => {
      seen = { b: b?.toString(), o, t: t?.toString() };
      return { merged: t, conflicts: [] };
    }
  });
  await mergeBranchIntoCurrent(dir, 'other', (_a: any, o: any) => o);
  assert.equal(fs.existsSync(path.join(dir, 'doc.txt')), false);
  items = await readConflicts(dir);
  assert.deepEqual(items.map((x) => [x.path, x.theirsBlob]), [['doc.txt', run(dir, 'rev-parse', 'other:doc.txt')]]);
  await settleConflict(dir, items[0], 'theirs');
  assert.equal(fs.readFileSync(path.join(dir, 'doc.txt'), 'utf8'), 'a\ntheirs\n');
  // a handler gets the delete as null and settles it
  dir = makeRepo({ 'x.md-doc': ['a\n', 'a\n', 'a\ntheirs\n'] });
  run(dir, 'config', 'user.name', 't');
  run(dir, 'config', 'user.email', 't@t');
  run(dir, 'rm', '-q', 'x.md-doc');
  run(dir, 'commit', '-qm', 'delete');
  await mergeBranchIntoCurrent(dir, 'other', (_a: any, o: any) => o);
  assert.deepEqual(seen, { b: 'a\n', o: null, t: 'a\ntheirs\n' });
  assert.equal(fs.readFileSync(path.join(dir, 'x.md-doc'), 'utf8'), 'a\ntheirs\n');
  assert.equal(run(dir, 'status', '--porcelain'), '');
});
test('project.json still merges', async () => {
  const j = (o: object) => JSON.stringify(o);
  const dir = makeRepo({ 'project.json': [j({ a: 1 }), j({ a: 1, mine: 2 }), j({ a: 1, theirs: 3 })] });
  await mergeIn(dir);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8')), { a: 1, mine: 2, theirs: 3 });
  assert.deepEqual(await readConflicts(dir), []);
});

test('unhandled conflict is listed', async () => {
  const dir = makeRepo({ 'art/face.png': [PNG_A, PNG_B, PNG_C] });
  await mergeIn(dir);
  assert.ok(fs.readFileSync(path.join(dir, 'art/face.png')).equals(PNG_B), 'ours stays on disk, bytes intact');
  const items = await readConflicts(dir);
  assert.equal(items.length, 1);
  assert.equal(items[0].path, 'art/face.png');
  assert.ok(!run(dir, 'ls-files').includes('xgenia-conflicts'));
  assert.equal(run(dir, 'status', '--porcelain').includes('xgenia-conflicts'), false);
});

test('settle theirs restores the other side', async () => {
  const dir = makeRepo({ 'art/face.png': [PNG_A, PNG_B, PNG_C] });
  await mergeIn(dir);
  const [item] = await readConflicts(dir);
  await settleConflict(dir, item, 'theirs');
  assert.ok(fs.readFileSync(path.join(dir, 'art/face.png')).equals(PNG_C));
  assert.deepEqual(await readConflicts(dir), []);

  // after the merge commit exists, the second parent is the other side
  run(dir, 'commit', '-qm', 'merge');
  fs.writeFileSync(path.join(dir, 'art/face.png'), PNG_B);
  await settleConflict(dir, item, 'theirs');
  assert.ok(fs.readFileSync(path.join(dir, 'art/face.png')).equals(PNG_C));
});

const face = (dir: string) => path.join(dir, 'art/face.png');

test('settle theirs works with no merge in progress (stash-pop path)', async () => {
  const dir = makeRepo({ 'art/face.png': [PNG_A, PNG_B, PNG_C] });
  const ours = run(dir, 'rev-parse', 'HEAD');
  await mergeIn(dir);
  const [item] = await readConflicts(dir);
  assert.ok(item.theirsBlob);
  run(dir, 'reset', '-q', '--hard', ours); // MERGE_HEAD gone, no second parent
  assert.throws(() => run(dir, 'rev-parse', '-q', '--verify', 'MERGE_HEAD'));
  await settleConflict(dir, item, 'theirs');
  assert.ok(fs.readFileSync(face(dir)).equals(PNG_C));
});

test('settle theirs after a further commit', async () => {
  const dir = makeRepo({ 'art/face.png': [PNG_A, PNG_B, PNG_C] });
  await mergeIn(dir);
  const [item] = await readConflicts(dir);
  run(dir, 'commit', '-qm', 'merge');
  fs.writeFileSync(path.join(dir, 'other.txt'), 'x');
  run(dir, 'add', '-A');
  run(dir, 'commit', '-qm', 'later');
  await settleConflict(dir, item, 'theirs');
  assert.ok(fs.readFileSync(face(dir)).equals(PNG_C));
});

test('settle theirs restores the files that go with the item; ours leaves them', async () => {
  const mk = () =>
    makeRepo({ 'art/face.json': ['{"v":0}', '{"v":1}', '{"v":2}'], 'art/face.png': [PNG_A, PNG_A, PNG_C], 'art/face.sdf.png': [PNG_A, PNG_A, PNG_A] });
  const withAlso = (dir: string, item: any) => ({
    ...item,
    alsoRestore: [
      { path: 'art/face.png', theirsBlob: run(dir, 'rev-parse', 'other:art/face.png') },
      { path: 'art/face.sdf.png', theirsDeleted: true },
      { path: 'art/never.png', theirsDeleted: true }
    ]
  });
  // theirs: json and picture both theirs, the deleted one removed and staged
  let dir = mk();
  await mergeIn(dir);
  let [item] = await readConflicts(dir);
  assert.equal(item.path, 'art/face.json');
  await settleConflict(dir, withAlso(dir, item), 'theirs');
  assert.equal(fs.readFileSync(path.join(dir, 'art/face.json'), 'utf8'), '{"v":2}');
  assert.ok(fs.readFileSync(face(dir)).equals(PNG_C));
  assert.equal(fs.existsSync(path.join(dir, 'art/face.sdf.png')), false);
  assert.equal(run(dir, 'diff', '--name-only'), '');
  assert.deepEqual(await readConflicts(dir), []);
  // ours: nothing restored
  dir = mk();
  await mergeIn(dir);
  [item] = await readConflicts(dir);
  const before = fs.readFileSync(face(dir));
  await settleConflict(dir, withAlso(dir, item), 'ours');
  assert.ok(fs.readFileSync(face(dir)).equals(before));
  assert.ok(fs.existsSync(path.join(dir, 'art/face.sdf.png')));
  // an unresolvable entry writes nothing at all
  dir = mk();
  await mergeIn(dir);
  [item] = await readConflicts(dir);
  const json = fs.readFileSync(path.join(dir, 'art/face.json'), 'utf8');
  const bad = { ...item, alsoRestore: [{ path: 'art/face.png', theirsBlob: '0'.repeat(40) }] };
  await assert.rejects(settleConflict(dir, bad, 'theirs'));
  assert.equal(fs.readFileSync(path.join(dir, 'art/face.json'), 'utf8'), json);
  assert.equal((await readConflicts(dir)).length, 1);
});

test('settle ours keeps the file and forgets the item', async () => {
  const dir = makeRepo({ 'art/face.png': [PNG_A, PNG_B, PNG_C] });
  await mergeIn(dir);
  const [item] = await readConflicts(dir);
  await settleConflict(dir, item, 'ours');
  assert.ok(fs.readFileSync(face(dir)).equals(PNG_B));
  assert.deepEqual(await readConflicts(dir), []);
});

test('an item whose other side deleted the file removes it on settle theirs', async () => {
  const dir = makeRepo({ 'art/face.png': [PNG_A, PNG_B, PNG_C] });
  await mergeIn(dir);
  const [item] = await readConflicts(dir);
  await settleConflict(dir, { path: item.path, label: item.label, theirsDeleted: true }, 'theirs');
  assert.equal(fs.existsSync(face(dir)), false);
});

test('a side that cannot be found throws and leaves the file alone', async () => {
  const dir = makeRepo({ 'art/face.png': [PNG_A, PNG_B, PNG_C] });
  await mergeIn(dir);
  const [item] = await readConflicts(dir);
  run(dir, 'commit', '-qm', 'merge');
  run(dir, 'reset', '-q', '--hard', 'main~1'); // no recorded side, no MERGE_HEAD, no second parent
  await assert.rejects(settleConflict(dir, { path: item.path, label: item.label }, 'theirs'));
  assert.ok(fs.readFileSync(face(dir)).equals(PNG_B));
  await assert.rejects(settleConflict(dir, { ...item, theirsBlob: '0'.repeat(40) }, 'theirs'));
  assert.ok(fs.readFileSync(face(dir)).equals(PNG_B));
});

const sha = (c: string) => c.repeat(40);
const header = (ctx: string) =>
  `${ctx}\n  base   100644 ${sha('a')} f.txt\n  our    100644 ${sha('b')} f.txt\n  their  100644 ${sha('c')} f.txt\n`;

test('parser: same change on both sides is not a conflict', () => {
  const text = `changed in both\n  base   100644 ${sha('a')} f.png\n  our    100644 ${sha('b')} f.png\n  their  100644 ${sha('b')} f.png\n`;
  assert.equal(parseMergeTreeResult(text).kind, ComputedAction.Clean);
});

test('parser: a clean text merge is not flagged, a binary change on both sides is', () => {
  const clean = header('changed in both') + '@@ -1,3 +1,4 @@\n 1\n+x\n 2\n';
  assert.equal(parseMergeTreeResult(clean).kind, ComputedAction.Clean);
  assert.equal(parseMergeTreeResult(header('changed in both')).kind, ComputedAction.Conflicts);
});

test('parser: a delete of a file the other side changed is a conflict; a delete of an unchanged one is not', () => {
  const removedRemote = (our: string) => `removed in remote\n  base   100644 ${sha('a')} f.txt\n  our    100644 ${our} f.txt\n@@ -1 +0,0 @@\n-x\n`;
  const removedLocal = (their: string) => `removed in local\n  base   100644 ${sha('a')} f.txt\n  their  100644 ${their} f.txt\n`;
  assert.equal(parseMergeTreeResult(removedRemote(sha('a'))).kind, ComputedAction.Clean);
  assert.equal(parseMergeTreeResult(removedLocal(sha('a'))).kind, ComputedAction.Clean);
  const r = parseMergeTreeResult(removedRemote(sha('b'))) as any;
  assert.equal(r.kind, ComputedAction.Conflicts);
  assert.equal(r.conflictedEntries[0].our.sha, sha('b'));
  assert.equal(r.conflictedEntries[0].their, undefined);
  const l = parseMergeTreeResult(removedLocal(sha('c'))) as any;
  assert.equal(l.kind, ComputedAction.Conflicts);
  assert.equal(l.conflictedEntries[0].their.sha, sha('c'));
});

const LONG = 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\n';

/** A repo where `main` renamed doc.txt to moved.txt and `other` edited doc.txt. */
function makeRenameRepo(extra: Record<string, [Buffer | string, Buffer | string, Buffer | string]> = {}) {
  const dir = makeRepo({ 'doc.txt': [LONG, LONG, LONG + 'theirs\n'], ...extra });
  run(dir, 'config', 'user.name', 't');
  run(dir, 'config', 'user.email', 't@t');
  run(dir, 'mv', 'doc.txt', 'moved.txt');
  run(dir, 'commit', '-qm', 'rename');
  return dir;
}

test('a rename on one side and an edit on the other is not a conflict (branch merge)', async () => {
  const { mergeBranchIntoCurrent } = await import('../src/merge-branch');
  // a real conflict elsewhere sends the merge through the strategy
  const dir = makeRenameRepo({ 'art/face.png': [PNG_A, PNG_B, PNG_C] });
  await mergeBranchIntoCurrent(dir, 'other', (_a: any, o: any) => o);
  assert.equal(fs.existsSync(path.join(dir, 'doc.txt')), false, 'the old path is not brought back');
  assert.equal(fs.readFileSync(path.join(dir, 'moved.txt'), 'utf8'), LONG + 'theirs\n', 'the edit follows the rename');
  assert.deepEqual((await readConflicts(dir)).map((x) => x.path), ['art/face.png']);
  assert.equal(run(dir, 'status', '--porcelain'), '');
});

test('a rename on one side and an edit on the other is not a conflict (after a clean git merge)', async () => {
  // Git._merge runs git's merge and then this; it cannot load outside Electron.
  const { solveMergeConflicts } = await import('../src/merge-branch');
  const dir = makeRenameRepo();
  const ours = run(dir, 'rev-parse', 'main');
  const theirs = run(dir, 'rev-parse', 'other');
  run(dir, 'merge', '-q', '--no-ff', '-m', 'Merge other', 'other');
  const merged = run(dir, 'rev-parse', 'HEAD');
  assert.equal(await solveMergeConflicts(dir, (_a: any, o: any) => o, ours, theirs), false, 'nothing left to commit');
  assert.equal(run(dir, 'rev-parse', 'HEAD'), merged, 'no extra commit');
  assert.equal(fs.existsSync(path.join(dir, 'doc.txt')), false, 'the old path is not brought back');
  assert.equal(fs.readFileSync(path.join(dir, 'moved.txt'), 'utf8'), LONG + 'theirs\n');
  assert.deepEqual(await readConflicts(dir), []);
  assert.equal(run(dir, 'status', '--porcelain'), '');
});

test('a true modify/delete is still settled and listed after git merge stops', async () => {
  const { solveMergeConflicts } = await import('../src/merge-branch');
  const dir = makeRepo({ 'doc.txt': [LONG, LONG + 'mine\n', LONG] });
  run(dir, 'config', 'user.name', 't');
  run(dir, 'config', 'user.email', 't@t');
  run(dir, 'checkout', '-q', 'other');
  run(dir, 'rm', '-q', 'doc.txt');
  run(dir, 'commit', '-qm', 'delete');
  run(dir, 'checkout', '-q', 'main');
  const ours = run(dir, 'rev-parse', 'main');
  const theirs = run(dir, 'rev-parse', 'other');
  assert.throws(() => run(dir, 'merge', '-q', '--no-ff', 'other'));
  assert.equal(await solveMergeConflicts(dir, (_a: any, o: any) => o, ours, theirs), true);
  assert.deepEqual((await readConflicts(dir)).map((x) => [x.path, x.theirsDeleted]), [['doc.txt', true]]);
});

test('a rename on one side and an edit on the other is not a conflict (stash pop)', async () => {
  const { solveStashConflicts } = await import('../src/merge-branch');
  const dir = makeRepo({ 'doc.txt': [LONG, LONG, LONG] });
  fs.writeFileSync(path.join(dir, 'doc.txt'), LONG + 'local\n');
  run(dir, 'stash', 'push', '-q');
  const stashSha = run(dir, 'rev-parse', 'stash@{0}');
  run(dir, 'mv', 'doc.txt', 'moved.txt');
  run(dir, 'commit', '-qm', 'rename');
  run(dir, 'stash', 'pop', '-q');
  const head = run(dir, 'rev-parse', 'HEAD');
  await solveStashConflicts(dir, (_a: any, o: any) => o, stashSha, head);
  assert.equal(fs.existsSync(path.join(dir, 'doc.txt')), false, 'the old path is not brought back');
  assert.equal(fs.readFileSync(path.join(dir, 'moved.txt'), 'utf8'), LONG + 'local\n');
  assert.deepEqual(await readConflicts(dir), []);
});

test('a true modify/delete in a stash pop is still listed', async () => {
  const { solveStashConflicts } = await import('../src/merge-branch');
  const dir = makeRepo({ 'doc.txt': [LONG, LONG, LONG] });
  fs.writeFileSync(path.join(dir, 'doc.txt'), LONG + 'local\n');
  run(dir, 'stash', 'push', '-q');
  const stashSha = run(dir, 'rev-parse', 'stash@{0}');
  run(dir, 'rm', '-q', 'doc.txt');
  run(dir, 'commit', '-qm', 'delete');
  try {
    run(dir, 'stash', 'pop', '-q');
  } catch {
    // conflicts are expected
  }
  const head = run(dir, 'rev-parse', 'HEAD');
  await solveStashConflicts(dir, (_a: any, o: any) => o, stashSha, head);
  assert.deepEqual((await readConflicts(dir)).map((x) => [x.path, x.theirsDeleted]), [['doc.txt', true]]);
});

test('a conflicted merge commit has no comment lines in its message', async () => {
  const { mergeBranchIntoCurrent } = await import('../src/merge-branch');
  const dir = makeRepo({ 'art/face.png': [PNG_A, PNG_B, PNG_C] });
  run(dir, 'config', 'user.name', 't');
  run(dir, 'config', 'user.email', 't@t');
  await mergeBranchIntoCurrent(dir, 'other', (_a: any, o: any) => o);
  const body = run(dir, 'log', '-1', '--format=%B');
  assert.equal(body.split('\n').filter((l) => l.startsWith('#')).length, 0, body);
});
