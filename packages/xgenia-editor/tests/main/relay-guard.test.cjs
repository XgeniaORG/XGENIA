const { test } = require('node:test');
const assert = require('node:assert/strict');
const { originAllowed, mayRegisterAs } = require('../../src/main/src/relay-guard');

const lan = new Set(['192.168.1.20', 'fe80::1']);

test('our own pages may open the preview relay', () => {
  for (const o of [undefined, '', 'file://', 'http://localhost:8574', 'http://localhost:8080', 'http://127.0.0.1:8574', 'http://[::1]:8574', 'http://192.168.1.20:8574']) {
    assert.equal(originAllowed(o, lan), true, String(o));
  }
});

test('other sites may not, whatever port they use', () => {
  for (const o of ['https://example.com', 'http://example.com:8574', 'null', 'http://192.168.1.99:8574', 'chrome-extension://abc', 'not a url']) {
    assert.equal(originAllowed(o, lan), false, o);
  }
});

test('only this machine may drive viewers', () => {
  assert.equal(mayRegisterAs('editor', '127.0.0.1', 'http://localhost:8080'), true);
  assert.equal(mayRegisterAs('editor', '::1', 'file://'), true);
  assert.equal(mayRegisterAs('service', '127.0.0.1', undefined), true);
  assert.equal(mayRegisterAs('editor', '192.168.1.99', undefined), false, 'from the LAN');
  assert.equal(mayRegisterAs('editor', '127.0.0.1', 'http://192.168.1.20:8574'), false, 'a LAN-served page');
  assert.equal(mayRegisterAs('viewer', '192.168.1.99', 'http://192.168.1.20:8574'), true, 'a phone previewing');
});
