import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  codeProblem,
  emailProblem,
  redeemEditorCode,
  sendSignInCode,
  SECOND_FACTOR_MESSAGES,
  SIGN_IN_MESSAGES,
  startXgeniaRgsSignIn,
  verifySignInCode,
  XGENIA_PRICING_URL,
  XGENIA_RGS_MESSAGES,
  xgeniaRgsRefusalMessage
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

// (2026-11-10) Every 5xx used to read "not invited": an invited account whose code email failed to send was
// told to go and get invited.
test('a server error that is not an invitation refusal is not reported as "not invited"', async () => {
  const f = fakeFetch({ '/otp': { status: 500, body: { msg: 'Error sending magic link email' } } });
  await assert.rejects(sendSignInCode('mark@studio.com', EP, f), { message: SIGN_IN_MESSAGES.sendFailed });
  const g = fakeFetch({ '/otp': { status: 422, body: { msg: 'Signups not allowed for otp' } } });
  await assert.rejects(sendSignInCode('new@studio.com', EP, g), { message: SIGN_IN_MESSAGES.notInvited });
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

// ─── Sign in with XGENIA (XRGS docs/XGENIA_RGS_CONTRACT.md §9, 2026-11-10) ───

const RGS = { functionsUrl: 'https://x.test/functions/v1', anonKey: 'anon' };
// The listener's state rides on the redirect; the RGS keeps it when it adds the code.
const REDIRECT = 'http://127.0.0.1:53111/xgenia-rgs?state=Zm9yZ2VkLWNvZGUtZ2FwLTEyOA';

/** A fetch answering /xgenia-auth by action, recording every call. */
function fakeAuth(answer: (body: any) => { status: number; body: any }, calls: Call[] = []) {
  return async (url: string, init: any) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body, headers: init.headers });
    if (!url.endsWith('/xgenia-auth')) throw new Error('network down');
    const a = answer(body);
    return { ok: a.status >= 200 && a.status < 300, status: a.status, text: async () => JSON.stringify(a.body) };
  };
}

/** rgs-connect answering by what was asked: CHOOSE_STUDIO without a studio, a key for the named one. */
function chooseStudioFetch(calls: Call[]) {
  return async (url: string, init: any) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body, headers: init.headers });
    const answer = (status: number, b: any) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(b) });
    if (url.endsWith('/verify')) return answer(200, { access_token: 'jwt-1' });
    if (url.endsWith('/rgs-connect')) {
      if (!body.studio_slug) {
        return answer(409, {
          code: 'CHOOSE_STUDIO',
          error: 'You are in more than one RGS studio. Choose which one this editor publishes to.',
          studios: [{ slug: 'mark-studio', name: 'Mark Studio' }, { slug: 'xgenia', name: 'XGENIA' }]
        });
      }
      return answer(200, { api_key: `key-for-${body.studio_slug}`, operator_slug: `${body.studio_slug}-demo` });
    }
    throw new Error('network down');
  };
}

test('email sign-in in several studios asks which one, then connects THAT studio on the same session (XRGS I-191)', async () => {
  const calls: Call[] = [];
  let offered: Array<{ slug: string; name: string }> = [];
  const result = await verifySignInCode('mark@example.com', '838663', EP, chooseStudioFetch(calls), {
    chooseStudio: async (studios) => {
      offered = studios;
      return 'xgenia';
    }
  });
  assert.deepEqual(offered, [{ slug: 'mark-studio', name: 'Mark Studio' }, { slug: 'xgenia', name: 'XGENIA' }]);
  assert.equal(result.apiKey, 'key-for-xgenia');
  assert.equal(result.operatorSlug, 'xgenia-demo');
  const keyCalls = calls.filter((c) => c.url.endsWith('/rgs-connect'));
  assert.equal(keyCalls.length, 2);
  assert.equal(keyCalls[1].body.studio_slug, 'xgenia');
  assert.equal(keyCalls[1].body.access_token, 'jwt-1', 'the second ask must reuse the signed-in session, not a new code');
  assert.equal(calls.filter((c) => c.url.endsWith('/verify')).length, 1, 'the code is checked once');
});

test('cancelling the studio question connects nothing and says nothing alarming', async () => {
  const calls: Call[] = [];
  await assert.rejects(
    verifySignInCode('mark@example.com', '838663', EP, chooseStudioFetch(calls), { chooseStudio: async () => null }),
    (e: any) => e.code === 'CANCELLED'
  );
  assert.equal(calls.filter((c) => c.url.endsWith('/rgs-connect')).length, 1, 'no key may be asked for after a cancel');
});

test('without a way to ask (an older caller), CHOOSE_STUDIO is still a refusal with the server\'s words, never a guess', async () => {
  const calls: Call[] = [];
  await assert.rejects(verifySignInCode('mark@example.com', '838663', EP, chooseStudioFetch(calls)), /Choose which one/);
  assert.equal(calls.filter((c) => c.url.endsWith('/rgs-connect')).length, 1);
});

/**
 * An RGS that requires two-factor sign-in (XRGS I-177..I-182): get-key refuses the emailed-code session
 * with MFA_REQUIRED until it is the authenticator-verified one; GoTrue lists the factor, challenges it and
 * verifies the code '246810'. Several studios on top, when `studios` is set.
 */
function twoFactorFetch(calls: Call[], opts: { factors?: any[]; enrolRequired?: boolean; studios?: boolean } = {}) {
  const factors = opts.factors ?? [{ id: 'f-1', factor_type: 'totp', status: 'verified' }];
  return async (url: string, init: any) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, body, headers: init.headers });
    const answer = (status: number, b: any) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(b) });
    if (url.endsWith('/verify') && !url.includes('/factors/')) return answer(200, { access_token: 'aal1-token' });
    if (url.endsWith('/user')) return answer(200, { id: 'u-1', factors });
    if (url.endsWith('/factors/f-1/challenge')) return answer(200, { id: 'ch-1' });
    if (url.endsWith('/factors/f-1/verify')) {
      return body?.code === '246810' && body?.challenge_id === 'ch-1' ? answer(200, { access_token: 'aal2-token' }) : answer(422, { msg: 'Invalid TOTP code entered' });
    }
    if (url.endsWith('/rgs-connect')) {
      if (body.access_token !== 'aal2-token') {
        return answer(403, { code: opts.enrolRequired ? 'MFA_ENROLL_REQUIRED' : 'MFA_REQUIRED', error: 'two-factor needed' });
      }
      if (opts.studios && !body.studio_slug) {
        return answer(409, { code: 'CHOOSE_STUDIO', error: 'Choose which one', studios: [{ slug: 'a', name: 'A' }, { slug: 'b', name: 'B' }] });
      }
      return answer(200, { api_key: `key-${body.studio_slug || 'own'}`, operator_slug: 'op' });
    }
    throw new Error('network down');
  };
}

test('two-factor: an account with no authenticator is told where to add one; nothing is challenged', async () => {
  const calls: Call[] = [];
  await assert.rejects(
    verifySignInCode('mark@example.com', '838663', EP, twoFactorFetch(calls, { enrolRequired: true }), { askSecondFactor: async () => '246810' }),
    (e: any) => e.message === SECOND_FACTOR_MESSAGES.enrol
  );
  assert.equal(calls.filter((c) => c.url.includes('/factors/')).length, 0);
});

test('two-factor: no VERIFIED factor (an unfinished enrolment) is the enrol message, never a challenge', async () => {
  const calls: Call[] = [];
  await assert.rejects(
    verifySignInCode('mark@example.com', '838663', EP, twoFactorFetch(calls, { factors: [{ id: 'f-1', factor_type: 'totp', status: 'unverified' }] }), {
      askSecondFactor: async () => '246810'
    }),
    (e: any) => e.message === SECOND_FACTOR_MESSAGES.enrol
  );
  assert.equal(calls.filter((c) => c.url.includes('/factors/')).length, 0);
});

test('two-factor: cancelling the authenticator question connects nothing', async () => {
  const calls: Call[] = [];
  await assert.rejects(
    verifySignInCode('mark@example.com', '838663', EP, twoFactorFetch(calls), { askSecondFactor: async () => null }),
    (e: any) => e.code === 'CANCELLED'
  );
  assert.equal(calls.filter((c) => c.url.endsWith('/rgs-connect')).length, 1);
});

test('two-factor: a wrong code is asked again with the reason; the right one connects with the authenticator-verified session', async () => {
  const calls: Call[] = [];
  const asked: Array<string | null> = [];
  const codes = ['111111', '246810'];
  const result = await verifySignInCode('mark@example.com', '838663', EP, twoFactorFetch(calls), {
    askSecondFactor: async (problem) => {
      asked.push(problem);
      return codes.shift() ?? null;
    }
  });
  assert.deepEqual(asked, [null, SECOND_FACTOR_MESSAGES.wrongCode]);
  assert.equal(result.apiKey, 'key-own');
  const challenge = calls.find((c) => c.url.endsWith('/factors/f-1/challenge'))!;
  assert.equal(challenge.headers.Authorization, 'Bearer aal1-token', 'the challenge is made with the emailed-code session');
  const keyCalls = calls.filter((c) => c.url.endsWith('/rgs-connect'));
  assert.equal(keyCalls[keyCalls.length - 1].body.access_token, 'aal2-token', 'the key is asked for with the two-factor session');
});

test('two-factor: three wrong codes end the sign-in', async () => {
  const calls: Call[] = [];
  await assert.rejects(
    verifySignInCode('mark@example.com', '838663', EP, twoFactorFetch(calls), { askSecondFactor: async () => '000000' }),
    (e: any) => e.message === SECOND_FACTOR_MESSAGES.tooManyTries
  );
  assert.equal(calls.filter((c) => c.url.endsWith('/factors/f-1/verify')).length, 3);
});

test('two-factor, then several studios: the authenticator first, then which studio, all on the two-factor session', async () => {
  const calls: Call[] = [];
  const result = await verifySignInCode('mark@example.com', '838663', EP, twoFactorFetch(calls, { studios: true }), {
    askSecondFactor: async () => '246810',
    chooseStudio: async () => 'b'
  });
  assert.equal(result.apiKey, 'key-b');
  const last = calls.filter((c) => c.url.endsWith('/rgs-connect')).pop()!;
  assert.deepEqual([last.body.access_token, last.body.studio_slug], ['aal2-token', 'b']);
});

test('start asks xgenia-auth for an editor sign-in with the loopback redirect and this computer\'s name', async () => {
  const calls: Call[] = [];
  const f = fakeAuth(() => ({ status: 200, body: { authorize_url: 'https://rgs.xgenia.app/auth/xgenia?s=1' } }), calls);
  const r = await startXgeniaRgsSignIn({ editorRedirect: REDIRECT, installLabel: 'studio-mac' }, RGS, f);
  assert.deepEqual(r, { authorizeUrl: 'https://rgs.xgenia.app/auth/xgenia?s=1' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://x.test/functions/v1/xgenia-auth');
  assert.deepEqual(calls[0].body, { action: 'start', purpose: 'editor', editor_redirect: REDIRECT, install_label: 'studio-mac' });
});

test('start refuses a redirect that is not a loopback address before anything is sent', async () => {
  const calls: Call[] = [];
  const f = fakeAuth(() => ({ status: 200, body: { authorize_url: 'https://x' } }), calls);
  await assert.rejects(startXgeniaRgsSignIn({ editorRedirect: 'https://evil.example/xgenia-rgs', installLabel: 'x' }, RGS, f), { code: 'LOOPBACK_FAILED' });
  assert.equal(calls.length, 0);
});

test('an RGS without Sign in with XGENIA (404, or 503 NOT_CONFIGURED) points to the email sign-in', async () => {
  const notDeployed = fakeAuth(() => ({ status: 404, body: { code: 'NOT_FOUND', message: 'Requested function was not found' } }));
  await assert.rejects(startXgeniaRgsSignIn({ editorRedirect: REDIRECT, installLabel: 'x' }, RGS, notDeployed), {
    code: 'NOT_AVAILABLE',
    message: XGENIA_RGS_MESSAGES.NOT_AVAILABLE
  });
  const notConfigured = fakeAuth(() => ({ status: 503, body: { result: false, code: 'NOT_CONFIGURED', error: 'Sign in with XGENIA is not configured on this RGS yet.' } }));
  await assert.rejects(startXgeniaRgsSignIn({ editorRedirect: REDIRECT, installLabel: 'x' }, RGS, notConfigured), { code: 'NOT_AVAILABLE' });
  assert.match(XGENIA_RGS_MESSAGES.NOT_AVAILABLE, /^Sign in with XGENIA is not available on this RGS yet/);
});

test('start with no sign-in page in the answer, or no network, is explained', async () => {
  const empty = fakeAuth(() => ({ status: 200, body: {} }));
  await assert.rejects(startXgeniaRgsSignIn({ editorRedirect: REDIRECT, installLabel: 'x' }, RGS, empty), { code: 'NO_SIGN_IN_URL' });
  const notWeb = fakeAuth(() => ({ status: 200, body: { authorize_url: 'file:///etc/passwd' } }));
  await assert.rejects(startXgeniaRgsSignIn({ editorRedirect: REDIRECT, installLabel: 'x' }, RGS, notWeb), { code: 'NO_SIGN_IN_URL' });
  await assert.rejects(startXgeniaRgsSignIn({ editorRedirect: REDIRECT, installLabel: 'x' }, RGS, fakeFetch({})), { message: SIGN_IN_MESSAGES.unreachable });
});

test('redeeming the one-time code returns the studio key', async () => {
  const calls: Call[] = [];
  const f = fakeAuth(
    () => ({ status: 200, body: { api_key: 'xrgs_editor', operator_slug: 'studio-ab12', studio: { name: 'Acme Games', slug: 'acme' } } }),
    calls
  );
  const r = await redeemEditorCode('one-time-1', RGS, f);
  assert.deepEqual(r, { kind: 'connected', result: { apiKey: 'xrgs_editor', operatorSlug: 'studio-ab12', studio: { name: 'Acme Games', slug: 'acme' } } });
  assert.deepEqual(calls[0].body, { action: 'editor-redeem', code: 'one-time-1' });
});

test('an expired or used code (CODE_INVALID) is a refusal, never a connection', async () => {
  const f = fakeAuth(() => ({ status: 400, body: { result: false, code: 'CODE_INVALID', error: 'This code has expired or was already used. Connect again.' } }));
  await assert.rejects(redeemEditorCode('stale', RGS, f), { code: 'CODE_INVALID', message: 'This code has expired or was already used. Connect again.' });
  const noText = fakeAuth(() => ({ status: 400, body: { result: false, code: 'CODE_INVALID' } }));
  await assert.rejects(redeemEditorCode('stale', RGS, noText), { code: 'CODE_INVALID', message: XGENIA_RGS_MESSAGES.CODE_INVALID });
  await assert.rejects(redeemEditorCode('  ', RGS, noText), { code: 'CODE_INVALID' });
});

test('several studios: CHOOSE_STUDIO lists them, and the same code is redeemed again with the chosen slug', async () => {
  const calls: Call[] = [];
  const f = fakeAuth(
    (body) =>
      body.studio_slug
        ? { status: 200, body: { api_key: 'xrgs_b', operator_slug: 'op-b', studio: { name: 'Beta', slug: body.studio_slug } } }
        : { status: 409, body: { result: false, code: 'CHOOSE_STUDIO', studios: [{ name: 'Alpha', slug: 'alpha' }, { name: 'Beta', slug: 'beta' }] } },
    calls
  );
  const first = await redeemEditorCode('c-1', RGS, f);
  assert.deepEqual(first, { kind: 'choose-studio', studios: [{ name: 'Alpha', slug: 'alpha' }, { name: 'Beta', slug: 'beta' }] });
  const second = await redeemEditorCode('c-1', RGS, f, 'beta');
  assert.equal(second.kind, 'connected');
  assert.deepEqual(calls.map((c) => c.body), [
    { action: 'editor-redeem', code: 'c-1' },
    { action: 'editor-redeem', code: 'c-1', studio_slug: 'beta' }
  ]);
  // Asked to choose from nothing: refused, not guessed.
  const none = fakeAuth(() => ({ status: 409, body: { code: 'CHOOSE_STUDIO', studios: [] } }));
  await assert.rejects(redeemEditorCode('c-2', RGS, none), { code: 'NO_STUDIO' });
});

test('NO_PLAN says the RGS comes with every paid plan and where to upgrade, whatever the server said', () => {
  const m = xgeniaRgsRefusalMessage('NO_PLAN', 'The play-money sandbox in the editor stays free.');
  assert.equal(m, XGENIA_RGS_MESSAGES.NO_PLAN);
  assert.match(m, /comes with every paid XGENIA plan/);
  assert.ok(m.includes(XGENIA_PRICING_URL));
  assert.equal(XGENIA_PRICING_URL, 'https://primora.xgenia.com/pricing');
  assert.doesNotMatch(m, /free/i);
});

test('other refusals show the server\'s own words (a frozen studio says why), else the plain-English fallback', async () => {
  const frozen = fakeAuth(() => ({ status: 403, body: { result: false, code: 'STUDIO_FROZEN', error: 'Acme Games\'s plan ended on 2026-11-01. Renew it to publish again.' } }));
  await assert.rejects(redeemEditorCode('c', RGS, frozen), { code: 'STUDIO_FROZEN', message: 'Acme Games\'s plan ended on 2026-11-01. Renew it to publish again.' });
  for (const code of ['VIEWER_ONLY', 'NO_STUDIO', 'NO_CONNECTION', 'NOT_YOUR_STUDIO', 'SIGN_IN_REFUSED'] as const) {
    const f = fakeAuth(() => ({ status: code === 'NO_CONNECTION' ? 409 : 403, body: { result: false, code } }));
    await assert.rejects(redeemEditorCode('c', RGS, f), { code, message: XGENIA_RGS_MESSAGES[code] });
  }
  assert.equal(xgeniaRgsRefusalMessage('ASK_STUDIO_ADMIN', ''), XGENIA_RGS_MESSAGES.ASK_STUDIO_ADMIN);
  assert.equal(xgeniaRgsRefusalMessage('SOMETHING_NEW', ''), 'XGENIA RGS refused the sign-in (SOMETHING_NEW).');
});

test('a redeem answer without a key is never treated as connected', async () => {
  const f = fakeAuth(() => ({ status: 200, body: { operator_slug: 'x' } }));
  await assert.rejects(redeemEditorCode('c', RGS, f), { message: SIGN_IN_MESSAGES.noKey });
});
