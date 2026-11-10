// The editor's XGENIA RGS addresses are the production project, never a local stack.
//
// (2026-11-10) A local-testing copy of XRGS_URL / XRGS_AUTH_URL / XRGS_ANON_KEY, marked "DO NOT COMMIT",
// reached develop in #285. Every invited studio's email sign-in then went to http://127.0.0.1:54321 and
// failed (500 from a local stack, or nothing at all), and Publish said the address "has not been invited".
//   TSX_TSCONFIG_PATH=packages/xgenia-editor/tsconfig.json npx tsx --test packages/xgenia-editor/tests/rgs/rgsEndpoints.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { XRGS_ANON_KEY, XRGS_AUTH_URL, XRGS_SANDBOX_URL, XRGS_URL } from '../../src/editor/src/utils/rgs/rgsClient';

const PROD_REF = 'usubzwydrjelmjfkkrhi';
const SANDBOX_REF = 'mzbfpxsipkklvxjsedeu';

function jwtRef(jwt: string): string | undefined {
  const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
  return payload.ref;
}

test('the real-money RGS, its sign-in and its gateway key are the production project over https', () => {
  assert.equal(XRGS_URL, `https://${PROD_REF}.supabase.co/functions/v1`);
  assert.equal(XRGS_AUTH_URL, `https://${PROD_REF}.supabase.co/auth/v1`);
  assert.equal(jwtRef(XRGS_ANON_KEY), PROD_REF, 'the anon key must belong to the production project, not a local demo key');
});

test('the play-money sandbox is the test RGS over https', () => {
  assert.equal(XRGS_SANDBOX_URL, `https://${SANDBOX_REF}.supabase.co/functions/v1`);
});

test('no RGS address points at this machine', () => {
  for (const url of [XRGS_URL, XRGS_AUTH_URL, XRGS_SANDBOX_URL]) {
    assert.doesNotMatch(url, /localhost|127\.0\.0\.1|0\.0\.0\.0/, `${url} is a local address`);
  }
});
