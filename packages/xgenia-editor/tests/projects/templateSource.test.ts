import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keepInCopy, templateSource } from '../../src/editor/src/utils/projectTemplateSource';

const exists = (paths: string[]) => (p: string) => paths.includes(p);

test('Duplicate and Remix pass a game folder: it is copied, not downloaded', () => {
  const folder = '/Users/me/Games/Car Rabbits';
  assert.deepEqual(templateSource(folder, exists([folder])), { kind: 'folder', path: folder });
  assert.deepEqual(templateSource('C:\\Games\\Car Rabbits', exists(['C:\\Games\\Car Rabbits'])), {
    kind: 'folder',
    path: 'C:\\Games\\Car Rabbits'
  });
});

test('a template URL is still downloaded', () => {
  const url = 'https://docsapp.xgenia.com/projecttemplates/hello_world/hello-1-12.zip';
  assert.deepEqual(templateSource(url, () => true), { kind: 'download', url });
});

test('COUNTER: a folder that is not there is not treated as one', () => {
  assert.equal(templateSource('/Users/me/Games/Gone', exists([])).kind, 'download');
});

test('the copy leaves out the git history, including the .git folder itself', () => {
  assert.equal(keepInCopy('/g/Car/.git', '/'), false);
  assert.equal(keepInCopy('/g/Car/.git/HEAD', '/'), false);
  assert.equal(keepInCopy('/g/Car/.gitignore', '/'), true);
  assert.equal(keepInCopy('/g/Car/project.json', '/'), true);
  assert.equal(keepInCopy('/g/Car/.xgenia/chat/index.json', '/'), true);
});
