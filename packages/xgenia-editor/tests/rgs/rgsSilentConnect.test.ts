// The editor connects to XGENIA RGS by itself, for play money (XRGS contract §10): the protocol, in the editor.
//
// Two things must stay true, and each test below fails if one stops being:
//   - the XGENIA session is sent to XGENIA and NOWHERE else — the RGS gets a ticket, never the session;
//   - the ticket is useless without the verifier: XGENIA is sent only its SHA-256, the RGS the verifier itself,
//     and a new one is made for every attempt.
// And it never throws: every failure is a quiet 'refused', so the caller can fall back to the browser.
//   TSX_TSCONFIG_PATH=packages/xgenia-editor/tsconfig.json npx -y tsx@4.19.2 --test --test-force-exit packages/xgenia-editor/tests/rgs/rgsSilentConnect.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newTicketVerifier, silentEditorConnect, ticketChallenge } from '../../src/editor/src/utils/rgs/rgsSignIn';

const EP = { xgeniaFunctionsUrl: 'https://xgenia.test/functions/v1', xgeniaAnonKey: 'xgenia-anon', functionsUrl: 'https://rgs.test/functions/v1', anonKey: 'rgs-anon' };
const SESSION = 'eyJ.the-persons-xgenia-session.sig';
const TICKET = 'xet1.payload.signature';

type Call = { url: string; body: any; headers: Record<string, string> };
function fakeFetch(answers: { ticket?: { status: number; body: any } | 'down'; connect?: { status: number; body: any } | 'down' }, calls: Call[] = []) {
  return async (url: string, init: any) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    const a = url.endsWith('/rgs-editor-ticket') ? answers.ticket : url.endsWith('/xgenia-auth') ? answers.connect : undefined;
    if (!a || a === 'down') throw new Error('network down');
    return { ok: a.status >= 200 && a.status < 300, status: a.status, text: async () => JSON.stringify(a.body) };
  };
}
const OK_TICKET = { status: 200, body: { ticket: TICKET, expires_in: 60 } };
const OK_KEY = { status: 200, body: { api_key: 'op_key_1', operator_slug: 'fox-demo', studio: { name: 'Fox', slug: 'fox' }, play_money_only: true } };

test('nobody is signed in to XGENIA: refused, and nothing is sent anywhere', async () => {
  for (const session of ['', '   ', null as any, undefined as any]) {
    const calls: Call[] = [];
    assert.deepEqual(await silentEditorConnect(session, EP, fakeFetch({ ticket: OK_TICKET, connect: OK_KEY }, calls)), { kind: 'refused', code: 'SIGNED_OUT', message: '' });
    assert.equal(calls.length, 0);
  }
});

test('the XGENIA session goes to XGENIA and nowhere else; the RGS gets the ticket and the verifier', async () => {
  const calls: Call[] = [];
  const out = await silentEditorConnect(SESSION, EP, fakeFetch({ ticket: OK_TICKET, connect: OK_KEY }, calls), { installLabel: "ada's laptop" });
  assert.deepEqual(out, { kind: 'connected', result: { apiKey: 'op_key_1', operatorSlug: 'fox-demo', studio: { name: 'Fox', slug: 'fox' }, playMoneyOnly: true } });
  assert.equal(calls.length, 2);
  const [toXgenia, toRgs] = calls;
  assert.equal(toXgenia.url, 'https://xgenia.test/functions/v1/rgs-editor-ticket');
  assert.equal(toXgenia.headers.Authorization, `Bearer ${SESSION}`);
  assert.equal(toXgenia.headers.apikey, 'xgenia-anon');
  assert.equal(toRgs.url, 'https://rgs.test/functions/v1/xgenia-auth');
  assert.equal(JSON.stringify(toRgs).includes('the-persons-xgenia-session'), false, 'the XGENIA session was sent to the RGS');
  assert.equal(toRgs.headers.Authorization, 'Bearer rgs-anon');
  assert.equal(toRgs.body.action, 'editor-connect');
  assert.equal(toRgs.body.ticket, TICKET);
  assert.equal(toRgs.body.install_label, "ada's laptop");
  assert.equal('studio_slug' in toRgs.body, false);

  // XGENIA is told the verifier's hash, the RGS the verifier itself — and never the other way round.
  const verifier: string = toRgs.body.verifier;
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(toXgenia.body, { challenge: await ticketChallenge(verifier) });
  assert.equal(JSON.stringify(toXgenia).includes(verifier), false, 'XGENIA was sent the verifier: a ticket would then be usable by whoever saw that request');
  assert.notEqual(toXgenia.body.challenge, verifier);
});

test('a new verifier for every attempt, from real randomness', async () => {
  const calls: Call[] = [];
  const fetchFn = fakeFetch({ ticket: OK_TICKET, connect: OK_KEY }, calls);
  await silentEditorConnect(SESSION, EP, fetchFn);
  await silentEditorConnect(SESSION, EP, fetchFn);
  const verifiers = calls.filter((c) => c.url.endsWith('/xgenia-auth')).map((c) => c.body.verifier);
  assert.equal(verifiers.length, 2);
  assert.notEqual(verifiers[0], verifiers[1], 'the verifier was reused');
  assert.notEqual(newTicketVerifier(), newTicketVerifier());
  // 32 bytes: the bytes asked for are the bytes used.
  let asked = 0;
  const v = newTicketVerifier((n) => { asked = n; return new Uint8Array(n).fill(255); });
  assert.equal(asked, 32);
  assert.equal(v, '_'.repeat(42) + '8');
  assert.equal(await ticketChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', 'not the challenge XRGS computes for this verifier');
});

test('several studios: the list, each marked; then the chosen one is named to the RGS', async () => {
  const choose = { status: 409, body: { code: 'CHOOSE_STUDIO', studios: [{ name: 'Fox', slug: 'fox', play_money_only: true }, { name: 'North', slug: 'north', play_money_only: false }, { slug: '' }, null] } };
  assert.deepEqual(await silentEditorConnect(SESSION, EP, fakeFetch({ ticket: OK_TICKET, connect: choose })), {
    kind: 'choose-studio',
    studios: [{ name: 'Fox', slug: 'fox', playMoneyOnly: true }, { name: 'North', slug: 'north', playMoneyOnly: false }]
  });
  // "play money only" is true only when the RGS says exactly that.
  const vague = { status: 409, body: { code: 'CHOOSE_STUDIO', studios: [{ name: 'Fox', slug: 'fox' }, { name: 'N', slug: 'n', play_money_only: 'yes' }] } };
  const out = await silentEditorConnect(SESSION, EP, fakeFetch({ ticket: OK_TICKET, connect: vague }));
  assert.deepEqual(out.kind === 'choose-studio' && out.studios.map((s) => s.playMoneyOnly), [false, false]);
  assert.equal((await silentEditorConnect(SESSION, EP, fakeFetch({ ticket: OK_TICKET, connect: { status: 409, body: { code: 'CHOOSE_STUDIO', studios: [] } } }))).kind, 'refused');

  const calls: Call[] = [];
  await silentEditorConnect(SESSION, EP, fakeFetch({ ticket: OK_TICKET, connect: OK_KEY }, calls), { studioSlug: 'fox' });
  assert.equal(calls[1].body.studio_slug, 'fox');
});

test('every refusal is quiet and carries the code; it never throws', async () => {
  const cases: Array<[string, Parameters<typeof fakeFetch>[0], string]> = [
    ['XGENIA does not mint tickets yet', { ticket: { status: 404, body: {} }, connect: OK_KEY }, 'NOT_AVAILABLE'],
    ['XGENIA is not configured', { ticket: { status: 503, body: { error: 'Not configured' } }, connect: OK_KEY }, 'NOT_AVAILABLE'],
    ['the session has expired', { ticket: { status: 401, body: { error: 'Invalid or expired token' } }, connect: OK_KEY }, 'TICKET_REFUSED'],
    ['a 200 with no ticket in it', { ticket: { status: 200, body: {} }, connect: OK_KEY }, 'TICKET_REFUSED'],
    ['XGENIA cannot be reached', { ticket: 'down', connect: OK_KEY }, 'UNREACHABLE'],
    ['the RGS cannot be reached', { ticket: OK_TICKET, connect: 'down' }, 'UNREACHABLE'],
    ['an older RGS', { ticket: OK_TICKET, connect: { status: 400, body: { result: false, error: 'action must be start, callback, …' } } }, 'NOT_AVAILABLE'],
    ['a studio with a real-money game', { ticket: OK_TICKET, connect: { status: 403, body: { code: 'SECOND_FACTOR_REQUIRED', error: 'has a real-money game' } } }, 'SECOND_FACTOR_REQUIRED'],
    ['no plan as far as the RGS knows', { ticket: OK_TICKET, connect: { status: 403, body: { code: 'NOT_ENTITLED', error: 'no active plan' } } }, 'NOT_ENTITLED'],
    ['the migration is not applied', { ticket: OK_TICKET, connect: { status: 503, body: { code: 'NOT_INSTALLED', error: 'x' } } }, 'NOT_INSTALLED'],
  ];
  for (const [what, answers, code] of cases) {
    const out = await silentEditorConnect(SESSION, EP, fakeFetch(answers));
    assert.equal(out.kind, 'refused', what);
    assert.equal(out.kind === 'refused' && out.code, code, what);
  }
  // No ticket: the RGS is not asked at all.
  const calls: Call[] = [];
  await silentEditorConnect(SESSION, EP, fakeFetch({ ticket: { status: 401, body: {} }, connect: OK_KEY }, calls));
  assert.equal(calls.length, 1);
});

test('only a key the RGS itself calls play money only is taken this way', async () => {
  for (const body of [
    { api_key: 'op_full', operator_slug: 'x', studio: { name: 'Fox', slug: 'fox' } },
    { api_key: 'op_full', operator_slug: 'x', studio: { name: 'Fox', slug: 'fox' }, play_money_only: false },
    { api_key: 'op_full', operator_slug: 'x', studio: { name: 'Fox', slug: 'fox' }, play_money_only: 'true' },
    { operator_slug: 'x', play_money_only: true },
  ]) {
    assert.deepEqual(await silentEditorConnect(SESSION, EP, fakeFetch({ ticket: OK_TICKET, connect: { status: 200, body } })), { kind: 'refused', code: 'NO_KEY', message: '' }, JSON.stringify(body));
  }
});
