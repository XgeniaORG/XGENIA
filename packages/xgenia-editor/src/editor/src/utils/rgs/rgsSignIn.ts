// Sign in to XGENIA RGS with an email code, and come back with an operator key.
//
// ── Why this exists ──────────────────────────────────────────────────────────
// The Maths RGS panel's self-serve route was "Create operator & get key", which
// POSTed /rest/v1/rpc/create_operator with the public anon key. XRGS revoked that
// RPC from anon in migration 20260917140000 (anyone holding the anon key — it
// ships in every published game — could mint operators), so every new studio got
// "permission denied for function create_operator" and the only way in left was
// to email a platform admin for a key.
//
// XRGS already has the replacement: the `rgs-connect` function issues a studio's
// own operator key to a signed-in user — creating the studio's organisation and a
// demo operator the first time, finding them again after that. Its browser page
// does three plain HTTPS calls; this module does the same three from the editor,
// so sign-in happens in the panel (email → 6-digit code → connected) instead of a
// popup whose postMessage target has to be on an origin allowlist:
//
//   1. POST {auth}/otp     { email, create_user: true }  → a code is emailed
//   2. POST {auth}/verify  { type: 'email', email, token } → a session
//   3. POST {fn}/rgs-connect { action: 'get-key', access_token } → { api_key }
//
// Accounts are invitation-only on XRGS (a trigger on auth.users refuses an
// address that is not on the allowlist), so step 1 failing for a new address is
// the ordinary case for someone who has not been invited. GoTrue reports that as
// a bare 500 "Database error saving new user"; it is translated here into what
// the person can actually do about it.
//
// The fetch function is injectable so the whole exchange is tested without a
// network (tests/rgs/rgsSignIn.test.ts).

export interface RgsSignInEndpoints {
  /** Supabase Auth base, e.g. https://<ref>.supabase.co/auth/v1 */
  authUrl: string;
  /** Edge-function base, e.g. https://<ref>.supabase.co/functions/v1 */
  functionsUrl: string;
  /** The project's publishable anon key (not a secret). */
  anonKey: string;
}

export interface RgsSignInResult {
  apiKey: string;
  operatorSlug: string;
  /** True when this sign-in created the studio's organisation and operator. */
  created: boolean;
}

type FetchLike = (url: string, init?: any) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** Plain-English messages, exported so the panel and the tests agree on them. */
export const SIGN_IN_MESSAGES = {
  xgeniaSignedOut: 'Your XGENIA sign-in has expired. Sign in to XGENIA again, then press Publish.',
  emailRequired: 'Enter your email address.',
  emailInvalid: 'That does not look like an email address.',
  codeRequired: 'Enter the 6-digit code from the email.',
  notInvited:
    'This email has not been invited to XGENIA RGS yet. Ask your XGENIA contact to invite it, then try again.',
  tooMany: 'Too many codes requested. Wait a minute, then try again.',
  badCode: 'That code is wrong or has expired. Request a new code and try again.',
  noKey: 'Signed in, but XGENIA RGS did not return a key. Try again in a moment.',
  unreachable: 'Could not reach XGENIA RGS. Check your internet connection and try again.'
} as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normaliseEmail(email: string): string {
  return String(email || '').trim().toLowerCase();
}

/** Why this email cannot be used, or '' when it can. */
export function emailProblem(email: string): string {
  const e = normaliseEmail(email);
  if (!e) return SIGN_IN_MESSAGES.emailRequired;
  if (!EMAIL_RE.test(e)) return SIGN_IN_MESSAGES.emailInvalid;
  return '';
}

/** Why this code cannot be used, or '' when it can. Codes are digits; spaces are forgiven. */
export function codeProblem(code: string): string {
  const c = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(c)) return SIGN_IN_MESSAGES.codeRequired;
  return '';
}

function parse(text: string): any {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function serverMessage(body: any, text: string): string {
  return String((body && (body.msg || body.message || body.error_description || body.error)) || text || '').trim();
}

async function post(fetchFn: FetchLike, url: string, body: unknown, headers: Record<string, string>) {
  let res;
  try {
    res = await fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  } catch {
    throw new Error(SIGN_IN_MESSAGES.unreachable);
  }
  const text = await res.text().catch(() => '');
  return { res, body: parse(text), text };
}

/** Step 1: email a 6-digit sign-in code. Throws with a message the person can act on. */
export async function sendSignInCode(email: string, ep: RgsSignInEndpoints, fetchFn: FetchLike = fetch as any): Promise<void> {
  const problem = emailProblem(email);
  if (problem) throw new Error(problem);
  const { res, body, text } = await post(
    fetchFn,
    `${ep.authUrl}/otp`,
    { email: normaliseEmail(email), create_user: true },
    { apikey: ep.anonKey }
  );
  if (res.ok) return;
  const msg = serverMessage(body, text);
  if (res.status === 429) throw new Error(SIGN_IN_MESSAGES.tooMany);
  // The invitation trigger refuses the auth.users insert; GoTrue answers 500
  // "Database error saving new user" (sometimes 422 "Signups not allowed").
  if (res.status >= 500 || /saving new user|signups? not allowed|not allowed/i.test(msg)) {
    throw new Error(SIGN_IN_MESSAGES.notInvited);
  }
  throw new Error(msg || `Could not send a code (HTTP ${res.status}).`);
}

/** Steps 2 + 3: check the code, then exchange the session for the studio's operator key. */
export async function verifySignInCode(
  email: string,
  code: string,
  ep: RgsSignInEndpoints,
  fetchFn: FetchLike = fetch as any
): Promise<RgsSignInResult> {
  const eProblem = emailProblem(email);
  if (eProblem) throw new Error(eProblem);
  const cProblem = codeProblem(code);
  if (cProblem) throw new Error(cProblem);

  const verified = await post(
    fetchFn,
    `${ep.authUrl}/verify`,
    { type: 'email', email: normaliseEmail(email), token: String(code).replace(/\s+/g, '') },
    { apikey: ep.anonKey }
  );
  const accessToken = verified.body?.access_token || verified.body?.session?.access_token;
  if (!verified.res.ok || !accessToken) {
    if (verified.res.status === 429) throw new Error(SIGN_IN_MESSAGES.tooMany);
    throw new Error(SIGN_IN_MESSAGES.badCode);
  }

  const keyed = await post(
    fetchFn,
    `${ep.functionsUrl}/rgs-connect`,
    { action: 'get-key', access_token: accessToken },
    { apikey: ep.anonKey, Authorization: `Bearer ${ep.anonKey}` }
  );
  if (!keyed.res.ok) {
    throw new Error(serverMessage(keyed.body, keyed.text) || `XGENIA RGS refused the sign-in (HTTP ${keyed.res.status}).`);
  }
  const apiKey = keyed.body?.api_key;
  if (!apiKey) throw new Error(SIGN_IN_MESSAGES.noKey);
  return {
    apiKey,
    operatorSlug: String(keyed.body?.operator_slug || ''),
    created: /new rgs connection/i.test(String(keyed.body?.message || ''))
  };
}

/**
 * Every XGENIA login is a play-money RGS sandbox (2026-11-02): the test RGS checks the XGENIA access token with
 * XGENIA's own auth service and makes or reuses this account's sandbox, then issues a key for this install. No
 * second account, no invite, no email code.
 */
export async function connectWithXgeniaToken(
  xgeniaToken: string,
  ep: { functionsUrl: string; anonKey: string },
  fetchFn: FetchLike = fetch as any
): Promise<RgsSignInResult> {
  if (!xgeniaToken) throw new Error(SIGN_IN_MESSAGES.xgeniaSignedOut);
  const keyed = await post(
    fetchFn,
    `${ep.functionsUrl}/rgs-connect`,
    { action: 'xgenia-connect', xgenia_token: xgeniaToken },
    { apikey: ep.anonKey, Authorization: `Bearer ${ep.anonKey}` }
  );
  if (keyed.res.status === 401) throw new Error(SIGN_IN_MESSAGES.xgeniaSignedOut);
  if (!keyed.res.ok) {
    throw new Error(serverMessage(keyed.body, keyed.text) || `The play-money RGS refused the sign-in (HTTP ${keyed.res.status}).`);
  }
  const apiKey = keyed.body?.api_key;
  if (!apiKey) throw new Error(SIGN_IN_MESSAGES.noKey);
  return {
    apiKey,
    operatorSlug: String(keyed.body?.operator_slug || ''),
    created: /is ready/i.test(String(keyed.body?.message || ''))
  };
}
