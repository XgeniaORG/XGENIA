// (2026-10-07) The published V3.0.1 macOS feed listed only x64 files; every Apple Silicon Mac was offered
// the Intel build on every start. node --test packages/xgenia-editor/tests/updater/update-arch.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { updateFitsThisMachine } = require('../../src/main/src/update-arch');

const V301 = [{ url: 'XGENIA-3.0.1-mac-x64.zip' }, { url: 'XGENIA-3.0.1-mac-x64.dmg' }];
const BOTH = [{ url: 'XGENIA-3.0.2-mac-x64.zip' }, { url: 'XGENIA-3.0.2-mac-arm64.zip' }];

test('the V3.0.1 feed is not offered to an Apple Silicon Mac', () => {
  assert.equal(updateFitsThisMachine(V301, 'darwin', 'arm64'), false);
});

test('an Intel Mac still gets it; a feed with both builds fits both', () => {
  assert.equal(updateFitsThisMachine(V301, 'darwin', 'x64'), true);
  assert.equal(updateFitsThisMachine(BOTH, 'darwin', 'arm64'), true);
  assert.equal(updateFitsThisMachine(BOTH, 'darwin', 'x64'), true);
});

test('a universal build fits any Mac; Windows and unnamed files are not judged', () => {
  assert.equal(updateFitsThisMachine([{ url: 'XGENIA-3.1.0-mac-universal.zip' }], 'darwin', 'arm64'), true);
  assert.equal(updateFitsThisMachine([{ url: 'XGENIA-Setup-3.0.1.exe' }], 'win32', 'x64'), true);
  assert.equal(updateFitsThisMachine([{ url: 'XGENIA-3.0.1.zip' }], 'darwin', 'arm64'), true);
  assert.equal(updateFitsThisMachine(undefined, 'darwin', 'arm64'), true);
});
