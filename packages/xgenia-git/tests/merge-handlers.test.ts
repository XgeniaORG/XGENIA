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
  run(dir, 'commit', '-qm', 'theirs');
  run(dir, 'checkout', '-q', 'main');
  write(1);
  run(dir, 'commit', '-qm', 'ours');
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
    merge: async (_b, o, _t, p, repoDir) => {
      seenDir = repoDir;
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

test('a handler gets the other side\'s commit when the strategy knows it', async () => {
  let seenRev: string | null | undefined;
  registerMergeHandler({
    id: 'test-rev',
    match: (p) => p.endsWith('.rev'),
    merge: async (_b, o, _t, _p, _d, theirsRev) => {
      seenRev = theirsRev;
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
  await new MergeStrategy(dir, (_a, o) => o, 'our', run(dir, 'rev-parse', 'other')).solveConflicts(tree as any);
  assert.equal(seenRev, run(dir, 'rev-parse', 'other'));
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
