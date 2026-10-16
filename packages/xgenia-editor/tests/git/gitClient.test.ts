// The git client (packages/xgenia-git) against real repositories, with the git that ships in dugite.
//   TSX_TSCONFIG_PATH=packages/xgenia-editor/tsconfig.json npx tsx --test packages/xgenia-editor/tests/git/gitClient.test.ts
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

function repo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xgenia-git-'));
  const run = (...args: string[]) => execFileSync(gitBin, args, { cwd: dir, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } });
  run('init', '-q', '-b', 'main');
  run('config', 'user.email', 'test@example.com');
  run('config', 'user.name', 'Test');
  run('config', 'commit.gpgsign', 'false');
  return dir;
}
const git = (dir: string, ...args: string[]) => execFileSync(gitBin, args, { cwd: dir }).toString();

test('diff --check reports every conflicted file, however much output there is', async () => {
  const { getFilesWithConflictMarkers } = await import('../../../xgenia-git/src/core/diff-check');
  const dir = repo();
  const N = 3000; // ~340 KB of output: many chunks. The spawn wrapper used to kill git on the first one.
  for (let i = 0; i < N; i++) fs.writeFileSync(path.join(dir, `f${i}.txt`), `${i}\n`);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'files');
  for (let i = 0; i < N; i++) fs.writeFileSync(path.join(dir, `f${i}.txt`), `<<<<<<< ours\na${i}\n=======\nb${i}\n>>>>>>> theirs\n`);
  const found = await getFilesWithConflictMarkers(dir);
  assert.equal(found.size, N);
});

test('a merge with conflicts reports Failed instead of throwing', async () => {
  const { merge, MergeResult } = await import('../../../xgenia-git/src/core/merge');
  const dir = repo();
  fs.writeFileSync(path.join(dir, 'f.txt'), 'base\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'base');
  git(dir, 'checkout', '-qb', 'other');
  fs.writeFileSync(path.join(dir, 'f.txt'), 'theirs\n');
  git(dir, 'commit', '-qam', 'theirs');
  git(dir, 'checkout', '-q', 'main');
  fs.writeFileSync(path.join(dir, 'f.txt'), 'ours\n');
  git(dir, 'commit', '-qam', 'ours');
  assert.equal(await merge(dir, 'other', {}), MergeResult.Failed);
});

test('git that cannot start rejects instead of hanging', async () => {
  const { git: runGit } = await import('../../../xgenia-git/src/core/client');
  const missing = path.join(os.tmpdir(), `xgenia-git-missing-${process.pid}-${Date.now()}`);
  for (const spawn of [false, true]) {
    const outcome = await Promise.race([
      runGit(['status'], missing, 'status', { spawn } as any).then(() => 'resolved', () => 'rejected'),
      new Promise((r) => setTimeout(() => r('hung'), 5000))
    ]);
    assert.equal(outcome, 'rejected', `spawn: ${spawn}`);
  }
});

test('a successful command carries no parsed error', async () => {
  const { git: runGit } = await import('../../../xgenia-git/src/core/client');
  const dir = repo();
  for (const spawn of [false, true]) {
    const result = await runGit(['status', '--porcelain'], dir, 'status', { spawn } as any);
    assert.equal(result.gitError, null);
    assert.equal(result.gitErrorDescription, null);
  }
});
