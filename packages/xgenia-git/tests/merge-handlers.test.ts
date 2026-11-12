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
