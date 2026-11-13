const { test } = require('node:test');
const assert = require('node:assert/strict');
const flash = require('../../../xgenia-parse-dashboard/Parse-Dashboard/flash');

const req = () => {
  const r = { session: {} };
  flash()(r, {}, () => {});
  return r;
};

test('a failed login message reaches the next request, once (as connect-flash did)', () => {
  const r = req();
  assert.equal(r.flash('error', 'Invalid username or password'), 1);
  assert.equal(r.flash('error', ['two', 'more']), 3);
  assert.equal(r.flash('info', 'Hello %s', 'Mark'), 1);
  assert.deepEqual(r.flash('error'), ['Invalid username or password', 'two', 'more']);
  assert.deepEqual(r.flash('error'), [], 'read once');
  assert.deepEqual(r.flash(), { info: ['Hello Mark'] });
  assert.deepEqual(r.flash(), {}, 'cleared');
});

test('without a session it says so', () => {
  const r = {};
  flash()(r, {}, () => {});
  assert.throws(() => r.flash('error', 'x'), /requires sessions/);
});
