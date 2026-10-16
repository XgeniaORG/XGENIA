// What the AI bridge's file commands may touch: the open project, nothing else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveInsideProject } from '../../src/editor/src/utils/projectPathGuard';

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xgenia-guard-')));
const project = path.join(base, 'proj');
const sibling = path.join(base, 'proj-evil');
const outside = path.join(base, 'outside');
for (const d of [project, sibling, outside, path.join(project, 'assets')]) fs.mkdirSync(d, { recursive: true });
fs.symlinkSync(outside, path.join(project, 'escape-link'));
const linkedProject = path.join(base, 'linked-proj');
fs.symlinkSync(project, linkedProject);

const ok = (dir: string, p: string) => assert.doesNotThrow(() => resolveInsideProject(dir, p, 'test'), p);
const refused = (dir: string, p: string) => assert.throws(() => resolveInsideProject(dir, p, 'test'), /refused/, p);

test('files inside the project resolve', () => {
  ok(project, 'project.json');
  ok(project, 'assets/new/deep/file.png');
  ok(project, path.join(project, 'assets/a.png'));
  ok(project, '');
});

test('escapes are refused', () => {
  refused(project, '../outside/x.txt');
  refused(project, 'assets/../../outside/x.txt');
  refused(project, path.join(sibling, 'x.txt')); // shares the prefix "proj"
  refused(project, '/etc/passwd');
  refused(project, 'escape-link/x.txt'); // a symlink inside the project pointing out
  refused(null, 'project.json');
});

test('a project reached through a symlink still works, and its escapes are still refused', () => {
  ok(linkedProject, 'assets/a.png');
  ok(linkedProject, 'project.json');
  refused(linkedProject, '../outside/x.txt');
  refused(linkedProject, 'escape-link/x.txt');
});

test('a dangling symlink inside the project cannot be written through to the outside', () => {
  const target = path.join(outside, 'not-yet-there.txt'); // parent exists, file does not
  fs.symlinkSync(target, path.join(project, 'notes'));
  refused(project, 'notes');
  refused(project, 'notes/child.txt');
  assert.equal(fs.existsSync(target), false);
});
