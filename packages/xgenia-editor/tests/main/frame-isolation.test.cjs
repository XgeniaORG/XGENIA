const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const F = require('../../src/main/src/frame-isolation');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'xgenia-iso-'));

test('only remote https origins are isolated', () => {
  assert.equal(F.remoteOriginOf('https://plugin.example.com/app/index.html?x=1'), 'https://plugin.example.com');
  assert.equal(F.remoteOriginOf('http://localhost:8574/?t=1'), null);
  assert.equal(F.remoteOriginOf('https://localhost:3000/'), null);
  assert.equal(F.remoteOriginOf('http://plugin.example.com/'), null);
  assert.equal(F.remoteOriginOf('file:///Applications/XGENIA.app/index.html'), null);
  assert.equal(F.remoteOriginOf('about:blank'), null);
});

test('the known panels are isolated from the first launch', () => {
  const value = F.isolateOriginsValue(tmp()).split(',');
  for (const o of ['https://xgenia-ai-app-xgenia.vercel.app', 'https://xgenia-image-editor-plugin.vercel.app', 'https://xgenia-character-studio.vercel.app']) {
    assert.ok(value.includes(o), o);
  }
  assert.ok(F.isCovered('https://docsapp.xgenia.com', value), 'subdomains of xgenia.com');
});

test('a new plugin origin is remembered once and isolated from the next launch', () => {
  const dir = tmp();
  assert.equal(F.rememberFrameOrigin(dir, 'https://new-plugin.example.net/panel'), true);
  assert.equal(F.rememberFrameOrigin(dir, 'https://new-plugin.example.net/other'), false, 'already remembered');
  assert.equal(F.rememberFrameOrigin(dir, 'https://docsapp.xgenia.com/x'), false, 'already covered by a wildcard');
  assert.equal(F.rememberFrameOrigin(dir, 'http://localhost:8574/'), false, 'local preview is not isolated');
  assert.ok(F.isolateOriginsValue(dir).split(',').includes('https://new-plugin.example.net'));
});

test('a damaged store is ignored, not fatal', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'isolated-frame-origins.json'), '{not json');
  assert.ok(F.isolateOriginsValue(dir).includes('https://xgenia-ai-app-xgenia.vercel.app'));
  fs.writeFileSync(path.join(dir, 'isolated-frame-origins.json'), JSON.stringify(['javascript:alert(1)', 'https://ok.example.org']));
  assert.deepEqual(F.isolateOriginsValue(dir).split(',').filter((o) => !F.KNOWN_ORIGINS.includes(o)), ['https://ok.example.org']);
});
