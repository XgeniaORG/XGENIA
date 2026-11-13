const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return { app: { getVersion: () => '0.0.0' } };
  return realLoad.call(this, request, ...rest);
};
const { imageTargetPath } = require('../../src/main/src/design-tool-import-server');
Module._load = realLoad;

const project = path.resolve('/tmp/some-project');

test('the plugin\'s image names land in the project', () => {
  assert.equal(imageTargetPath(project, 'a1b2c3d4e5.png'), path.join(project, 'a1b2c3d4e5.png'));
  assert.equal(imageTargetPath(project, 'hero_image-2.svg'), path.join(project, 'hero_image-2.svg'));
});

test('names that are not a plain file name are refused', () => {
  for (const name of ['', '.png', '..', 'a/b.png', 'a\\b.png', '/abs.png', 'x/../y.png', '..png', 'a..b.png', 42, null, undefined]) {
    assert.equal(imageTargetPath(project, name), null, String(name));
  }
});

test('no project open: nothing is written', () => {
  assert.equal(imageTargetPath(null, 'a.png'), null);
  assert.equal(imageTargetPath('', 'a.png'), null);
});
