import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  codeProblem,
  emailProblem,
  sendSignInCode,
  SIGN_IN_MESSAGES,
  verifySignInCode
} from '../../src/editor/src/utils/rgs/rgsSignIn';

const EP = { authUrl: 'https://x.test/auth/v1', functionsUrl: 'https://x.test/functions/v1', anonKey: 'anon' };

type Call = { url: string; body: any; headers: Record<string, string> };

/** A fetch that answers from a script, recording what was asked. */
function fakeFetch(answers: Record<string, { status: number; body: any }>, calls: Call[] = []) {
  return async (url: string, init: any) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    const key = Object.keys(answers).find((k) => url.endsWith(k));
    if (!key) throw new Error('network down');
    const a = answers[key];
    return { ok: a.status >= 200 && a.status < 300, status: a.status, text: async () => JSON.stringify(a.body) };
  };
}

test('a bad email or code is refused before anything is sent', () => {
  assert.equal(emailProblem(''), SIGN_IN_MESSAGES.emailRequired);
  assert.equal(emailProblem('not-an-email'), SIGN_IN_MESSAGES.emailInvalid);
  assert.equal(emailProblem('  Studio@Example.COM '), '');
  assert.equal(codeProblem('12345'), SIGN_IN_MESSAGES.codeRequired);
  assert.equal(codeProblem('12a456'), SIGN_IN_MESSAGES.codeRequired);
  assert.equal(codeProblem('123 456'), '');
});

test('sending a code asks Supabase Auth for an email code, lower-cased, creating the user', async () => {
  const calls: Call[] = [];
  await sendSignInCode(' Studio@Example.com ', EP, fakeFetch({ '/otp': { status: 200, body: {} } }, calls));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://x.test/auth/v1/otp');
  assert.deepEqual(calls[0].body, { email: 'studio@example.com', create_user: true });
  assert.equal(calls[0].headers.apikey, 'anon');
});

test('an address that is not invited gets told so, not "Database error saving new user"', async () => {
  const f = fakeFetch({ '/otp': { status: 500, body: { msg: 'Database error saving new user' } } });
  await assert.rejects(sendSignInCode('new@studio.com', EP, f), { message: SIGN_IN_MESSAGES.notInvited });
});

test('rate limiting is explained', async () => {
  const f = fakeFetch({ '/otp': { status: 429, body: { msg: 'For security purposes…' } } });
  await assert.rejects(sendSignInCode('a@b.co', EP, f), { message: SIGN_IN_MESSAGES.tooMany });
});

test('no network is explained', async () => {
  await assert.rejects(sendSignInCode('a@b.co', EP, fakeFetch({})), { message: SIGN_IN_MESSAGES.unreachable });
});

test('a good code is exchanged for the studio key through rgs-connect get-key', async () => {
  const calls: Call[] = [];
  const f = fakeFetch(
    {
      '/verify': { status: 200, body: { access_token: 'jwt-1' } },
      '/rgs-connect': { status: 200, body: { connected: true, operator_slug: 'studio-ab12', api_key: 'xrgs_k', message: 'New RGS connection created.' } }
    },
    calls
  );
  const r = await verifySignInCode('a@b.co', '123 456', EP, f);
  assert.deepEqual(r, { apiKey: 'xrgs_k', operatorSlug: 'studio-ab12', created: true });
  assert.deepEqual(calls[0].body, { type: 'email', email: 'a@b.co', token: '123456' });
  assert.equal(calls[1].url, 'https://x.test/functions/v1/rgs-connect');
  assert.deepEqual(calls[1].body, { action: 'get-key', access_token: 'jwt-1' });
});

test('a wrong code never reaches rgs-connect', async () => {
  const calls: Call[] = [];
  const f = fakeFetch({ '/verify': { status: 403, body: { msg: 'Token has expired or is invalid' } } }, calls);
  await assert.rejects(verifySignInCode('a@b.co', '000000', EP, f), { message: SIGN_IN_MESSAGES.badCode });
  assert.equal(calls.length, 1);
});

test('rgs-connect refusing or returning no key is surfaced, never treated as connected', async () => {
  const refused = fakeFetch({
    '/verify': { status: 200, body: { access_token: 'jwt' } },
    '/rgs-connect': { status: 500, body: { error: 'Failed to issue an API key' } }
  });
  await assert.rejects(verifySignInCode('a@b.co', '123456', EP, refused), { message: 'Failed to issue an API key' });
  const empty = fakeFetch({
    '/verify': { status: 200, body: { access_token: 'jwt' } },
    '/rgs-connect': { status: 200, body: { connected: true } }
  });
  await assert.rejects(verifySignInCode('a@b.co', '123456', EP, empty), { message: SIGN_IN_MESSAGES.noKey });
});
