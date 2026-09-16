// ─────────────────────────────────────────────────────────────────────────────
// THE BRIDGE NEVER HANDS OUT A TOKEN IT CAN SEE IS EXPIRED
//
// (2026-09-16) `auth.getJwt` falls back to the persisted session when getSession() is stuck behind
// the boot refresh. With the chat functions' gateway JWT check switched off (2026-09-15), an expired
// token from that fallback reached check-entitlement and came back as a plain 401 that the deployed
// panel read as "not entitled". These tests pin the picker that now filters the fallback.
// ─────────────────────────────────────────────────────────────────────────────
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickPersistedAccessToken, jwtExpiryMs } from '../../src/editor/src/views/panels/ChatPanelBridge/persisted-session-token';

const NOW = 1_800_000_000_000; // an arbitrary instant, in ms

/** An unsigned JWT-shaped string whose payload carries `exp` (seconds). */
function jwtWithExp(expSeconds: number | null): string {
  const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const payload: Record<string, unknown> = { sub: 'u1', role: 'authenticated' };
  if (expSeconds !== null) payload.exp = expSeconds;
  return `${b64url({ alg: 'ES256', typ: 'JWT' })}.${b64url(payload)}.sig`;
}

test('a token that expired is answered as null, and says why', () => {
  const raw = JSON.stringify({ access_token: jwtWithExp(NOW / 1000 - 600), refresh_token: 'r' });
  assert.deepEqual(pickPersistedAccessToken(raw, NOW), { token: null, reason: 'expired' });
});

test('a token inside the safety margin counts as expired — it would be by the time it is used', () => {
  const raw = JSON.stringify({ access_token: jwtWithExp(NOW / 1000 + 5) });
  assert.equal(pickPersistedAccessToken(raw, NOW, 10_000).reason, 'expired');
});

test('a token with time left is handed out unchanged', () => {
  const tok = jwtWithExp(NOW / 1000 + 3600);
  assert.deepEqual(pickPersistedAccessToken(JSON.stringify({ access_token: tok }), NOW), { token: tok, reason: 'ok' });
});

test('the older currentSession shape is still read', () => {
  const tok = jwtWithExp(NOW / 1000 + 3600);
  assert.equal(pickPersistedAccessToken(JSON.stringify({ currentSession: { access_token: tok } }), NOW).token, tok);
});

test('a token without exp cannot be judged, so it is handed out', () => {
  const tok = jwtWithExp(null);
  assert.equal(jwtExpiryMs(tok), null);
  assert.equal(pickPersistedAccessToken(JSON.stringify({ access_token: tok }), NOW).reason, 'ok');
});

test('garbage and empty entries answer none/unreadable, never throw', () => {
  assert.deepEqual(pickPersistedAccessToken(null, NOW), { token: null, reason: 'none' });
  assert.deepEqual(pickPersistedAccessToken('{not json', NOW), { token: null, reason: 'unreadable' });
  assert.deepEqual(pickPersistedAccessToken(JSON.stringify({ access_token: 42 }), NOW), { token: null, reason: 'none' });
});
