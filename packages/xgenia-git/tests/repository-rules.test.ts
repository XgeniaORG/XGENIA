// Repository rules XGENIA writes into a project's git setup.
//
// The project merge driver must apply to the project's own root project.json only — the old
// unanchored `project.json merge=xgenia` also matched image-editor/project.json, the Images
// panel's canvas file. Repositories set up with the old line get it corrected in place.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { appendGitAttributes, replaceGitAttributeLine } from '../src/core/attributes';
import { appendGitIgnore } from '../src/core/ignore';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'xgenia-git-rules-'));

test('an old unanchored merge rule is corrected, other lines kept', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, '.gitattributes'), '*.png binary\r\nproject.json merge=xgenia\r\n');
  await replaceGitAttributeLine(dir, 'project.json merge=xgenia', '/project.json merge=xgenia');
  await appendGitAttributes(dir, ['/project.json merge=xgenia']);
  assert.equal(fs.readFileSync(path.join(dir, '.gitattributes'), 'utf-8'), '*.png binary\r\n/project.json merge=xgenia\r\n');
});

test('a new repository gets only the anchored rule', async () => {
  const dir = tmp();
  await replaceGitAttributeLine(dir, 'project.json merge=xgenia', '/project.json merge=xgenia');
  await appendGitAttributes(dir, ['/project.json merge=xgenia']);
  assert.equal(fs.readFileSync(path.join(dir, '.gitattributes'), 'utf-8'), '/project.json merge=xgenia\r\n');
});

test('the 24-hour image staging folder is ignored, once', async () => {
  const dir = tmp();
  await appendGitIgnore(dir, ['.DS_Store', '.xgenia-image-staging/']);
  await appendGitIgnore(dir, ['.DS_Store', '.xgenia-image-staging/']);
  const lines = fs.readFileSync(path.join(dir, '.gitignore'), 'utf-8').split(/\r?\n/).filter(Boolean);
  assert.deepEqual(lines, ['.DS_Store', '.xgenia-image-staging/']);
});
