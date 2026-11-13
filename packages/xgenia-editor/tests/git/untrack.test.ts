// untrack against a real repository, with the git that ships in dugite.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const g = globalThis as any;
g.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };

let gitBin = '';
before(() => {
  const dugiteGit = path.join(path.dirname(require.resolve('dugite/package.json')), 'git');
  process.env.LOCAL_GIT_DIRECTORY = dugiteGit;
  process.env.GIT_EXEC_PATH = path.join(dugiteGit, 'libexec', 'git-core');
  gitBin = path.join(dugiteGit, 'bin', 'git');
});

const git = (dir: string, ...args: string[]) =>
  execFileSync(gitBin, args, { cwd: dir, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } }).toString();

function repo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xgenia-untrack-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(dir, 'out'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'keep.txt'), 'keep');
  fs.writeFileSync(path.join(dir, 'built.json'), '{}');
  fs.writeFileSync(path.join(dir, 'out/a.png'), 'a');
  fs.writeFileSync(path.join(dir, 'out/b.png'), 'b');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'all');
  return dir;
}

test('untrack stops tracking the listed files but leaves them on disk; unknown files are fine', async () => {
  const { untrack } = await import('../../../xgenia-git/src/core/untrack');
  const dir = repo();
  await untrack(dir, ['built.json', 'out/a.png', 'never-existed.txt']);
  assert.deepEqual(git(dir, 'ls-files').trim().split('\n').sort(), ['keep.txt', 'out/b.png']);
  assert.ok(fs.existsSync(path.join(dir, 'built.json')));
  assert.ok(fs.existsSync(path.join(dir, 'out/a.png')));
  assert.deepEqual(git(dir, 'diff', '--cached', '--name-only').trim().split('\n').sort(), ['built.json', 'out/a.png']);
});

test('untrack refuses the root, folders, globs, pathspec magic and paths outside the repo; the index is unchanged', async () => {
  const { untrack } = await import('../../../xgenia-git/src/core/untrack');
  const dir = repo();
  const before = git(dir, 'ls-files');
  const outside = path.join(os.tmpdir(), 'x.txt');
  for (const bad of [['.'], ['out'], ['*'], [':/'], ['../x'], [outside], [''], ['a/../..'], ['built.json', '.']]) {
    await assert.rejects(untrack(dir, bad), undefined, JSON.stringify(bad));
    assert.equal(git(dir, 'ls-files'), before, JSON.stringify(bad));
    assert.equal(git(dir, 'diff', '--cached', '--name-only').trim(), '', JSON.stringify(bad));
  }
});

test('untrack with no paths does nothing', async () => {
  const { untrack } = await import('../../../xgenia-git/src/core/untrack');
  const dir = repo();
  await untrack(dir, []);
  assert.equal(git(dir, 'diff', '--cached', '--name-only').trim(), '');
});

test('the bridge command untracks in the open project', async () => {
  const { untrackInProject } = await import('../../src/editor/src/utils/extensions/gitUntrack');
  const { untrack } = await import('../../../xgenia-git/src/core/untrack');
  const dir = repo();
  assert.deepEqual(await untrackInProject(undefined, ['built.json']), { success: false, error: 'No project directory' });
  assert.deepEqual(await untrackInProject(dir, 'built.json' as any), { success: false, error: 'paths must be an array of strings' });
  assert.deepEqual(await untrackInProject(dir, ['built.json'], untrack), { success: true, paths: ['built.json'] });
  assert.deepEqual(git(dir, 'ls-files').trim().split('\n').sort(), ['keep.txt', 'out/a.png', 'out/b.png']);
});
